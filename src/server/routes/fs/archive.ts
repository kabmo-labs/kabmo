/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/fs/archive` — which compress formats this machine can write.
 *
 * The dialog cannot guess: `rar` is almost never installed and `7z` is not on
 * a stock macOS. Offering a format the server then refuses with ENOENT is a
 * dead row; asking here means the dialog lists exactly the tools the machine
 * has, and the user learns the reason before typing a name.
 */

import { json } from '@/server/lib/remix-compat';
import { compressFormats } from '@/server/lib/fs/archive';

export async function loader() {
  return json({ formats: compressFormats() });
}
