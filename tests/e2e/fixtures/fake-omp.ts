#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A scripted `omp` RPC child, for browser specs that need a real agent session
 * without a model.
 *
 * It is NOT a mock of the chamber's side of the protocol — it is a client of
 * omp's own wire protocol, so the code under test is the real thing: the
 * spawn path, the frame reader, `delta-accumulator.ts`, the frame fold, the
 * realtime topic, the timeline renderer. A test double that stubbed any of
 * those would test the double. This is the same argument AGENTS.md makes for
 * `test-support/realtime-server.ts` ("stubbing `WebSocket` would test the
 * fake's frame timing rather than the delivery contract") and it is the shape
 * `get-bb/bb`'s `scripted-echo-provider` takes.
 *
 * ## Prompt directives
 *
 * A prompt's text selects what the turn does. Anything unrecognised answers
 * `Response to: <prompt>`, so a spec that only cares about the happy path
 * sends any string.
 *
 *   `delay:<ms>`     hold the turn open before the answer streams
 *   `tool:<name>`    emit a `tool_execution_start/update/end` triple first
 *   `ask:<text>`     raise an `extension_ui_request` and wait for the reply
 *   `error:<text>`   fail the turn with a provider error
 *   `retry:<n>`      emit `auto_retry_start`/`auto_retry_end` around the turn
 *   `slow`           stream the answer one character at a time
 *
 * ## What it answers
 *
 * `ready`, then a `{type:'response'}` per command. `get_state` reports a fresh
 * session (messageCount 0, so the chamber's auto-title is eligible — the same
 * shape a real spawn has). `get_available_models` / `get_login_providers` /
 * `get_available_commands` answer small canned registries so the model picker
 * and the composer's `/` popup render. The attach-time configuration commands
 * (`set_event_filter`, `set_ask_dialog`, `set_subagent_subscription`) are
 * acknowledged, because the chamber sends them and treats an error as
 * best-effort.
 *
 * `FAKE_OMP_RECORD_PATH` appends every frame RECEIVED as JSONL, so a spec can
 * assert what the chamber actually sent (that the delta filter was requested,
 * that a `/reload-plugins` reached a live child) rather than inferring it.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assistantMessage, createFrameWriters, sleep } from './fake-omp-frames';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

/** The session file the child claims, under the agent dir the server reads. */
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.cwd(), '.fake-omp');
const resume = flag('--resume');

const sessionId = resume
  ? (resume.split('/').pop() ?? '').replace(/\.jsonl$/, '') || crypto.randomUUID()
  : crypto.randomUUID();
const sessionFile = resume ?? join(agentDir, 'sessions', `${sessionId}.jsonl`);

// omp writes the transcript as the run proceeds; a spec that reloads the page
// reads it back. Creating the file (and its parent) is what makes the session
// visible to the sidebar's scan.
mkdirSync(dirname(sessionFile), { recursive: true });
if (!resume) writeFileSync(sessionFile, '');

const encoder = new TextEncoder();
const write = (frame: unknown) => {
  process.stdout.write(encoder.encode(`${JSON.stringify(frame)}\n`));
};

const recordPath = process.env.FAKE_OMP_RECORD_PATH;
const record = (frame: unknown) => {
  if (!recordPath) return;
  try {
    appendFileSync(recordPath, `${JSON.stringify(frame)}\n`);
  } catch {
    // Recording is a test convenience; never let it break the child.
  }
};

let messageCount = resume ? 1 : 0;
let streaming = false;
/** Set while the chamber has requested delta-mode `message_update` frames. */
let deltaMode = false;

const { streamAnswer, streamToolCall } = createFrameWriters({ write, isDeltaMode: () => deltaMode });

const MODEL = {
  id: 'fake-model',
  provider: 'fake',
  name: 'Fake Model',
  reasoning: true,
  thinking: { efforts: ['low', 'medium', 'high'] },
};

function getState() {
  return {
    sessionId,
    sessionFile,
    sessionName: 'Fake session',
    isStreaming: streaming,
    isSettled: !streaming,
    isCompacting: false,
    autoCompactionEnabled: true,
    interruptMode: 'immediate',
    steeringMode: 'all',
    followUpMode: 'all',
    model: MODEL,
    messageCount,
    queuedMessageCount: 0,
    contextUsage: { tokens: 120, contextWindow: 200_000, percent: 0 },
    thinkingLevel: 'medium',
  };
}

const AVAILABLE_MODELS = [
  { id: 'fake-model', name: 'Fake Model', provider: 'fake', reasoning: true, contextWindow: 200_000, maxTokens: 8_192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
];

const LOGIN_PROVIDERS = [
  { id: 'fake', name: 'Fake Provider', authenticated: true, kind: 'apiKey' },
];

const AVAILABLE_COMMANDS = [
  { name: 'usage', description: 'Show token usage', hint: '' },
  { name: 'compact', description: 'Compact the conversation', hint: '' },
];

/** The whole turn: everything a `prompt` produces on the wire. */
async function runTurn(prompt: string, requestId: string) {
  streaming = true;
  const delay = /delay:(\d+)/.exec(prompt);
  const tool = /tool:([\w.-]+)/.exec(prompt);
  const ask = /ask:(.+)/.exec(prompt);
  const error = /error:(.+)/.exec(prompt);
  const retry = /retry:(\d+)/.exec(prompt);
  const slow = prompt.includes('slow');

  write({ type: 'agent_start' });

  if (retry) {
    const attempts = Number(retry[1]);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      write({ type: 'auto_retry_start', attempt, maxAttempts: attempts, delayMs: 50, errorMessage: 'provider hiccup' });
      await sleep(50);
      write({ type: 'auto_retry_end', attempt, success: attempt === attempts });
    }
  }

  if (delay) await sleep(Number(delay[1]));
  if (tool) await streamToolCall(tool[1]);
  if (ask) {
    const requestId2 = `ui-${crypto.randomUUID().slice(0, 8)}`;
    write({ type: 'extension_ui_request', requestId: requestId2, method: 'ask', questions: [{ id: 'q1', question: ask[1].trim(), options: [{ label: 'Yes' }, { label: 'No' }], multi: false }] });
  }

  const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  if (error) {
    const failed = assistantMessage('', 'error');
    write({ type: 'message_start', messageId, message: { ...failed, errorMessage: error[1].trim() } });
    write({ type: 'message_end', messageId, message: { ...failed, errorMessage: error[1].trim() } });
  } else {
    const text = `Response to: ${prompt}`;
    if (slow) {
      for (const char of text) {
        write({
          type: 'message_update',
          messageId,
          message: { role: 'assistant' },
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: char, partial: assistantMessage(text) },
        });
        await sleep(30);
      }
      const full = assistantMessage(text);
      write({ type: 'message_start', messageId, message: full });
      write({ type: 'message_end', messageId, message: full });
      write({ type: 'turn_end', message: full, toolResults: [] });
    } else {
      await streamAnswer(messageId, text);
    }
  }

  messageCount += 2;
  streaming = false;
  const messages = [assistantMessage('Response')];
  write({ type: 'agent_end', messages, isTerminal: true });
  // The completion frame omp sends for a prompt that opened a turn.
  write({ type: 'prompt_result', requestId, agentInvoked: true });
}

function handleCommand(frame: Record<string, unknown>) {
  const type = String(frame.type ?? '');
  const id = frame.id as string | undefined;
  const respond = (data: unknown, success = true, error?: string) => {
    write({ type: 'response', id, command: type, success, ...(success ? { data } : { error: error ?? 'failed' }) });
  };

  switch (type) {
    case 'negotiate_protocol':
      respond({ protocolVersion: frame.protocolVersion });
      return;
    case 'get_state':
      respond(getState());
      return;
    case 'get_available_models':
      respond({ models: AVAILABLE_MODELS });
      return;
    case 'get_login_providers':
      respond({ providers: LOGIN_PROVIDERS });
      return;
    case 'get_available_commands':
      respond({ commands: AVAILABLE_COMMANDS });
      return;
    case 'set_event_filter':
      deltaMode = frame.messageUpdates === 'delta';
      respond({});
      return;
    case 'set_ask_dialog':
    case 'set_subagent_subscription':
    case 'set_model':
    case 'set_thinking_level':
    case 'set_access_mode':
      respond({});
      return;
    case 'get_subagents':
      respond({ subagents: [] });
      return;
    case 'prompt': {
      // Acknowledge the admission first, then run the turn — the order omp uses.
      respond({ agentInvoked: true });
      const message = typeof frame.message === 'string' ? frame.message : '';
      // The chamber fires `/rename` in the background for the auto-title; answer
      // it on the `command_output` frame it reads.
      if (message.trim().startsWith('/rename')) {
        write({ type: 'command_output', output: 'Session renamed to Fake session' });
        write({ type: 'prompt_result', agentInvoked: false });
        return;
      }
      void runTurn(message, String(id));
      return;
    }
    case 'abort':
    case 'force_reset':
      respond({});
      return;
    default:
      respond({});
  }
}

write({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1] });

// `process.stdin` rather than `Bun.stdin`: the shebang runs this under Bun, but
// the fixture project is typed for Node, and reading the Node stream keeps the
// file inside that program's types with no `/// <reference>` escape.
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line.trim()) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    record(frame);
    handleCommand(frame);
  }
});
process.stdin.on('end', () => process.exit(0));
