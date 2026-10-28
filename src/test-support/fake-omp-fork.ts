#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A scripted `omp` RPC child for `bun test`, driven through the REAL spawn path.
 *
 * It exists for one question the registry's own unit tests cannot answer: what
 * happens when omp reports a session id DIFFERENT from the one that was resumed.
 * omp 18.10.0 does exactly that whenever the resumed session is marked moved
 * away — `forkIfMovedAway` forks it into a fresh file under a fresh id — so a
 * double `startRpcSession` against one session file is a real scenario, not a
 * contrived one.
 *
 * `FAKE_OMP_FORK_ON_RESUME=1` makes the child answer a `get_state` whose
 * `sessionId`/`sessionFile` are freshly minted, and write those to
 * `FAKE_OMP_FORK_LOG` (JSONL: one line per spawned child). A test can then count
 * the children a sequence of sends produced.
 *
 * Everything else is the minimum a spawn needs: `ready`, then a
 * `{type:'response'}` per command, with the attach-time configuration commands
 * acknowledged because Kabmo treats an error as best-effort.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.cwd(), '.fake-omp-fork');
const resume = flag('--resume');
const forkOnResume = process.env.FAKE_OMP_FORK_ON_RESUME === '1';

/** The id this child answers. A resumed session keeps its file's id UNLESS the
 *  fake is asked to fork, which is what omp 18.10.0 does for a moved session. */
const requestedId = resume ? (resume.split('/').pop() ?? '').replace(/\.jsonl$/, '') : '';
const sessionId = forkOnResume && resume ? crypto.randomUUID() : requestedId || crypto.randomUUID();
const sessionFile = forkOnResume && resume
  ? join(agentDir, 'sessions', `--forked--`, `${sessionId}.jsonl`)
  : resume ?? join(agentDir, 'sessions', `${sessionId}.jsonl`);

mkdirSync(dirname(sessionFile), { recursive: true });
writeFileSync(sessionFile, '');

const forkLog = process.env.FAKE_OMP_FORK_LOG;
if (forkLog) {
  try {
    appendFileSync(forkLog, `${JSON.stringify({ requestedId, sessionId, sessionFile, pid: process.pid })}\n`);
  } catch {
    // Recording is a test convenience; never let it break the child.
  }
}

const encoder = new TextEncoder();
const write = (frame: unknown) => {
  process.stdout.write(encoder.encode(`${JSON.stringify(frame)}\n`));
};

function getState() {
  return {
    sessionId,
    sessionFile,
    sessionName: 'Fake session',
    isStreaming: false,
    isSettled: true,
    isCompacting: false,
    autoCompactionEnabled: true,
    interruptMode: 'immediate',
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    messageCount: resume ? 1 : 0,
    model: {
      id: 'fake-model',
      provider: 'fake',
      name: 'Fake Model',
      reasoning: true,
      thinking: { efforts: ['low', 'medium', 'high'] },
    },
    thinkingLevel: 'medium',
    queuedMessages: { steering: [], followUp: [], liveSteered: 0 },
  };
}

const respond = (id: unknown, command: string, data: unknown, success = true) => {
  write({ type: 'response', id, command, success, ...(success ? { data } : { error: 'fake' }) });
};

const decoder = new TextDecoder();
let buffer = '';
const stdin = Bun.stdin.stream().getReader();

write({ type: 'ready', protocolVersion: 2 });

for (;;) {
  const { done, value } = await stdin.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf('\n');
    if (!line) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = frame.id;
    switch (frame.type) {
      case 'get_state':
        respond(id, 'get_state', getState());
        break;
      case 'get_available_models':
        respond(id, 'get_available_models', { models: [] });
        break;
      case 'get_login_providers':
        respond(id, 'get_login_providers', { providers: [] });
        break;
      case 'get_available_commands':
        respond(id, 'get_available_commands', { commands: [] });
        break;
      case 'set_event_filter':
      case 'set_ask_dialog':
      case 'set_subagent_subscription':
      case 'get_subagents':
        respond(id, String(frame.type), {});
        break;
      case 'prompt':
        respond(id, 'prompt', { agentInvoked: true });
        write({ type: 'agent_start' });
        write({ type: 'agent_end', isTerminal: true });
        break;
      default:
        respond(id, String(frame.type), {});
        break;
    }
  }
}
