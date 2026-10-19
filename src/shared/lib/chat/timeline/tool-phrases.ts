/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phrase data for the generating indicator: the tool-name → activity-word
 * tables and the per-tool subject extraction that names the call's object
 * (path, command, pattern, agent, …).
 *
 * Data-only sibling of `tool-verbs.ts`, which owns the resolution logic
 * (streaming event → phrase). Canonical tool names are omp's builtin list
 * (`@oh-my-pi/pi-coding-agent` tools/builtin-names.ts).
 */

import { isRecord } from '@/shared/lib/util/guards';
import { hashlineTargetPath } from '@/shared/lib/omp/session/hashline-patch';

/** Longest subject kept in the indicator; the tail is elided. */
export const MAX_SUBJECT = 72;

/**
 * Tool name → phrase stem. Every stem is a complete activity on its own, so a
 * call whose arguments are not known yet (or never arrive) still reads as
 * `Writing` rather than a dangling `Writing`. When a subject exists it is
 * appended after a space and carries its own connector (`for "pat"`,
 * `· init`), which keeps the join uniform.
 */
export const TOOL_VERBS: Record<string, string> = {
  read: 'Reading',
  write: 'Writing',
  edit: 'Editing',
  ast_edit: 'Rewriting AST',
  ast_grep: 'Searching AST',
  bash: 'Running',
  grep: 'Searching',
  glob: 'Finding',
  task: 'Delegating',
  todo: 'Updating plan',
  hub: 'Hub',
  proc: 'Supervising',
  eval: 'Running code',
  lsp: 'Running LSP',
  debug: 'Debugging',
  github: 'GitHub',
  web_search: 'Searching the web',
  ask: 'Asking you',
  checkpoint: 'Checkpointing',
  rewind: 'Rewinding',
  context_notes: 'Updating context notes',
  new_context: 'Starting a fresh context',
  security_scan: 'Scanning for vulnerabilities',
  manage_skill: 'Updating skill',
  learn: 'Recording a lesson',
  retain: 'Retaining memory',
  recall: 'Recalling memory',
  reflect: 'Reflecting',
  think: 'Thinking',
  yield: 'Wrapping up',
  goal: 'Tracking goal',
};

/** Legacy Kabmo/MOCK tool aliases → canonical omp builtin name. */
export const TOOL_ALIASES: Record<string, string> = {
  read_file: 'read',
  view_file: 'read',
  read_file_content: 'read',
  edit_file: 'edit',
  replace_file_content: 'edit',
  multi_edit_file: 'edit',
  write_to_file: 'write',
  create_file: 'write',
  search_fs: 'grep',
  terminal: 'bash',
  run_command: 'bash',
};

/** `xd://<device>` write phrases — the device, not `write`, names the action. */
export const DEVICE_VERBS: Record<string, string> = {
  lsp: 'Running LSP',
  ast_edit: 'Rewriting AST',
  ast_grep: 'Searching AST',
  resolve: 'Applying edit proposal',
  reject: 'Discarding edit proposal',
  report_issue: 'Reporting tool issue',
  debug: 'Debugging',
  browser: 'Driving the browser',
};

/**
 * Phrase shown while the model streams reasoning or prose rather than running a
 * tool. A tool call always names itself from its own name (see
 * `describeAssistantPhase`), so there is no in-between "preparing" state.
 *
 * `sideQuestion` is the BTW panel's FALLBACK phase, used only before the side
 * child has reported anything: once it does, the panel shows the child's own
 * per-phase verb (`Thinking`, `Writing response`, or the running tool's name).
 * It is named for the feature rather than reusing `thinking`, which would claim
 * a reasoning phase that has not been observed yet.
 */
export const PHASE_VERBS = {
  thinking: 'Thinking',
  writing: 'Writing response',
  sideQuestion: 'Answering side question',
} as const;

export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** First string found for any key; array values yield their first string. */
export function pick(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    const direct = asString(value);
    if (direct) return direct;
    if (Array.isArray(value)) {
      const first = value.find((entry) => asString(entry) !== undefined);
      if (first !== undefined) return asString(first);
    }
  }
  return undefined;
}

export function truncate(value: string): string {
  return value.length <= MAX_SUBJECT ? value : `${value.slice(0, MAX_SUBJECT - 1)}…`;
}

function quote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^["'`]/.test(value) ? value : `"${value}"`;
}

function taskSubject(args: Record<string, unknown>): string | undefined {
  const name = asString(args.name);
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const first = tasks.find(isRecord);
  const label = name ?? (first ? asString(first.name) : undefined);
  const agent = asString(args.agent) ?? (first ? asString(first.agent) : undefined);
  if (label && agent) return `to ${label} (${agent})`;
  if (label) return `to ${label}`;
  return agent ? `to ${agent}` : undefined;
}

function askSubject(args: Record<string, unknown>): string | undefined {
  const questions = Array.isArray(args.questions) ? args.questions : [];
  const first = questions.find(isRecord);
  if (!first) return undefined;
  return asString(first.header) ?? asString(first.question);
}

function retainSubject(args: Record<string, unknown>): string | undefined {
  const items = Array.isArray(args.items) ? args.items : [];
  const first = items.find(isRecord);
  return first ? quote(asString(first.content)) : undefined;
}

/**
 * Subject appended to the tool's stem. Each case owns whatever connector its
 * stem needs (`for "pat"`, `to SidebarFix`, `· init`), so the caller joins with
 * a bare space and the stem alone is always a valid phrase.
 */
export function subjectFor(name: string, args: Record<string, unknown>): string | undefined {
  switch (name) {
    case 'read':
    case 'write':
    case 'edit':
      // omp's hashline `edit` has no `path` argument — the file lives in the
      // patch header, so the phrase would otherwise degrade to the bare intent.
      return pick(args, ['path', 'file', 'AbsolutePath', 'TargetFile']) ?? hashlineTargetPath(args);
    case 'ast_edit':
      return pick(args, ['paths', 'path']);
    case 'ast_grep': {
      const pattern = quote(pick(args, ['pat']));
      return pattern ? `for ${pattern}` : undefined;
    }
    case 'bash':
      return pick(args, ['command', 'cmd', 'CommandLine']);
    case 'grep': {
      const pattern = pick(args, ['pattern']);
      const scope = pick(args, ['path', 'paths']);
      if (!pattern) return scope;
      return scope ? `for ${quote(pattern)} in ${scope}` : `for ${quote(pattern)}`;
    }
    case 'glob':
      return pick(args, ['path', 'pattern']);
    case 'web_search': {
      const query = quote(pick(args, ['query']));
      return query ? `for ${query}` : undefined;
    }
    case 'task':
      return taskSubject(args);
    case 'hub':
    case 'proc':
      return [pick(args, ['op']), pick(args, ['name', 'id'])].filter(Boolean).join(' ') ||
        pick(args, ['path'])?.replace(/^proc:\/\//, '') ||
        undefined;
    case 'todo': {
      const op = pick(args, ['op']);
      // `·` (not `:`) — the caller joins with a space, so a leading colon would
      // render as "Updating plan : init".
      return op ? `· ${op}` : undefined;
    }
    case 'eval': {
      const language = pick(args, ['language']);
      return language ? `in ${language}` : undefined;
    }
    case 'lsp':
      return [pick(args, ['action']), pick(args, ['symbol', 'file'])].filter(Boolean).join(' ') || undefined;
    case 'debug':
      return pick(args, ['action', 'program']);
    case 'github':
      return [pick(args, ['op']), pick(args, ['repo', 'pr', 'query'])].filter(Boolean).join(' ') || undefined;
    case 'ask':
      return askSubject(args);
    case 'checkpoint':
      return pick(args, ['goal']);
    case 'manage_skill':
      return pick(args, ['name']);
    case 'recall':
      return quote(pick(args, ['query']));
    case 'reflect': {
      const query = quote(pick(args, ['query']));
      return query ? `on ${query}` : undefined;
    }
    case 'security_scan':
      return pick(args, ['target_kind', 'include_paths']);
    case 'retain':
      return retainSubject(args);
    default:
      return pick(args, ['path', 'command', 'query', 'pattern', 'name', 'target', 'prose']);
  }
}
