// `kabmo session` — the agent-facing half of the console.
//
// Every command talks to the SAME HTTP routes the browser uses, with the
// per-session bearer token injected at spawn. No second API and no direct
// database access: an agent must be able to do exactly what a tab can.
//
// Usage:
//   kabmo session spawn --prompt-file - [--parent-self] [--harness <id>] [--json]
//   kabmo session fork <source-id> [--anchor-entry <id>] [--prompt-file -] [--json]
//   kabmo session tell <id> --message-file - [--json]
//   kabmo session relations <id> [--json]
//   kabmo session output <id> [--json]
//   kabmo session wait <id> [--timeout 600] [--json]

import { readFileSync } from 'node:fs';
import { fail, log, ok, printJson, isJson } from '@/cli/lib/output.js';

const SERVER_URL = () => Bun.env.KABMO_SERVER_URL || 'http://localhost:3000';
const AGENT_TOKEN = () => Bun.env.KABMO_AGENT_TOKEN || '';

function usage() {
  return `Usage: kabmo session <command> [options]

COMMANDS:
  spawn                       Create a child session (requires --prompt/-file)
  fork <source-id>            Branch a session at an entry (or its tip)
  tell <id>                   Send a prompt to a session
  relations <id>              Print the parent, children, forks and owner
  output <id>                 Print the session's last assistant answer
  wait <id>                   Wait until the session is idle (default 600s)

OPTIONS:
  --prompt <text>             First prompt (spawn/fork)
  --prompt-file <path>        Read it from a file; '-' reads stdin
  --message <text>            Message (tell)
  --message-file <path>       Read it from a file; '-' reads stdin
  --parent-self               Parent the new session to this agent's session
  --harness <id>              Harness for the child (omp-rpc, claude, codex, ...)
  --cwd <path>                Working directory (defaults to the parent's)
  --anchor-entry <id>         Fork at this entry instead of the tip
  --timeout <seconds>         wait's deadline (default 600)
  --json                      Machine-readable output
`;
}

function readText(options, inlineKey, fileKey) {
  const inline = options[inlineKey];
  const file = options[fileKey];
  if (inline && file) fail(`Use --${inlineKey} or --${fileKey}, not both.`);
  if (typeof inline === 'string') return inline;
  if (typeof file !== 'string') fail(`--${inlineKey} or --${fileKey} is required.`);
  if (file === '-') {
    // Bun.stdin.text() is the CLI's own stdin; `session spawn` is normally run
    // by an agent with a heredoc, never interactively.
    return Bun.stdin.text();
  }
  try {
    return readFileSync(file, 'utf8');
  } catch (cause) {
    fail(`Could not read ${file}: ${cause.message}`);
  }
}

async function call(path, init = {}) {
  const token = AGENT_TOKEN();
  let response;
  try {
    response = await fetch(`${SERVER_URL()}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    fail(`Could not reach Kabmo at ${SERVER_URL()}: ${cause.message}`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    fail(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return body;
}

async function spawn(options) {
  const prompt = await readText(options, 'prompt', 'prompt-file');
  const body = await call('/api/sessions/spawn', {
    method: 'POST',
    body: JSON.stringify({
      prompt: prompt.trim(),
      ...(options['parent-self'] ? { parentSelf: true } : {}),
      ...(options.harness ? { harness: options.harness } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
    }),
  });
  if (isJson()) return printJson(body);
  ok(`Spawned ${body.sessionId} (${body.harness}, depth ${body.depth})`);
  log(body.sessionId);
}

async function fork(options, sourceId) {
  if (!sourceId) fail('fork needs a source session id.');
  const prompt = options.prompt || options['prompt-file']
    ? (await readText(options, 'prompt', 'prompt-file')).trim()
    : '';
  const body = await call(`/api/sessions/${encodeURIComponent(sourceId)}/fork`, {
    method: 'POST',
    body: JSON.stringify({
      ...(options['anchor-entry'] ? { anchorEntryId: options['anchor-entry'] } : {}),
      ...(prompt ? { prompt } : {}),
    }),
  });
  if (isJson()) return printJson(body);
  ok(`Forked ${sourceId} → ${body.sessionId}`);
  log(body.sessionId);
}

async function tell(options, sessionId) {
  if (!sessionId) fail('tell needs a session id.');
  const message = (await readText(options, 'message', 'message-file')).trim();
  const body = await call(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    body: JSON.stringify({ type: 'prompt', message }),
  });
  if (isJson()) return printJson(body);
  ok(`Sent to ${sessionId}`);
}

async function relations(options, sessionId) {
  if (!sessionId) fail('relations needs a session id.');
  const body = await call(`/api/sessions/${encodeURIComponent(sessionId)}/relations`);
  if (isJson()) return printJson(body);
  log(`parent:      ${body.parent?.sessionId ?? '—'}`);
  log(`children:    ${body.children.map((row) => row.sessionId).join(', ') || '—'}`);
  log(`forks:       ${body.forks.map((row) => row.sessionId).join(', ') || '—'}`);
  log(`owner:       ${body.lifecycleOwner?.sessionId ?? '—'}`);
}

async function wait(options, sessionId) {
  if (!sessionId) fail('wait needs a session id.');
  const deadline = Date.now() + (Number(options.timeout ?? 600) * 1000);
  const interval = Number(Bun.env.KABMO_WAIT_INTERVAL_MS ?? 2000);
  let state = { running: true };
  while (Date.now() < deadline) {
    state = await call(`/api/agent/${encodeURIComponent(sessionId)}`);
    if (state?.running !== true) break;
    await Bun.sleep(interval);
  }
  if (state?.running === true) fail(`Timed out waiting for ${sessionId}.`);
  if (isJson()) return printJson(state);
  ok(`${sessionId} is idle`);
}

async function output(options, sessionId) {
  if (!sessionId) fail('output needs a session id.');
  const body = await call(`/api/chat/${encodeURIComponent(sessionId)}`);
  if (isJson()) return printJson(body);
  const messages = body?.session?.messages ?? [];
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant' || message.role === 'ai');
  if (assistant?.content) {
    log(assistant.content);
    return;
  }
  // ACP keeps its history with the agent; Kabmo stores the last closed answer
  // precisely so this command still has something to print.
  const stored = await call(`/api/sessions/${encodeURIComponent(sessionId)}/answer`);
  log(stored?.answer ?? 'No assistant answer recorded.');
}

export async function run(options) {
  const [subcommand, ...args] = options.args ?? [];
  if (!subcommand || options.help) {
    process.stdout.write(usage());
    return;
  }
  switch (subcommand) {
    case 'spawn':
      return spawn(options);
    case 'fork':
      return fork(options, args[0]);
    case 'tell':
      return tell(options, args[0]);
    case 'relations':
      return relations(options, args[0]);
    case 'output':
      return output(options, args[0]);
    case 'wait':
      return wait(options, args[0]);
    default:
      fail(`Unknown session command: ${subcommand}\n${usage()}`);
  }
}
