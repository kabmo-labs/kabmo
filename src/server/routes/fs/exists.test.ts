/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor tab's existence probe.
 *
 * Two answers are load-bearing and neither is the read path's: a DIRECTORY
 * standing where the tab's file used to be is still "gone" as far as the tab is
 * concerned (`Bun.file().exists()` reports `false` for a directory, so a probe
 * built on it would have been right by accident — this pins the intent), and a
 * path outside the root allow-list is refused rather than answered, because the
 * probe is a filesystem read like any other.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { fileExists } from '@/server/routes/fs/exists';

const PROBE = path.join(process.cwd(), 'tmp-exists-probe.txt');

afterEach(() => {
  // The directory case leaves a folder where the file was, so the teardown has
  // to remove either shape — `rmSync` on a directory without `recursive` throws
  // EISDIR, which surfaced as three unrelated failures in the next cases.
  fs.rmSync(PROBE, { recursive: true, force: true });
});

async function probe(filePath: string, root: string = process.cwd()) {
  const url = new URL('http://localhost/api/fs/exists');
  url.searchParams.set('path', filePath);
  url.searchParams.set('root', root);
  const res = await fileExists({ request: new Request(url) } as never);
  return { status: res.status, body: (await res.json()) as { exists?: boolean; error?: string } };
}

describe('fs exists', () => {
  test('a file that is there reports exists', async () => {
    fs.writeFileSync(PROBE, 'x');
    const { status, body } = await probe('tmp-exists-probe.txt');

    expect(status).toBe(200);
    expect(body.exists).toBe(true);
  });

  test('a file that was deleted reports not exists', async () => {
    const { status, body } = await probe('tmp-exists-probe.txt');

    expect(status).toBe(200);
    expect(body.exists).toBe(false);
  });

  test('a directory standing in the file’s place is not the file', async () => {
    fs.mkdirSync(PROBE, { recursive: true });
    const { body } = await probe('tmp-exists-probe.txt');

    // The tab names a FILE. A folder at that path is not the thing it names, so
    // the probe answers "no" — the file was deleted and something else took its
    // path. `Bun.file().exists()` would have said false here too, but only
    // because it reports every directory as absent; this asserts the intent.
    expect(body.exists).toBe(false);
  });

  test('a missing path parameter is a refusal, not a verdict', async () => {
    const res = await fileExists({ request: new Request('http://localhost/api/fs/exists') } as never);
    expect(res.status).toBe(400);
  });

  test('a path that escapes the root is refused', async () => {
    const { status, body } = await probe('../outside.txt');
    expect(status).toBe(403);
    expect(body.error).toBeTruthy();
  });
});
