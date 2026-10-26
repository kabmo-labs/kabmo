/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The save branch's byte contract.
 *
 * `multipart/form-data` normalizes every bare LF in a field value to CRLF in
 * transit — the HTML serializer does it on the way out and Bun's parser agrees
 * on the way in — so `content` reaches this route CRLF-normalized no matter what
 * the editor buffer held. The file's own ending therefore arrives as its own
 * `eol` field, and the bytes written to disk are built from it. Without that
 * step every save rewrote the whole file's line endings: an LF file came back
 * CRLF, which `git diff` reports as every line changed.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { action } from '@/server/routes/fs/action';

/** Probe files live in the repo root — the one directory the root allow-list always accepts. */
const PROBE = path.join(process.cwd(), 'tmp-eol-probe.txt');

afterEach(() => {
  fs.rmSync(PROBE, { force: true });
});

async function save(content: string, eol?: string) {
  const form = new FormData();
  form.append('actionType', 'save');
  form.append('root', process.cwd());
  form.append('path', 'tmp-eol-probe.txt');
  form.append('content', content);
  if (eol) form.append('eol', eol);
  const res = await action({ request: new Request('http://localhost/api/fs/action', { method: 'POST', body: form }) } as never);
  expect(res.status).toBe(200);
  return new Uint8Array(await Bun.file(PROBE).arrayBuffer());
}

describe('fs save line endings', () => {
  test('an lf request writes lf, whatever multipart did in transit', async () => {
    const bytes = await save('a\nb\n', 'lf');
    expect([...bytes]).toEqual([0x61, 0x0a, 0x62, 0x0a]);
  });

  test('a crlf request writes crlf', async () => {
    const bytes = await save('a\nb\n', 'crlf');
    expect([...bytes]).toEqual([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]);
  });

  test('a payload that already carries crlf is not doubled', async () => {
    const bytes = await save('a\r\nb\r\n', 'crlf');
    expect([...bytes]).toEqual([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]);
  });

  // No `eol` means the route has no instruction, so the payload is written as
  // multipart delivered it — which is CRLF, since the transport normalizes.
  test('a payload without an eol field is written as delivered', async () => {
    const bytes = await save('a\nb\n');
    expect([...bytes]).toEqual([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]);
  });
});

/**
 * The conflict contract, against the real handler.
 *
 * A save that names the mtime it was built from must be REFUSED when the disk has
 * moved — that is the whole point, and it is the branch a unit test on
 * `checkWriteConflict` cannot prove because it never reaches the route. The three
 * "must still write" branches matter just as much: a guard that refuses a legitimate
 * save is worse than no guard.
 */
describe('fs save conflict', () => {
  const CONFLICT = path.join(process.cwd(), 'tmp-conflict-probe.ts');

  afterEach(() => {
    fs.rmSync(CONFLICT, { force: true });
  });

  async function saveWith(baseMtime: number | undefined, content: string) {
    const form = new FormData();
    form.append('actionType', 'save');
    form.append('root', process.cwd());
    form.append('path', 'tmp-conflict-probe.ts');
    form.append('content', content);
    form.append('eol', 'lf');
    if (baseMtime !== undefined) form.append('baseMtime', String(baseMtime));
    return action({ request: new Request('http://localhost/api/fs/action', { method: 'POST', body: form }) } as never);
  }

  test('a matching base writes and answers the mtime it wrote', async () => {
    fs.writeFileSync(CONFLICT, 'first\n');
    const base = Math.round(fs.statSync(CONFLICT).mtimeMs);
    const res = await saveWith(base, 'mine\n');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success?: boolean; mtimeMs?: number };
    expect(body.success).toBe(true);
    expect(typeof body.mtimeMs).toBe('number');
    expect(fs.readFileSync(CONFLICT, 'utf8')).toBe('mine\n');
  });

  test('a base the disk moved past is a 409, and NOTHING is written', async () => {
    fs.writeFileSync(CONFLICT, 'first\n');
    const base = Math.round(fs.statSync(CONFLICT).mtimeMs);
    // Another writer — an agent, another tab — moves the file. The mtime is set
    // explicitly rather than by writing again: two writes inside one millisecond
    // leave `mtimeMs` identical, which is the documented limit of this guard (see
    // `write-conflict.ts`) rather than something a test should paper over.
    fs.writeFileSync(CONFLICT, 'theirs\n');
    const moved = new Date(base + 5_000);
    fs.utimesSync(CONFLICT, moved, moved);
    const res = await saveWith(base, 'mine again\n');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { conflict?: boolean; mtimeMs?: number };
    expect(body.conflict).toBe(true);
    expect(typeof body.mtimeMs).toBe('number');
    // The refusal is the point: the other writer's bytes survive.
    expect(fs.readFileSync(CONFLICT, 'utf8')).toBe('theirs\n');
  });

  test('no base writes unconditionally — a handle-backed file and an older client', async () => {
    fs.writeFileSync(CONFLICT, 'first\n');
    expect((await saveWith(undefined, 'no base\n')).status).toBe(200);
    expect(fs.readFileSync(CONFLICT, 'utf8')).toBe('no base\n');
  });

  test('a base the disk agrees with after adoption writes — the "Keep mine" retry', async () => {
    fs.writeFileSync(CONFLICT, 'first\n');
    fs.writeFileSync(CONFLICT, 'theirs\n');
    const moved = new Date(Date.now() + 5_000);
    fs.utimesSync(CONFLICT, moved, moved);
    const adopted = Math.round(fs.statSync(CONFLICT).mtimeMs);
    expect((await saveWith(adopted, 'adopted\n')).status).toBe(200);
    expect(fs.readFileSync(CONFLICT, 'utf8')).toBe('adopted\n');
  });

  test('a base with the file DELETED recreates it — recreating is the user’s decision', async () => {
    fs.writeFileSync(CONFLICT, 'first\n');
    const base = Math.round(fs.statSync(CONFLICT).mtimeMs);
    fs.rmSync(CONFLICT, { force: true });
    expect((await saveWith(base, 'recreated\n')).status).toBe(200);
    expect(fs.readFileSync(CONFLICT, 'utf8')).toBe('recreated\n');
  });
});
