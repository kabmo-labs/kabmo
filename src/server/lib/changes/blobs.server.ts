/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Content-addressed gzip blobs for the change journal.
 *
 * The key is `<byteLength base36>-<Bun.hash base36>`, the same shape omp uses,
 * so a blob written by either writer is recognisable. The cap is 32 MB — four
 * times omp's 8 MB — because the journal's job is to answer "what did this run
 * do", and a 10 MB file is exactly the case the old cap could not answer. A
 * file over the cap is not stored: the record carries `undefined`, and the
 * reader reports the two sides as unknown rather than inventing them.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const MAX_BLOB_BYTES = 32 * 1024 * 1024;

export function blobKey(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return `${bytes.byteLength.toString(36)}-${Bun.hash(bytes).toString(36)}`;
}

/** Store `text` and return its key; `null` when it exceeds the cap. */
export async function writeBlob(dir: string, text: string): Promise<string | null> {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength > MAX_BLOB_BYTES) return null;
  const key = blobKey(text);
  const file = path.join(dir, key);
  if (await Bun.file(file).exists()) return key;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await Bun.write(file, Bun.gzipSync(bytes));
  return key;
}

/** Blob content for a key; `null` = absent file, `undefined` = not stored/missing. */
export async function readBlob(
  dir: string,
  key: string | null | undefined,
): Promise<string | null | undefined> {
  if (key === null) return null;
  if (key === undefined) return undefined;
  try {
    const bytes = await Bun.file(path.join(dir, key)).bytes();
    return new TextDecoder().decode(Bun.gunzipSync(bytes));
  } catch {
    return undefined;
  }
}
