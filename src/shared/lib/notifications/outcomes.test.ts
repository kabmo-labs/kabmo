/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** Only a NEW stream→finish transition earns a notice; failures ride the same rule. */

import { describe, expect, test } from 'bun:test';

import {
  runOutcomeNotices,
  streamOutcomes,
  type StreamOutcome,
} from '@/shared/lib/notifications/outcomes';
import type { WorkspaceFolderData } from '@/shared/types';

function folders(
  sessions: Array<{
    id: string;
    title?: string;
    streamStatus?: StreamOutcome;
    runFailure?: string;
  }>,
): WorkspaceFolderData[] {
  return [
    {
      id: 1,
      name: 'workspace',
      isExpanded: true,
      hasMore: false,
      totalSessions: sessions.length,
      sessions: sessions.map((session) => ({
        id: session.id,
        folder_id: 1,
        title: session.title ?? session.id,
        streamStatus: session.streamStatus,
        runFailure: session.runFailure,
      })),
    },
  ];
}

describe('run outcome notices', () => {
  test('a run that finished after streaming is one notice', () => {
    const previous = new Map<string, StreamOutcome>([['a', 'stream']]);
    expect(runOutcomeNotices(previous, folders([{ id: 'a', streamStatus: 'finish' }]))).toEqual([
      { kind: 'finish', sessionId: 'a', title: 'a', detail: 'The run finished.' },
    ]);
  });

  test('a badge already present at page load is not news', () => {
    const previous = streamOutcomes(folders([{ id: 'a', streamStatus: 'finish' }]));
    expect(runOutcomeNotices(previous, folders([{ id: 'a', streamStatus: 'finish' }]))).toEqual([]);
  });

  test('an aborted run is silent', () => {
    const previous = new Map<string, StreamOutcome>([['a', 'stream']]);
    expect(runOutcomeNotices(previous, folders([{ id: 'a', streamStatus: 'abort' }]))).toEqual([]);
  });

  test('a failure is an error notice carrying the reason', () => {
    const previous = new Map<string, StreamOutcome>([['a', 'stream']]);
    expect(
      runOutcomeNotices(previous, folders([
        { id: 'a', title: 'Fix the build', streamStatus: 'finish', runFailure: ' 401 invalid api key ' },
      ])),
    ).toEqual([
      { kind: 'error', sessionId: 'a', title: 'Fix the build', detail: '401 invalid api key' },
    ]);
  });

  test('an untitled session still names Kabmo', () => {
    const previous = new Map<string, StreamOutcome>([['a', 'stream']]);
    const [notice] = runOutcomeNotices(previous, folders([{ id: 'a', title: '  ', streamStatus: 'finish' }]));
    expect(notice?.title).toBe('Kabmo');
  });

  test('only sessions that moved are reported', () => {
    const previous = new Map<string, StreamOutcome>([
      ['a', 'stream'],
      ['b', 'finish'],
      ['c', undefined],
    ]);
    const notices = runOutcomeNotices(previous, folders([
      { id: 'a', streamStatus: 'finish' },
      { id: 'b', streamStatus: 'finish' },
      { id: 'c', streamStatus: 'finish' },
    ]));
    expect(notices.map((notice) => notice.sessionId)).toEqual(['a']);
  });

  test('a stream that keeps streaming earns nothing', () => {
    const previous = new Map<string, StreamOutcome>([['a', 'stream']]);
    expect(runOutcomeNotices(previous, folders([{ id: 'a', streamStatus: 'stream' }]))).toEqual([]);
  });
});
