/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A scripted ACP agent that answers `initialize` and `session/delete`.
 *
 * The delete flow now asks the agent to remove its own session, and a suite
 * must not reach the developer's installed `opencode`/`claude` — that would
 * delete real history, or fail on CI where nothing is installed. This child is
 * the agent's half of the wire: it advertises `sessionCapabilities.delete`
 * unless `FAKE_ACP_DELETE_CAP=0`, and records every deleted id in
 * `FAKE_ACP_DELETE_LOG` so a test can assert what crossed the pipe.
 *
 * The source MUST stay constant: `executableStub` caches the compiled binary by
 * content, and a baked per-run path would rebuild ~90 MB on every run. The log
 * destination is therefore an environment variable.
 */

import { executableStub } from '@/test-support/executable-stub';

export const FAKE_ACP_DELETE_SOURCE = `#!/usr/bin/env bun
const encoder = new TextEncoder();
const write = (frame) => process.stdout.write(encoder.encode(JSON.stringify(frame) + '\\n'));
const capabilities = process.env.FAKE_ACP_DELETE_CAP === '0'
  ? {}
  : { sessionCapabilities: { delete: {} } };
const log = process.env.FAKE_ACP_DELETE_LOG;

const answer = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, message) => write({ jsonrpc: '2.0', id, error: { code: -32601, message } });

const decoder = new TextDecoder();
let buffer = '';
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  let index = buffer.indexOf('\\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\\n');
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.method === 'initialize') {
      answer(frame.id, { protocolVersion: 1, agentCapabilities: capabilities, agentInfo: { name: 'fake-acp', version: '0.0' } });
    } else if (frame.method === 'session/delete') {
      if (log) {
        const previous = await Bun.file(log).text().catch(() => '');
        await Bun.write(log, previous + frame.params.sessionId + '\\n');
      }
      answer(frame.id, {});
    } else {
      fail(frame.id, 'not implemented');
    }
  }
}
`;

/** The compiled fake agent. */
export function fakeAcpDeleteAgent(): Promise<string> {
  return executableStub(FAKE_ACP_DELETE_SOURCE, 'fake-acp-delete');
}
