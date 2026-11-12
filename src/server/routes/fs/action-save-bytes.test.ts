/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The binary save branch: a workbook the grid edited.
 *
 * The bytes must land VERBATIM — a ZIP container cannot survive the text
 * field's UTF-8 and line-ending normalization, which is why this branch exists
 * at all — and the conflict guard must apply to it exactly as it does to a text
 * save.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { action } from '@/server/routes/fs/action';

const PROBE = path.join(process.cwd(), 'tmp-bytes-probe.xlsx');

afterEach(() => {
  fs.rmSync(PROBE, { force: true });
});

async function saveBytes(bytes: Uint8Array, baseMtime?: number) {
  const form = new FormData();
  form.append('actionType', 'saveBytes');
  form.append('root', process.cwd());
  form.append('path', 'tmp-bytes-probe.xlsx');
  form.append('bytes', new Blob([bytes]));
  if (baseMtime !== undefined) form.append('baseMtime', String(baseMtime));
  return action({ request: new Request('http://localhost/api/fs/action', { method: 'POST', body: form }) } as never);
}

describe('fs saveBytes', () => {
  test('writes the bytes verbatim', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x0a, 0x0d]);
    const res = await saveBytes(bytes);
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await Bun.file(PROBE).arrayBuffer())]).toEqual([...bytes]);
  });

  test('a stale base mtime is a conflict, not a write', async () => {
    fs.writeFileSync(PROBE, 'disk');
    const res = await saveBytes(new Uint8Array([1, 2, 3]), 1);
    expect(res.status).toBe(409);
    expect(await Bun.file(PROBE).text()).toBe('disk');
  });

  test('a request with no bytes is refused', async () => {
    const form = new FormData();
    form.append('actionType', 'saveBytes');
    form.append('root', process.cwd());
    form.append('path', 'tmp-bytes-probe.xlsx');
    const res = await action({ request: new Request('http://localhost/api/fs/action', { method: 'POST', body: form }) } as never);
    expect(res.status).toBe(400);
  });
});
