// The interactive omp offer, tested by its decisions rather than its prompt.
//
// What must not regress is who is ALLOWED to be asked and what the default is:
// a daemon start, a JSON read or a piped invocation that blocks on a question
// is a hung login entry, and a default of yes rewrites the global Bun prefix
// because someone pressed Enter. Both `confirm` and `install` are injected, so
// no test spawns `bun add -g`.

import { describe, expect, test } from 'bun:test';

import { canOfferOmpInstall, isYes, offerOmpInstall } from '@/cli/lib/omp-setup.js';

describe('canOfferOmpInstall', () => {
  test('a plain terminal may be asked', () => {
    expect(canOfferOmpInstall({ isTTY: true, json: false, quiet: false })).toBe(true);
  });

  // `serve` writes a login entry and detaches; a read there hangs the login.
  test('a pipe is never asked', () => {
    expect(canOfferOmpInstall({ isTTY: false, json: false, quiet: false })).toBe(false);
  });

  test('machine-readable and quiet runs are never asked', () => {
    expect(canOfferOmpInstall({ isTTY: true, json: true, quiet: false })).toBe(false);
    expect(canOfferOmpInstall({ isTTY: true, json: false, quiet: true })).toBe(false);
  });
});

describe('isYes', () => {
  test('only the spellings a user types count as yes', () => {
    expect(isYes('y')).toBe(true);
    expect(isYes('YES')).toBe(true);
    expect(isYes(' yes ')).toBe(true);
  });

  test('an empty answer and everything else is no', () => {
    for (const answer of ['', '   ', 'n', 'no', 'nope', 'yeah', undefined, null]) {
      expect(isYes(answer)).toBe(false);
    }
  });
});

describe('offerOmpInstall', () => {
  test('a non-terminal installs nothing and never asks', async () => {
    let asked = false;
    const outcome = await offerOmpInstall({
      isTTY: false,
      confirm: async () => { asked = true; return 'y'; },
      install: async () => ({ exitCode: 0, installed: true }),
    });
    expect(outcome).toBe('unavailable');
    expect(asked).toBe(false);
  });

  test('declining runs no install command', async () => {
    let installed = false;
    const outcome = await offerOmpInstall({
      isTTY: true,
      confirm: async () => '',
      install: async () => { installed = true; return { exitCode: 0, installed: true }; },
    });
    expect(outcome).toBe('declined');
    expect(installed).toBe(false);
  });

  test('a non-zero exit is a failure, and is not reported as installed', async () => {
    const outcome = await offerOmpInstall({
      isTTY: true,
      confirm: async () => 'y',
      install: async () => ({ exitCode: 1, installed: false }),
    });
    expect(outcome).toBe('failed');
  });

  // `bun add -g` can succeed while PATH does not see the launcher yet. Saying
  // "installed" there would make the gate below print a second, contradictory
  // message about a missing binary.
  test('a successful command that leaves omp unresolvable is a failure', async () => {
    const outcome = await offerOmpInstall({
      isTTY: true,
      confirm: async () => 'y',
      install: async () => ({ exitCode: 0, installed: false }),
    });
    expect(outcome).toBe('failed');
  });

  test('a thrown install is reported, not propagated', async () => {
    const outcome = await offerOmpInstall({
      isTTY: true,
      confirm: async () => 'y',
      install: async () => { throw new Error('bun is missing'); },
    });
    expect(outcome).toBe('failed');
  });

  test('yes plus a resolvable binary is the one success', async () => {
    const outcome = await offerOmpInstall({
      isTTY: true,
      confirm: async () => 'y',
      install: async () => ({ exitCode: 0, installed: true }),
    });
    expect(outcome).toBe('installed');
  });

  // Ctrl+D closes stdin without an answer; that must read as a decline rather
  // than escape as an unhandled rejection out of `serve`.
  test('a confirm that throws (closed stdin) is a decline', async () => {
    const outcome = await offerOmpInstall({
      isTTY: true,
      confirm: async () => { throw new Error('EOF'); },
      install: async () => ({ exitCode: 0, installed: true }),
    });
    expect(outcome).toBe('declined');
  });
});
