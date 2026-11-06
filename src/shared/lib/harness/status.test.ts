/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a harness card SAYS about a harness.
 *
 * The card used to print one word — `blocked` — for four unrelated conditions.
 * The fix differs in every one of them (install a package, run a login, press a
 * button, do nothing), so a bare state word told the reader nothing they could
 * act on. These cases pin each state's words, and the precedence between them:
 *
 *  - a binary that is not on PATH outranks everything, because there is nothing
 *    to authenticate or probe without it;
 *  - the sentence names the BINARY, not the harness id — `minimax` is launched by
 *    `mcode` and `cursor` by `cursor-agent`, so "minimax is not installed" sends
 *    the reader looking for a package that does not exist;
 *  - "never probed" is an absence of information, never reported as a problem;
 *  - a built-in transport is ready by definition, with no button to press.
 */

import { describe, expect, test } from 'bun:test';
import { harnessStatus } from '@/shared/lib/harness/status';
import type { HarnessSummary } from '@/shared/types/harness';

function summary(overrides: Partial<HarnessSummary> = {}): HarnessSummary {
  return {
    id: 'cursor',
    label: 'cursor',
    transport: 'acp',
    canLaunch: true,
    probe: null,
    ...overrides,
  };
}

/** A probe whose capabilities say exactly what a case needs. */
function probe(blocked: string | null, agentVersion?: string): HarnessSummary['probe'] {
  return {
    harness: 'cursor',
    capabilities: {
      configModel: 0, configThinking: 0, configMode: 0, modeValues: [],
      loadSession: false, listSessions: false, forkSession: false, deleteSession: false,
      resumeSession: false, closeSession: false, hasUsage: false, hasPlan: false, steerMode: null,
      ...(agentVersion ? { agentVersion } : {}),
      ...(blocked ? { blocked } : {}),
    },
    models: [],
    thinking: [],
    modes: [],
    probedAt: Date.now(),
  };
}

describe('harness status', () => {
  test('a missing binary says WHICH binary, and that it is missing', () => {
    const status = harnessStatus(summary({
      id: 'cursor',
      label: 'cursor',
      canLaunch: false,
      unavailable: '`cursor-agent` is not installed',
    }));
    expect(status.state).toBe('not-installed');
    expect(status.label).toBe('not installed');
    expect(status.detail).toContain('cursor-agent');
    expect(status.detail).toContain('PATH');
    // The binary's own name — the words a user would search a package index for.
    expect(status.detail).not.toBe('blocked');
  });

  test('the sentence names the launched binary, not the harness id', () => {
    // `minimax` is launched by `mcode`; saying "minimax is not installed" would
    // send the reader looking for a package that does not exist.
    const status = harnessStatus(summary({
      id: 'minimax', label: 'minimax', canLaunch: false, unavailable: '`mcode` is not installed',
    }));
    expect(status.detail).toContain('mcode');
    expect(status.detail).not.toContain('minimax is not installed');
  });

  test("an agent's own refusal is quoted, not summarised away", () => {
    const status = harnessStatus(summary({
      id: 'claude', label: 'claude',
      probe: probe('Authentication required: run `claude` in a terminal to sign in'),
    }));
    expect(status.state).toBe('needs-setup');
    expect(status.label).toBe('needs setup');
    expect(status.detail).toContain('run `claude` in a terminal to sign in');
  });

  test('a probed harness is ready, and says the version it answered as', () => {
    const status = harnessStatus(summary({ probe: probe(null, '18.14.0') }));
    expect(status.state).toBe('ready');
    expect(status.label).toBe('ready');
    expect(status.detail).toContain('18.14.0');
  });

  test('never probed is unknown, NOT a problem', () => {
    const status = harnessStatus(summary());
    expect(status.state).toBe('unprobed');
    expect(status.label).toBe('not probed');
    // It names the action that resolves it rather than implying a failure.
    expect(status.detail).toContain('Check status');
  });

  test('the built-in transport is ready by definition', () => {
    const status = harnessStatus(summary({ id: 'omp-rpc', label: 'omp', transport: 'rpc', builtIn: true }));
    expect(status.state).toBe('ready');
    expect(status.label).toBe('built in');
    expect(status.detail).toContain('nothing to install');
  });

  test('a missing binary outranks a stale refusal in the same record', () => {
    // A probe cached before the binary was removed, or one that reports an auth
    // error that no longer matters: with no binary on disk, "install it" is the
    // only true instruction.
    const status = harnessStatus(summary({
      canLaunch: false,
      unavailable: '`cursor-agent` is not installed',
      probe: probe('Authentication required'),
    }));
    expect(status.state).toBe('not-installed');
    expect(status.detail).toContain('cursor-agent');
  });

  test('no state ever renders the bare word "blocked"', () => {
    // The shipped defect, as an assertion: the word appeared alone for four
    // different conditions.
    const cases: HarnessSummary[] = [
      summary(),
      summary({ canLaunch: false, unavailable: '`cursor-agent` is not installed' }),
      summary({ probe: probe('Authentication required') }),
      summary({ probe: probe(null, '1.0.0') }),
      summary({ builtIn: true }),
    ];
    for (const entry of cases) {
      const status = harnessStatus(entry);
      expect(status.label).not.toBe('blocked');
      expect(status.detail ?? '').not.toBe('blocked');
    }
  });
});
