/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The generated UI password, shared by the CLI (which mints one for
 * `--ui-password` with no value) and anything else that needs to offer one.
 *
 * The alphabet deliberately omits the characters a person confuses when reading
 * a password off one screen and typing it into another: `I`/`O` (against `1`/`0`)
 * and `i`/`l`/`o` (against each other). What is left is 55 unambiguous
 * characters, which is what makes the value safe to transcribe from a terminal
 * onto a phone.
 *
 * `crypto.getRandomValues` rather than a `node:crypto` import: it is a global in
 * both Bun and the browser, so this module stays importable from either side.
 */

/** Every character a generated password may contain (55 of them). */
export const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * The environment variable that configures the UI password.
 *
 * Lives here, in the dependency-free module, rather than beside the code that
 * applies it: the guard needs to name it for the boot banner, and the guard is
 * imported by that same module — naming it here is what keeps the two from
 * needing a circular import.
 */
export const UI_PASSWORD_ENV = 'KABMO_UI_PASSWORD';

/** The pre-rename spelling, still read so an exported password keeps working. */
export const LEGACY_UI_PASSWORD_ENV = 'OMPCHAMBER_UI_PASSWORD';

/** Length of a generated password — 16 characters is ~92 bits over this alphabet. */
export const GENERATED_PASSWORD_LENGTH = 16;

/**
 * Random bytes with the modulo bias removed.
 *
 * `bytes[i] % alphabet.length` alone would over-represent the first
 * `256 % 55 = 36` characters, since 256 is not a multiple of 55. Bytes at or
 * above the largest multiple of the alphabet size are discarded and redrawn
 * instead, which makes every character equally likely.
 */
function unbiasedBytes(length: number, alphabetLength: number): Uint8Array {
  const limit = 256 - (256 % alphabetLength);
  const out = new Uint8Array(length);
  const buffer = new Uint8Array(length * 2);
  let filled = 0;

  while (filled < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      out[filled] = byte % alphabetLength;
      filled += 1;
      if (filled === length) break;
    }
  }
  return out;
}

/** A fresh password from `PASSWORD_ALPHABET`, `length` characters long. */
export function generatePassword(length: number = GENERATED_PASSWORD_LENGTH): string {
  const size = Number.isFinite(length) && length > 0 ? Math.floor(length) : GENERATED_PASSWORD_LENGTH;
  const indices = unbiasedBytes(size, PASSWORD_ALPHABET.length);
  let password = '';
  for (const index of indices) password += PASSWORD_ALPHABET[index];
  return password;
}
