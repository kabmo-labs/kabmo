/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Save As, against the real handler.
 *
 * Three rules, each of which a careless implementation gets wrong: an existing destination
 * is REFUSED (overwriting is what `save` is for), the name must be ONE segment (a
 * separator would reach outside the directory the dialog named), and the new file is
 * written with the requested line ending — the same rebuild `save` does, because a
 * multipart body normalizes bare LF.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';

import { action } from '@/server/routes/fs/action';

/** Probe files live in the repo root — the one directory the root allow-list always accepts. */
const ROOT = process.cwd();
const PROBE = path.join(ROOT, 'tmp-save-as-probe.ts');
const COPY = path.join(ROOT, 'tmp-save-as-probe copy.ts');

afterEach(() => {
  fs.rmSync(PROBE, { force: true });
  fs.rmSync(COPY, { force: true });
});

function saveAs(fields: { path?: string; name: string; content?: string; eol?: string }) {
  const form = new FormData();
  form.append('actionType', 'saveAs');
  form.append('root', ROOT);
  form.append('path', fields.path ?? '.');
  form.append('name', fields.name);
  form.append('content', fields.content ?? 'a\nb\n');
  if (fields.eol) form.append('eol', fields.eol);
  return action({ request: new Request('http://localhost/api/fs/action', { method: 'POST', body: form }) } as never);
}

describe('fs saveAs', () => {
  test('writes a new file and answers its workspace-relative path', async () => {
    const res = await saveAs({ name: 'tmp-save-as-probe.ts', content: 'const a = 1;\n', eol: 'lf' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success?: boolean; path?: string };
    expect(body.success).toBe(true);
    expect(body.path).toBe('tmp-save-as-probe.ts');
    expect(fs.readFileSync(PROBE, 'utf8')).toBe('const a = 1;\n');
  });

  test('an existing destination is a 409 and its bytes are untouched', async () => {
    fs.writeFileSync(PROBE, 'original\n');
    const res = await saveAs({ name: 'tmp-save-as-probe.ts', content: 'replacement\n', eol: 'lf' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toContain('already exists');
    // The refusal is the point: an overwrite is what `save` is for.
    expect(fs.readFileSync(PROBE, 'utf8')).toBe('original\n');
  });

  test('a name carrying a separator is refused before anything is written', async () => {
    for (const name of ['nested/probe.ts', '..', '.', '']) {
      const res = await saveAs({ name, content: 'x' });
      expect(res.status).toBe(400);
    }
    expect(fs.existsSync(PROBE)).toBe(false);
  });

  test('the requested line ending is what lands on disk', async () => {
    await saveAs({ name: 'tmp-save-as-probe.ts', content: 'a\nb\n', eol: 'crlf' });
    expect([...fs.readFileSync(PROBE)]).toEqual([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x0a]);
  });

  test('a subdirectory destination is created when it does not exist', async () => {
    const res = await saveAs({ name: 'tmp-save-as-probe.ts', path: 'tmp-save-as-dir', content: 'x', eol: 'lf' });
    expect(res.status).toBe(200);
    const written = path.join(ROOT, 'tmp-save-as-dir', 'tmp-save-as-probe.ts');
    expect(fs.readFileSync(written, 'utf8')).toBe('x');
    fs.rmSync(path.join(ROOT, 'tmp-save-as-dir'), { recursive: true, force: true });
  });
});
