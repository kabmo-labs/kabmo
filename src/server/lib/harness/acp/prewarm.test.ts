/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP prewarm pool's identity and claim rules.
 *
 * Three properties here are load-bearing and invisible at the call site. The
 * claim is a synchronous check-and-set: two sends racing one warm agent would
 * both adopt it and one would talk to a session the other owns. A failed spawn
 * must leave NO entry, or every later prewarm for that harness+cwd silently does
 * nothing and the user keeps paying the boot. And the pool warms a PROCESS, not
 * a session: `session/new` is what makes some agents write a session record, and
 * a warm child must stay invisible until a chat adopts it.
 *
 * No agent process is ever spawned: the opener is a fake handle. The real opener
 * is exercised by the spawn path itself.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  acpPrewarmKey,
  claimPrewarmedAcpSession,
  getPrewarmedAcp,
  prewarmAcpSession,
  restartPrewarmedAcpSessions,
  type AcpPrewarmDeps,
  type PrewarmedAcp,
} from '@/server/lib/harness/acp/prewarm.server';
import type { AcpProcess } from '@/server/lib/harness/acp/client';

interface Fake {
  warm: PrewarmedAcp;
  /** Resolves when the fake is disposed, so a test waits on the event rather
   *  than on a guessed delay. */
  torn: Promise<void>;
  disposed: boolean;
}

function fakeProcess(alive = true): Fake {
  const torn = Promise.withResolvers<void>();
  const state = { alive };
  // A test double for the transport: only the two members the pool reads.
  const process = {
    get isAlive() {
      return state.alive;
    },
    dispose: async () => {
      state.alive = false;
      fake.disposed = true;
      torn.resolve();
    },
  } as unknown as AcpProcess;
  const fake: Fake = { warm: { process, token: 'kabmo_agent_test' }, torn: torn.promise, disposed: false };
  return fake;
}

/** An opener that records every call and hands out one fake per call. */
function opener(outcome?: () => Promise<PrewarmedAcp>): { deps: AcpPrewarmDeps; opened: string[]; fakes: Fake[] } {
  const opened: string[] = [];
  const fakes: Fake[] = [];
  return {
    opened,
    fakes,
    deps: {
      open: async (harness, cwd) => {
        opened.push(`${harness}@${cwd}`);
        if (outcome) return outcome();
        const fake = fakeProcess();
        fakes.push(fake);
        return fake.warm;
      },
    },
  };
}

afterEach(() => {
  getPrewarmedAcp().clear();
});

describe('prewarmAcpSession', () => {
  test('spawns once per harness AND cwd', () => {
    const { deps, opened } = opener();
    prewarmAcpSession('claude', '/work', deps);
    prewarmAcpSession('claude', '/work', deps);
    expect(opened).toEqual(['claude@/work']);
    expect(getPrewarmedAcp().has(acpPrewarmKey('claude', '/work'))).toBe(true);

    // Two agents in one folder are two processes, and so are one agent in two.
    prewarmAcpSession('codex', '/other', deps);
    prewarmAcpSession('claude', '/elsewhere', deps);
    expect(opened).toEqual(['claude@/work', 'codex@/other', 'claude@/elsewhere']);
  });

  test('a different harness for the same cwd replaces the warm agent', async () => {
    const { deps, opened, fakes } = opener();
    prewarmAcpSession('claude', '/work', deps);
    prewarmAcpSession('codex', '/work', deps);
    // One pending chat runs one agent: keeping the previous candidate would cost
    // a process for a choice the operator already left.
    await fakes[0]!.torn;
    expect(getPrewarmedAcp().has(acpPrewarmKey('claude', '/work'))).toBe(false);
    expect(getPrewarmedAcp().has(acpPrewarmKey('codex', '/work'))).toBe(true);
    expect(opened).toEqual(['claude@/work', 'codex@/work']);
    expect(fakes[0]?.disposed).toBe(true);
  });

  test('a failed spawn leaves no entry, so the next prewarm retries', async () => {
    let attempt = 0;
    const { deps } = opener(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('agent exited');
      return fakeProcess().warm;
    });
    prewarmAcpSession('claude', '/work', deps);
    // The failure settles asynchronously; wait for the entry's own promise so
    // the assertion reads the state after the catch, not during it.
    await getPrewarmedAcp().get(acpPrewarmKey('claude', '/work'))?.ready;
    expect(getPrewarmedAcp().has(acpPrewarmKey('claude', '/work'))).toBe(false);

    prewarmAcpSession('claude', '/work', deps);
    expect(await claimPrewarmedAcpSession('claude', '/work')).not.toBeNull();
  });
});

describe('claimPrewarmedAcpSession', () => {
  test('adopts an entry exactly once', async () => {
    const { deps } = opener();
    prewarmAcpSession('claude', '/work', deps);
    const first = claimPrewarmedAcpSession('claude', '/work');
    // The claim is synchronous: the entry is removed before readiness resolves,
    // so a send racing this one cannot adopt the same child.
    expect(getPrewarmedAcp().has(acpPrewarmKey('claude', '/work'))).toBe(false);
    expect(await first).not.toBeNull();
    expect(await claimPrewarmedAcpSession('claude', '/work')).toBeNull();
  });

  test('a harness the entry was not warmed for is not handed out', async () => {
    const { deps } = opener();
    prewarmAcpSession('claude', '/work', deps);
    expect(await claimPrewarmedAcpSession('codex', '/work')).toBeNull();
    expect(await claimPrewarmedAcpSession('claude', '/work')).not.toBeNull();
  });

  test('a child that died while warming is disposed, and the caller spawns cold', async () => {
    const dead = fakeProcess(false);
    const { deps } = opener(async () => dead.warm);
    prewarmAcpSession('claude', '/work', deps);
    // The pool disposes a child that is not alive when its boot settles.
    await dead.torn;
    expect(await claimPrewarmedAcpSession('claude', '/work')).toBeNull();
    expect(dead.disposed).toBe(true);
  });
});

describe('restartPrewarmedAcpSessions', () => {
  test('disposes unclaimed entries and reports the count', async () => {
    const { deps, fakes } = opener();
    prewarmAcpSession('claude', '/a', deps);
    prewarmAcpSession('codex', '/b', deps);
    prewarmAcpSession('claude', '/c', deps);
    await claimPrewarmedAcpSession('claude', '/c');

    expect(await restartPrewarmedAcpSessions()).toBe(2);
    expect(getPrewarmedAcp().size).toBe(0);
    // The claimed child belongs to a chat now: recycling standby processes must
    // not take it down.
    expect(fakes.filter((fake) => fake.disposed)).toHaveLength(2);
  });
});
