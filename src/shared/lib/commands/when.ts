/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `when` clause: a deliberately small expression language.
 *
 * VS Code's full grammar (`=~`, `in`, comparisons) is a language with its own
 * parser, tests and failure modes. Three operators plus equality cover every
 * condition this app has, and anything richer belongs in the command's own
 * `run`, where it can be read as code.
 *
 * Grammar:
 *
 *   expr  := or
 *   or    := and ('||' and)*
 *   and   := unary ('&&' unary)*
 *   unary := '!' unary | '(' expr ')' | atom
 *   atom  := key ('==' value | '!=' value)?
 *
 * An unknown key is FALSE, so a clause naming a context this build does not
 * publish hides the command rather than showing it everywhere.
 */

import type { CommandContext } from '@/shared/lib/commands/types';

type Predicate = (context: CommandContext) => boolean;

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'op'; value: '!' | '&&' | '||' | '==' | '!=' | '(' | ')' };

const IDENT_START = /[A-Za-z0-9_]/;
const IDENT_PART = /[A-Za-z0-9_.-]/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: 'op', value: char });
      index += 1;
      continue;
    }
    if (char === '!' && source[index + 1] === '=') {
      tokens.push({ kind: 'op', value: '!=' });
      index += 2;
      continue;
    }
    if (char === '!') {
      tokens.push({ kind: 'op', value: '!' });
      index += 1;
      continue;
    }
    if (char === '&' && source[index + 1] === '&') {
      tokens.push({ kind: 'op', value: '&&' });
      index += 2;
      continue;
    }
    if (char === '|' && source[index + 1] === '|') {
      tokens.push({ kind: 'op', value: '||' });
      index += 2;
      continue;
    }
    if (char === '=' && source[index + 1] === '=') {
      tokens.push({ kind: 'op', value: '==' });
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let value = '';
      index += 1;
      while (index < source.length && source[index] !== quote) {
        value += source[index];
        index += 1;
      }
      if (source[index] !== quote) throw new Error(`unterminated string in when clause: ${source}`);
      index += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (IDENT_START.test(char)) {
      let value = '';
      while (index < source.length && IDENT_PART.test(source[index])) {
        value += source[index];
        index += 1;
      }
      tokens.push({ kind: 'ident', value });
      continue;
    }
    throw new Error(`unexpected "${char}" in when clause: ${source}`);
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): Predicate {
    const predicate = this.parseOr();
    if (this.index !== this.tokens.length) throw new Error(`trailing tokens in when clause: ${this.source}`);
    return predicate;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private take(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new Error(`unexpected end of when clause: ${this.source}`);
    this.index += 1;
    return token;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token?.kind === 'op' && token.value === value;
  }

  private parseOr(): Predicate {
    let left = this.parseAnd();
    while (this.isOp('||')) {
      this.take();
      const right = this.parseAnd();
      const previous = left;
      left = (context) => previous(context) || right(context);
    }
    return left;
  }

  private parseAnd(): Predicate {
    let left = this.parseUnary();
    while (this.isOp('&&')) {
      this.take();
      const right = this.parseUnary();
      const previous = left;
      left = (context) => previous(context) && right(context);
    }
    return left;
  }

  private parseUnary(): Predicate {
    if (this.isOp('!')) {
      this.take();
      const inner = this.parseUnary();
      return (context) => !inner(context);
    }
    if (this.isOp('(')) {
      this.take();
      const inner = this.parseOr();
      if (!this.isOp(')')) throw new Error(`missing ")" in when clause: ${this.source}`);
      this.take();
      return inner;
    }
    return this.parseAtom();
  }

  private parseAtom(): Predicate {
    const token = this.take();
    if (token.kind !== 'ident') throw new Error(`expected a context key in when clause: ${this.source}`);
    const key = token.value;
    const operator = this.peek();
    if (operator?.kind === 'op' && (operator.value === '==' || operator.value === '!=')) {
      this.take();
      const valueToken = this.take();
      if (valueToken.kind !== 'ident' && valueToken.kind !== 'string') {
        throw new Error(`expected a value after "${operator.value}" in when clause: ${this.source}`);
      }
      const expected = valueToken.value;
      const negate = operator.value === '!=';
      return (context) => {
        const actual = context[key];
        const equal = actual !== undefined && String(actual) === expected;
        return negate ? !equal : equal;
      };
    }
    return (context) => Boolean(context[key]);
  }
}

const cache = new Map<string, Predicate>();

/** Compile a clause. Throws on a malformed expression — a caller that owns the
 *  string (the catalog, a plugin registration) should hear about it. */
export function compileWhen(expression: string): Predicate {
  const cached = cache.get(expression);
  if (cached) return cached;
  const predicate = new Parser(tokenize(expression), expression).parse();
  cache.set(expression, predicate);
  return predicate;
}

/**
 * Evaluate a clause, treating a malformed one as FALSE.
 *
 * The dispatcher runs on every keystroke and must not throw because a plugin
 * shipped a typo; the plugin's registration path validates the clause up front
 * so the typo is reported where it can be fixed.
 */
export function evaluateWhen(expression: string | undefined, context: CommandContext): boolean {
  if (!expression) return true;
  try {
    return compileWhen(expression)(context);
  } catch {
    return false;
  }
}
