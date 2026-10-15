/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Language detection for the highlighter: which Shiki grammar a path maps to,
 * and whether a block of text looks like code at all.
 *
 * Both are pure string predicates over the input, with no highlighter state, so
 * they live beside the tokenizer rather than inside it — the tokenizer needs a
 * booted Shiki instance, these do not, and a caller that only wants to pick a
 * language (a tool card deciding whether to render a code surface) does not
 * have to pull one in.
 */

import { stripReadSelector } from '@/shared/lib/fs/paths';

/**
 * Map a path to a Shiki language id.
 *
 * `text` is the answer for a path that names no language: an extensionless
 * file (`src/bin/run`), an internal URL (`xd://eval/browser`, `skill://diagnose`,
 * `omp://`), a web URL, or no path at all. It was `javascript`, which is a
 * claim, not a default — a device-docs read was badged `JAVASCRIPT` and its
 * prose was tokenized as code. `text` is a Shiki SPECIAL language (always
 * loaded, no grammar fetched) and `highlightCode`/`highlightLines` emit it
 * escaped and uncoloured, which is what omp's own reader does for the same
 * input (`getLanguageFromPath('xd://…')` is `undefined` there).
 *
 * The read-tool SELECTOR comes off first (`stripReadSelector`). A `read` may
 * name its lines on the path itself (`Read.tsx:205-215:raw`), and reading the
 * extension off the raw string gave `tsx:205-215:raw` — an unknown extension,
 * so `text`, so an unhighlighted code surface. Only a `:N-M` suffix used to be
 * stripped; `:raw`, `:img` and comma lists were not.
 */
export function getLanguageFromPath(filePath?: string): string {
  if (!filePath) return 'text';
  const clean = stripReadSelector(filePath);
  const ext = clean.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs': return 'javascript';
    case 'jsx': return 'jsx';
    case 'json': return 'json';
    case 'md':
    case 'markdown': return 'markdown';
    case 'css': return 'css';
    case 'sh':
    case 'bash':
    case 'zsh': return 'bash';
    case 'diff':
    case 'patch': return 'diff';
    case 'yaml':
    case 'yml': return 'yaml';
    case 'html': return 'html';
    case 'svg':
    case 'xml': return 'xml';
    case 'py': return 'python';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'sql': return 'sql';
    case 'toml': return 'toml';
    case 'java': return 'java';
    case 'c':
    case 'h': return 'c';
    case 'cpp':
    case 'cc':
    case 'hpp': return 'cpp';
    case 'cs': return 'csharp';
    case 'rb': return 'ruby';
    case 'php': return 'php';
    case 'kt':
    case 'kts': return 'kotlin';
    case 'swift': return 'swift';
    case 'scala': return 'scala';
    case 'lua': return 'lua';
    case 'pl': return 'perl';
    case 'dockerfile': return 'dockerfile';
    case 'ini':
    case 'cfg':
    case 'conf': return 'ini';
    case 'properties': return 'properties';
    case 'env': return 'bash';
    case 'zig': return 'zig';
    case 'ex':
    case 'exs': return 'elixir';
    case 'dart': return 'dart';
    case 'ml':
    case 'mli': return 'ocaml';
    case 'hs': return 'haskell';
    case 'nix': return 'nix';
    case 'tf':
    case 'tfvars':
    case 'hcl': return 'hcl';
    case 'graphql':
    case 'gql': return 'graphql';
    case 'sol': return 'solidity';
    case 'r': return 'r';
    case 'jl': return 'julia';
    case 'erl': return 'erlang';
    case 'clj':
    case 'cljs':
    case 'cljc':
    case 'edn': return 'clojure';
    case 'scm':
    case 'ss': return 'scheme';
    case 'rkt': return 'racket';
    case 'proto': return 'protobuf';
    case 'makefile':
    case 'mk': return 'makefile';
    case 'ps1':
    case 'psm1': return 'powershell';
    case 'json5': return 'json5';
    case 'less': return 'less';
    case 'scss': return 'scss';
    case 'sass': return 'sass';
    case 'styl': return 'stylus';
    case 'vue': return 'vue';
    case 'svelte': return 'svelte';
    case 'astro': return 'astro';
    // `.m` is genuinely ambiguous (Objective-C vs MATLAB); map to Objective-C,
    // the common editor default.
    case 'mm':
    case 'm': return 'objective-c';
    case 'groovy':
    case 'gvy':
    case 'gradle': return 'groovy';
    default: return 'text';
  }
}

/**
 * The patterns `isCodeLike` probes, at module scope.
 *
 * A regex *literal* inside the function body constructs a fresh `RegExp` on
 * every call, and this runs per render from the notice, task-result and Bash
 * cards. Compiled once here instead.
 */
const CODE_PATTERNS = [
  /^(?:import|export)\s+.+from\s+['"][^'"]+['"]/m,
  /^(?:const|let|var|function|class|interface|type|enum)\s+[A-Za-z0-9_$]+/m,
  /(?:=>|\bconsole\.(?:log|error|warn)|return\s+|async\s+function)/,
  /^\s*\d+:\s*(?:import|const|let|function|\/\/|\/\*|<|[A-Za-z])/m,
  /^\s*\[[A-Za-z0-9_./-]+\.[a-zA-Z0-9]+\]\s*\n\d+:/m,
] as const;

/** Check if a string looks like code or structured programming text */
export function isCodeLike(text: string): boolean {
  if (!text || text.length < 5) return false;
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // not valid JSON
    }
  }

  return CODE_PATTERNS.some((pattern) => pattern.test(trimmed));
}
