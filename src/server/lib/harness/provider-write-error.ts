/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The refusal a provider write throws, in its own module.
 *
 * Shared because TWO modules raise it — the entry builder (a dialect the target
 * cannot speak) and the writer (an unparseable file, a bad id) — and importing one
 * from the other would make the dependency circular for a class definition.
 */

export class ProviderWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderWriteError';
  }
}
