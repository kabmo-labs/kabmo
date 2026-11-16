/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A small shell tokenizer, enough to find a command's words and its output
 * redirects.
 *
 * It is not a shell: no expansion, no substitution, no heredoc body. It exists
 * because omp's trace models `argv` but not redirections (measured: `bun test >
 * /tmp/n1.log 2>&1` yields only `and_or`/`pipeline`/`simple`/`word` nodes), and
 * a redirect is a file write the journal must see.
 *
 * `2>&1` and `>&2` are fd duplications, not file targets, so they become a
 * `fddup` operator the splitter drops. `2>` and `2>>` are output redirects on
 * descriptor 2 and keep their target.
 */

export interface Token {
  kind: 'word' | 'op';
  value: string;
}

export interface SimpleCommand {
  words: string[];
  redirects: { op: string; target: string }[];
}

/** Tokenize a shell script into words and operators. */
export function tokenizeCommand(script: string): Token[] {
  const tokens: Token[] = [];
  let word = '';
  let hasWord = false;
  const flush = (): void => {
    if (!hasWord) return;
    tokens.push({ kind: 'word', value: word });
    word = '';
    hasWord = false;
  };

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      flush();
      continue;
    }
    if (ch === '#' && !hasWord) {
      while (i < script.length && script[i] !== '\n') i++;
      continue;
    }
    if (ch === "'") {
      hasWord = true;
      i++;
      while (i < script.length && script[i] !== "'") word += script[i++];
      continue;
    }
    if (ch === '"') {
      hasWord = true;
      i++;
      while (i < script.length && script[i] !== '"') {
        if (script[i] === '\\' && i + 1 < script.length) {
          i++;
          word += script[i++];
        } else {
          word += script[i++];
        }
      }
      continue;
    }
    if (ch === '\\' && i + 1 < script.length) {
      hasWord = true;
      word += script[++i];
      continue;
    }
    // `2>&1` / `>&2` are fd duplications, not file targets.
    if (!hasWord && ch === '2' && script[i + 1] === '>' && script[i + 2] === '&') {
      let j = i + 3;
      while (j < script.length && /[0-9-]/.test(script[j])) j++;
      tokens.push({ kind: 'op', value: 'fddup' });
      i = j - 1;
      continue;
    }
    if (!hasWord && ch === '&' && script[i + 1] === '>') {
      if (script[i + 2] === '&') {
        tokens.push({ kind: 'op', value: '&>>' });
        i += 2;
      } else {
        tokens.push({ kind: 'op', value: '&>' });
        i += 1;
      }
      continue;
    }
    // `2>` / `2>>` — the `2` is a descriptor, not an argument.
    if (ch === '2' && script[i + 1] === '>' && (!hasWord || word === '2')) {
      if (word === '2') {
        word = '';
        hasWord = false;
      }
      const op = script[i + 2] === '>' ? '2>>' : '2>';
      tokens.push({ kind: 'op', value: op });
      i += op.length - 1;
      continue;
    }
    if (ch === '|' || ch === '&' || ch === ';' || ch === '<' || ch === '>') {
      flush();
      const two = script.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '>>' || two === '<<' || two === '>&') {
        tokens.push({ kind: 'op', value: two });
        i++;
        continue;
      }
      tokens.push({ kind: 'op', value: ch });
      continue;
    }
    hasWord = true;
    word += ch;
  }
  flush();
  return tokens;
}

/**
 * Drop heredoc BODIES, keeping the command line that opens them.
 *
 * A heredoc body is data, not shell: `cat > f <<'EOF'` followed by lines that
 * happen to contain `>` or `rm` must not be parsed as commands. Measured on a
 * real session: an `AGENTS.md` heredoc whose prose named a file produced a
 * phantom `cat > Panduan` mutation. The delimiter line itself is dropped too.
 */
export function stripHeredocs(script: string): string {
  const lines = script.split('\n');
  const out: string[] = [];
  let pending: string | null = null;
  let stripTabs = false;
  for (const line of lines) {
    if (pending !== null) {
      const candidate = stripTabs ? line.replace(/^\t+/, '') : line;
      if (candidate === pending) pending = null;
      out.push('');
      continue;
    }
    out.push(line);
    const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (match?.[2]) {
      pending = match[2];
      stripTabs = line.includes('<<-');
    }
  }
  return out.join('\n');
}

/** Split tokens into simple commands, keeping each command's output redirects. */
export function splitCommands(tokens: Token[]): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], redirects: [] };
  const push = (): void => {
    if (current.words.length > 0 || current.redirects.length > 0) commands.push(current);
    current = { words: [], redirects: [] };
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'word') {
      current.words.push(token.value);
      continue;
    }
    if (token.value === ';' || token.value === '&&' || token.value === '||' || token.value === '|' || token.value === '&') {
      push();
      continue;
    }
    if (token.value === 'fddup') continue;
    if (token.value === '<' || token.value === '<<' || token.value === '>&') {
      i++;
      continue;
    }
    const target = tokens[i + 1];
    if (target?.kind === 'word') {
      current.redirects.push({ op: token.value, target: target.value });
      i++;
    }
  }
  push();
  return commands;
}
