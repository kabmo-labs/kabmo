#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A scripted `omp` RPC child that refuses to start a resume whose session
 * records a model it cannot restore — the way the real binary does.
 *
 * Measured on omp 18.13.1: `omp --resume <file>` restores the model the
 * session's last `model_change` entry names, and it does NOT fall back when
 * that model is gone. The child exits(1) with
 * `error: Could not restore model <provider>/<id>`, so EVERY command to that
 * session fails — the `set_model` a model change posts, the `get_state`
 * warmup, and the `prompt` alike.
 *
 * `--model <selector>` makes the resume start (verified against the real
 * binary), which is the lever Kabmo's spawn uses to recover.
 *
 * Two modes, chosen by argv:
 *   - `models --json --kind all` answers the catalog Kabmo reads to decide
 *     which models omp can still resolve (`FAKE_OMP_RESTORE_MODELS` is a
 *     comma-separated `provider/id` list).
 *   - otherwise it speaks the RPC wire like the other fixtures.
 *
 * It also appends every received ARGUMENT LIST to `FAKE_OMP_RESTORE_LOG`, so a
 * test can assert what Kabmo actually spawned (`--model` present or not)
 * instead of inferring it.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

/** The scripts' own `models` listing. */
if (argv[0] === 'models') {
  const listed = (process.env.FAKE_OMP_RESTORE_MODELS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((selector) => {
      const slash = selector.indexOf('/');
      const provider = slash > 0 ? selector.slice(0, slash) : '';
      const modelId = slash > 0 ? selector.slice(slash + 1) : selector;
      return { provider, id: modelId, kind: 'chat', name: modelId };
    });
  process.stdout.write(`\n${JSON.stringify({ models: listed })}\n`);
  process.exit(0);
}

const logPath = process.env.FAKE_OMP_RESTORE_LOG;
if (logPath) {
  try {
    appendFileSync(logPath, `${JSON.stringify(argv)}\n`);
  } catch {
    // Logging is a test convenience; never break the child.
  }
}

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.cwd(), '.fake-omp-restore');
const resume = flag('--resume');
const model = flag('--model');

// The failure under test: a resume WITHOUT an explicit model, over a session
// whose recorded model the catalog does not serve. The message is omp's own.
const restoreFailure = process.env.FAKE_OMP_RESTORE_FAILS === '1';
if (resume && restoreFailure && !model) {
  process.stderr.write('error: Could not restore model deepseek/deepseek-flash\n');
  process.exit(1);
}

const sessionId = resume
  ? (resume.split('/').pop() ?? '').replace(/\.jsonl$/, '')
  : crypto.randomUUID();
const sessionFile = resume ?? join(agentDir, 'sessions', `${sessionId}.jsonl`);
mkdirSync(dirname(sessionFile), { recursive: true });
writeFileSync(sessionFile, '');

const encoder = new TextEncoder();
const write = (frame: unknown) => {
  process.stdout.write(encoder.encode(`${JSON.stringify(frame)}\n`));
};

const respond = (id: unknown, command: string, data: unknown, success = true) => {
  write({ type: 'response', id, command, success, ...(success ? { data } : { error: 'fake' }) });
};

const state = () => ({
  sessionId,
  sessionFile,
  sessionName: 'Restore fixture',
  isStreaming: false,
  isSettled: true,
  isCompacting: false,
  autoCompactionEnabled: true,
  model: model
    ? {
        id: model.slice(model.indexOf('/') + 1),
        provider: model.slice(0, model.indexOf('/')),
        name: 'Restored',
        reasoning: false,
      }
    : { id: 'restored-model', provider: 'fake', name: 'Restored', reasoning: false },
  messageCount: 0,
  queuedMessageCount: 0,
  contextUsage: { tokens: 0, contextWindow: 100_000, percent: 0 },
  thinkingLevel: 'medium',
});

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
        respond(id, 'get_state', state());
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