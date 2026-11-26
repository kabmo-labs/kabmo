/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The transcript a server-spawned ACP child writes for itself.
 *
 * The bug this pins: an orchestration worker has no tab, so the client never
 * wrote `chat_sessions`; the loader answered an empty timeline. The recorder
 * folds the frames the driver already receives into `acp_transcripts`, and the
 * loader reads that table when the client's row is empty.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@kabmo-labs/kabmo-db/lifecycle';
import {
  AcpTranscriptRecorder,
  loadAcpTranscript,
} from './session-transcript.server';

const SESSION = 'child-1';

function assistantMessage(id: string, content: unknown[]): Record<string, unknown> {
  return { id, role: 'assistant', timestamp: 2, content };
}

describe('AcpTranscriptRecorder', () => {
  beforeEach(async () => {
    await isolateDb();
  });

  afterEach(async () => {
    await releaseDb();
  });

  test('records the prompt and the assistant answer, and the loader reads them back', async () => {
    const recorder = new AcpTranscriptRecorder(() => SESSION);
    recorder.recordPrompt('do the task');
    recorder.record({
      type: 'message_end',
      message: assistantMessage('a1', [{ type: 'text', text: 'done' }]),
    });
    await recorder.flush();

    const rows = await loadAcpTranscript(SESSION);
    expect(rows.map((row) => row.role)).toEqual(['user', 'ai']);
    expect(rows[0]?.content).toBe('do the task');
    expect(rows[1]?.content).toBe('done');
  });

  test('pairs a tool result onto the call that owns it', async () => {
    const recorder = new AcpTranscriptRecorder(() => SESSION);
    recorder.recordPrompt('list files');
    recorder.record({
      type: 'message_end',
      message: assistantMessage('a1', [
        { type: 'text', text: 'checking' },
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
      ]),
    });
    recorder.record({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      output: 'file.txt',
      result: { content: [{ type: 'text', text: 'file.txt' }] },
    });
    await recorder.flush();

    const rows = await loadAcpTranscript(SESSION);
    const call = rows[1]?.toolCalls?.[0];
    expect(call?.id).toBe('c1');
    expect(call?.output).toBe('file.txt');
    expect(call?.status).toBe('success');
  });

  test('a second turn appends instead of replacing the first', async () => {
    const recorder = new AcpTranscriptRecorder(() => SESSION);
    recorder.recordPrompt('first');
    recorder.record({
      type: 'message_end',
      message: assistantMessage('a1', [{ type: 'text', text: 'one' }]),
    });
    recorder.recordPrompt('second');
    recorder.record({
      type: 'message_end',
      message: assistantMessage('a2', [{ type: 'text', text: 'two' }]),
    });
    await recorder.flush();

    const rows = await loadAcpTranscript(SESSION);
    expect(rows.map((row) => row.content)).toEqual(['first', 'one', 'second', 'two']);
  });

  test('a resumed session hydrates the rows a previous process recorded', async () => {
    const first = new AcpTranscriptRecorder(() => SESSION);
    first.recordPrompt('first');
    first.record({
      type: 'message_end',
      message: assistantMessage('a1', [{ type: 'text', text: 'one' }]),
    });
    await first.flush();

    const resumed = new AcpTranscriptRecorder(() => SESSION);
    await resumed.hydrate();
    resumed.recordPrompt('second');
    resumed.record({
      type: 'message_end',
      message: assistantMessage('a2', [{ type: 'text', text: 'two' }]),
    });
    await resumed.flush();

    const rows = await loadAcpTranscript(SESSION);
    expect(rows.map((row) => row.content)).toEqual(['first', 'one', 'second', 'two']);
  });

  test('a client-written notice row survives a recorded turn', async () => {
    const db = await getDb();
    const now = Date.now();
    await db.run(
      'INSERT INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [
        SESSION,
        'Session',
        JSON.stringify([
          { id: 'msg-1-user', role: 'user', content: 'first', startedAt: now - 1000 },
          { id: 'a1', role: 'ai', content: 'one', startedAt: now - 900 },
          { id: 'notice-1', role: 'ai', content: '', notice: 'kept', startedAt: now - 800 },
        ]),
      ],
    );

    const recorder = new AcpTranscriptRecorder(() => SESSION);
    await recorder.hydrate();
    recorder.recordPrompt('second');
    recorder.record({
      type: 'message_end',
      message: assistantMessage('a2', [{ type: 'text', text: 'two' }]),
    });
    await recorder.flush();

    const rows = await loadAcpTranscript(SESSION);
    expect(rows.map((row) => row.content)).toEqual(['first', 'one', '', 'second', 'two']);
    expect(rows.find((row) => row.id === 'notice-1')?.notice).toBe('kept');
    expect(rows.filter((row) => row.role === 'user')).toHaveLength(2);
  });

  test('a session with no recorded rows answers empty', async () => {
    expect(await loadAcpTranscript('never-ran')).toEqual([]);
  });

  test('the row is keyed by the session id the driver reports', async () => {
    const recorder = new AcpTranscriptRecorder(() => SESSION);
    recorder.recordPrompt('hello');
    await recorder.flush();

    const db = await getDb();
    const row = await db.get<{ session_id: string }>('SELECT session_id FROM acp_transcripts');
    expect(row?.session_id).toBe(SESSION);
  });
});
