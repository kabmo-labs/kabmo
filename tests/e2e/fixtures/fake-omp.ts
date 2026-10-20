#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A scripted `omp` RPC child, for browser specs that need a real agent session
 * without a model.
 *
 * It is NOT a mock of Kabmo's side of the protocol — it is a client of
 * omp's own wire protocol, so the code under test is the real thing: the
 * spawn path, the frame reader, the frame fold, the realtime topic, the
 * timeline renderer. A test double that stubbed any of
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
 *   `wait:<seconds>` block on a background job for that long, re-emitting its
 *                    `CoordinationDetails` snapshot every 500 ms (the real
 *                    `wait` tool's progress frames)
 *   `ask:<text>`     raise an `extension_ui_request` and wait for the reply
 *   `orphan-ask:<text>` the same dialog with NO tool call behind it — what a
 *                    subagent or an extension's own `askDialog` produces, so
 *                    the card cannot exist and the timeline must draw it
 *   `error:<text>`   fail the turn with a provider error
 *   `retry:<n>`      emit `auto_retry_start`/`auto_retry_end` around the turn
 *   `slow`           stream the answer one character at a time
 *
 * ## What it answers
 *
 * `ready`, then a `{type:'response'}` per command. `get_state` reports a fresh
 * session (messageCount 0, so Kabmo's auto-title is eligible — the same
 * shape a real spawn has). `get_available_models` / `get_login_providers` /
 * `get_available_commands` answer small canned registries so the model picker
 * and the composer's `/` popup render. The attach-time configuration commands
 * (`set_event_filter`, `set_ask_dialog`, `set_subagent_subscription`) are
 * acknowledged, because Kabmo sends them and treats an error as
 * best-effort.
 *
 * `FAKE_OMP_RECORD_PATH` appends every frame RECEIVED as JSONL, so a spec can
 * assert what Kabmo actually sent (that the event filter was requested,
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

/**
 * The session file, under the layout both omp and Kabmo read:
 * `<sessions>/<project-dir>/<file>.jsonl`, with a `{"type":"session"}` header
 * carrying the id.
 *
 * The directory NAME is not load-bearing — Kabmo's scan walks one level
 * under the sessions root and takes each file's id from its header — but the
 * DEPTH and the header are. A fixture that wrote `<sessions>/<file>.jsonl` with
 * no header left every session lookup 404ing (measured: `rename-with-ai`
 * answered "Session not found" for a session the sidebar was rendering), which
 * is what a real omp install never produces.
 */
const cwd = flag('--cwd') ?? process.cwd();
const sessionFile = resume ?? join(agentDir, 'sessions', 'project', `${sessionId}.jsonl`);

// omp writes the transcript as the run proceeds; a spec that reloads the page
// reads it back. Creating the file (and its parent) is what makes the session
// visible to the sidebar's scan.
mkdirSync(dirname(sessionFile), { recursive: true });
if (!resume) {
  writeFileSync(sessionFile, `${JSON.stringify({
    type: 'session',
    version: 3,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd,
  })}\n`);
}

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
/** The title `get_state` reports; `/rename` replaces it, the way omp does. */
let sessionName = 'Fake session';
/** How long `/rename` takes to answer. A real generation is a model call;
 *  this keeps the in-flight window wide enough for a spec to observe. */
const RENAME_DELAY_MS = 600;

const { streamAnswer, streamToolCall, streamWait, streamWaitLimit } = createFrameWriters({ write });

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
    sessionName,
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
  // The command a `tool:` call carries. Long on purpose in the indicator specs:
  // the phrase has to overflow the composer row for truncation to be observable.
  const cmd = /cmd:(.+)/.exec(prompt);
  const wait = /wait:(\d+)/.exec(prompt);
  const waitLimit = prompt.includes('waitcap');
  const ask = /ask:(.+)/.exec(prompt);
  // A grouped ask with no tool call behind it — what a subagent or an
  // extension's own `askDialog` produces. The card cannot exist, so the dialog
  // must render inline rather than as the empty modal it used to.
  const orphanAsk = /orphan-ask:(.+)/.exec(prompt);
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
  if (waitLimit) await streamWaitLimit();
  else if (wait) await streamWait(Number(wait[1]));
  if (tool) await streamToolCall(tool[1], cmd?.[1].trim());
  // `orphan-ask:` contains `ask:`, so the cardless form is tested FIRST.
  if (orphanAsk) await runAsk(orphanAsk[1].trim(), false);
  else if (ask) await runAsk(ask[1].trim());

  const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  if (error) {
    const failed = assistantMessage('', 'error', messageId);
    write({ type: 'message_start', messageId, message: { ...failed, errorMessage: error[1].trim() } });
    write({ type: 'message_end', messageId, message: { ...failed, errorMessage: error[1].trim() } });
  } else {
    const text = `Response to: ${prompt}`;
    if (slow) {
      const full = assistantMessage(text, 'end_turn', messageId);
      write({ type: 'message_start', messageId, message: full });
      for (const [index, char] of [...text].entries()) {
        const accumulated = text.slice(0, index + 1);
        write({
          type: 'message_update',
          messageId,
          message: { ...full, content: [{ type: 'text', text: accumulated }] },
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: char, partial: full },
        });
        await sleep(30);
      }
      write({ type: 'message_end', messageId, message: full });
      write({ type: 'turn_end', message: full, toolResults: [] });
    } else {
      await streamAnswer(messageId, text);
    }
  }

  messageCount += 2;
  streaming = false;
  const messages = [assistantMessage('Response', 'end_turn', `${messageId}-end`)];
  write({ type: 'agent_end', messages, isTerminal: true });
  // The completion frame omp sends for a prompt that opened a turn.
  write({ type: 'prompt_result', requestId, agentInvoked: true });
}

/** One answer of a grouped `ask` reply, as omp's response frame spells it. */
interface AskAnswer {
  id: string;
  selectedOptions: string[];
  customInput?: string;
}

/** The grouped asks the child is parked on, keyed by the request id omp uses. */
const pendingAsks = new Map<string, (answers: AskAnswer[]) => void>();

/**
 * The real `ask` tool shape, which is what the inline card exists for.
 *
 * The assistant message carries the `ask` toolCall block (a card is drawn from
 * the MESSAGE — `tool_execution_*` frames alone render nothing), the child then
 * parks on the grouped `extension_ui_request` (`method:"ask"`, keyed by `id`,
 * exactly as omp keys it) and BLOCKS until the matching response arrives, and
 * only then writes the tool result the card reads its answers back from. A
 * fixture that skipped the block or the wait would leave the card unrenderable
 * or the post-submit window untestable — the two things a spec needs here.
 */
async function runAsk(text: string, withCard = true) {
  const callId = `call-${crypto.randomUUID().slice(0, 8)}`;
  const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  const questions = [
    {
      id: 'q1',
      question: text,
      options: [
        { label: 'Yes', description: 'Go ahead with it' },
        { label: 'No', description: 'Leave it alone' },
      ],
      multi: false,
    },
    {
      id: 'q2',
      question: `${text} — which ones?`,
      options: [
        { label: 'Alpha', description: 'The first one' },
        { label: 'Beta', description: 'The second one' },
      ],
      multi: true,
    },
  ];
  const args = { questions };
  if (withCard) {
    const block = { type: 'toolCall', id: callId, name: 'ask', arguments: args, partialArgs: JSON.stringify(args), streamIndex: 0 };
    const message = { ...assistantMessage('', 'toolUse', messageId), content: [block] };

    write({ type: 'message_start', messageId, message });
    write({ type: 'message_end', messageId, message });
    write({ type: 'turn_end', message, toolResults: [] });

    write({ type: 'tool_execution_start', toolCallId: callId, toolName: 'ask', args });
  }
  const uiRequestId = `ui-${crypto.randomUUID().slice(0, 8)}`;
  const answers = await new Promise<AskAnswer[]>((resolve) => {
    pendingAsks.set(uiRequestId, resolve);
    write({ type: 'extension_ui_request', id: uiRequestId, method: 'ask', questions });
  });

  // A cardless ask (a subagent's, an extension's own `askDialog`) writes no
  // tool result — there is no tool call to write one for. The dialog is the
  // whole interaction, and its answer is what unblocks the child.
  if (!withCard) return;

  const text2 = answers
    .map((answer) => `${answer.id}: ${answer.customInput ?? answer.selectedOptions.join(', ')}`)
    .join('\n');
  write({
    type: 'tool_execution_end',
    toolCallId: callId,
    toolName: 'ask',
    result: {
      content: [{ type: 'text', text: `User answers:\n${text2}` }],
      details: {
        results: questions.map((question, index) => {
          const answer = answers[index] ?? { selectedOptions: [] };
          return {
            id: question.id,
            question: question.question,
            options: question.options.map((option) => option.label),
            multi: question.multi,
            selectedOptions: answer.selectedOptions,
            ...(answer.customInput ? { customInput: answer.customInput } : {}),
          };
        }),
      },
      isError: false,
    },
    isError: false,
  });
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
      // The Kabmo fires `/rename` in the background for the auto-title, and
      // on demand for "Rename with AI". Real omp answers with
      // `session_info_update` (the new title) and THEN `command_output` — and
      // the rename route's verdict is which of the two arrives, so a fixture
      // that only sent the output would report every rename as a refusal.
      //
      // The pause is what makes the in-flight window observable: a real title
      // generation is a model call of a few seconds, and a spec asserting the
      // spinner needs the request to still be outstanding when it looks.
      if (message.trim().startsWith('/rename')) {
        void (async () => {
          await sleep(RENAME_DELAY_MS);
          sessionName = 'Fake session';
          write({ type: 'session_info_update', sessionId, title: sessionName });
          write({ type: 'command_output', output: 'Session renamed to Fake session' });
          write({ type: 'prompt_result', agentInvoked: false });
        })();
        return;
      }
      // Kabmo's own `/kabmo-mode …` control channel (the Plan/Goal toggles,
      // the plan-review republish); `/chamber-mode` is the pre-rename spelling
      // and is honoured too. Real omp executes it in the Kabmo-owned extension
      // and answers `agentInvoked:false` with NO
      // assistant message — it costs no transcript. A fixture that ran it as a
      // full turn opened a SECOND concurrent run beside the operator's, and
      // that stray run's `message_end` cleared the first run's AI placeholder
      // ref mid-turn: the ask card's own message then got APPENDED beside the
      // placeholder and a later coalesced update mapped the placeholder onto it,
      // rendering the turn (and its ask card) TWICE. Measured: ~1 run in 30,
      // with two cards for one ask — one "Running", one "Done".
      if (/^\/(kabmo|chamber)-mode\b/.test(message.trim())) {
        respond({ agentInvoked: false });
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
    case 'extension_ui_response': {
      // The reply to a parked dialog. A grouped `ask` is answered by ONE
      // `answers` array; the child only then writes the tool result, which is
      // the window the card must keep showing what it sent in.
      const targetId = typeof frame.id === 'string' ? frame.id : '';
      const resolve = pendingAsks.get(targetId);
      if (!resolve) return;
      pendingAsks.delete(targetId);
      resolve(Array.isArray(frame.answers) ? (frame.answers as AskAnswer[]) : []);
      return;
    }
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
