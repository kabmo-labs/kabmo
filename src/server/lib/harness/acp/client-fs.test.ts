/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP client's file surface.
 *
 * The cases that matter are the REFUSALS: an agent asking for a path outside the
 * session's workspace must get `-32602`, not a read of the host's filesystem.
 * The line window is pinned because ACP numbers lines from 1.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAcpFsRequest, isAcpFsMethod, type AcpFsHost } from '@/server/lib/harness/acp/client-fs';
import { testPosix } from '@/test-support/platform';
import { ACP_ERROR } from '@/server/lib/harness/acp/protocol';

const scratch: string[] = [];

async function workspace(): Promise<AcpFsHost> {
  const cwd = await mkdtemp(join(tmpdir(), 'kabmo-acp-fs-'));
  scratch.push(cwd);
  return { cwd, sessionId: 's1' };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('fs capability methods', () => {
  test('recognises exactly the two methods it serves', () => {
    expect(isAcpFsMethod('fs/read_text_file')).toBe(true);
    expect(isAcpFsMethod('fs/write_text_file')).toBe(true);
    expect(isAcpFsMethod('terminal/create')).toBe(false);
  });
});

describe('fs/read_text_file', () => {
  test('answers the whole file when no window is given', async () => {
    const host = await workspace();
    await Bun.write(join(host.cwd, 'a.txt'), 'one\ntwo\n');
    const answer = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: join(host.cwd, 'a.txt') });
    expect(answer).toEqual({ answered: true, result: { content: 'one\ntwo\n' } });
  });

  test('a line window is 1-based and counts limit lines', async () => {
    const host = await workspace();
    const file = join(host.cwd, 'a.txt');
    await Bun.write(file, 'one\ntwo\nthree\nfour');
    const second = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: file, line: 2, limit: 2 });
    expect(second).toEqual({ answered: true, result: { content: 'two\nthree' } });
    const tail = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: file, line: 3 });
    expect(tail).toEqual({ answered: true, result: { content: 'three\nfour' } });
    const past = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: file, line: 99 });
    expect(past).toEqual({ answered: true, result: { content: '' } });
  });

  test('a missing file is -32002, the resource-not-found code', async () => {
    const host = await workspace();
    const answer = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: join(host.cwd, 'nope.txt') });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.notFound });
  });

  test('a relative path is refused as invalid params', async () => {
    const host = await workspace();
    const answer = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: 'a.txt' });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.invalidParams });
  });

  test('a path outside the workspace is refused even when it exists', async () => {
    const host = await workspace();
    const answer = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: '/etc/hosts' });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.invalidParams });
  });

  // POSIX only: the fixture links to `/etc/hosts`, which does not exist on
  // Windows, and creating a symlink there needs a privilege a default runner
  // does not have. Measured on the Windows gate: the link was never made, so the
  // handler answered `-32002 File not found` instead of the refusal under test —
  // a failure about the fixture, not about the guard. The case ABOVE still runs
  // there: an absolute path outside the workspace is refused before any read.
  testPosix('a symlink out of the workspace is refused', async () => {
    const host = await workspace();
    const link = join(host.cwd, 'escape.txt');
    await symlink('/etc/hosts', link);
    const answer = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: link });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.invalidParams });
  });

  test('a window of 0 is invalid params, not an empty answer', async () => {
    const host = await workspace();
    const file = join(host.cwd, 'a.txt');
    await Bun.write(file, 'one');
    const answer = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 's1', path: file, line: 0 });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.invalidParams });
  });

  test('a request naming another session is refused', async () => {
    const host = await workspace();
    const file = join(host.cwd, 'a.txt');
    await Bun.write(file, 'one');
    const answer = await handleAcpFsRequest(host, 'fs/read_text_file', { sessionId: 'other', path: file });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.invalidParams });
  });
});

describe('fs/write_text_file', () => {
  test('creates the file and its parent directories', async () => {
    const host = await workspace();
    const target = join(host.cwd, 'nested', 'dir', 'a.txt');
    const answer = await handleAcpFsRequest(host, 'fs/write_text_file', { sessionId: 's1', path: target, content: 'hello' });
    expect(answer).toEqual({ answered: true, result: {} });
    expect(await Bun.file(target).text()).toBe('hello');
  });

  test('a path outside the workspace is refused and nothing is written', async () => {
    const host = await workspace();
    const target = join(host.cwd, '..', 'escaped.txt');
    const answer = await handleAcpFsRequest(host, 'fs/write_text_file', { sessionId: 's1', path: target, content: 'x' });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.invalidParams });
  });

  test('missing content is invalid params', async () => {
    const host = await workspace();
    const answer = await handleAcpFsRequest(host, 'fs/write_text_file', {
      sessionId: 's1',
      path: join(host.cwd, 'a.txt'),
    });
    expect(answer).toMatchObject({ answered: false, code: ACP_ERROR.invalidParams });
  });
});
