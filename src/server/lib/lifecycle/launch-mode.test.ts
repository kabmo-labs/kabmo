import { describe, expect, test } from 'bun:test';

import { isCliManaged, launchModeArg, resolveLaunchMode } from '@/server/lib/lifecycle/launch-mode';

const ENTRY = '/repo/src/server/index.ts';

describe('resolveLaunchMode', () => {
  test('reads the flag the CLI appends to the servers it spawns', () => {
    expect(resolveLaunchMode(['bun', ENTRY, '--kabmo-server', launchModeArg('daemon')])).toBe('daemon');
    expect(resolveLaunchMode(['bun', ENTRY, '--kabmo-server', launchModeArg('foreground')])).toBe('foreground');
  });

  test('treats a server started without the flag as direct', () => {
    // `bun run dev`, `bun run start`, a manual run, an external supervisor.
    expect(resolveLaunchMode(['bun', 'run', '--hot', ENTRY, '--kabmo-server'])).toBe('direct');
    expect(resolveLaunchMode(['bun', ENTRY, '--kabmo-server', '--launch-mode=sideways'])).toBe('direct');
  });

  test('ignores an inherited environment marker', () => {
    // The Kabmo's terminal panel runs commands with the server's own env, so
    // a `bun run dev` started there inherits `daemon` — argv is the only
    // trustworthy signal, and this test fails if env is ever read again.
    const previous = Bun.env.KABMO_LAUNCH_MODE;
    Bun.env.KABMO_LAUNCH_MODE = 'daemon';
    try {
      expect(resolveLaunchMode(['bun', ENTRY, '--kabmo-server'])).toBe('direct');
    } finally {
      if (previous === undefined) delete Bun.env.KABMO_LAUNCH_MODE;
      else Bun.env.KABMO_LAUNCH_MODE = previous;
    }
  });
});

// Every command that would END a server decides with this predicate:
// `restart`/`update` may replace it, and `stop` stops it by default. Guessing
// wrong here kills a `bun run dev` the user owns — that launcher exits with its
// child — or leaves a daemon serving the build that was just replaced.
describe('isCliManaged', () => {
  test('owns the instances the CLI started', () => {
    expect(isCliManaged('daemon')).toBe(true);
    expect(isCliManaged('foreground')).toBe(true);
  });

  test('leaves every instance Kabmo did not start alone', () => {
    // `bun run dev`, `bun run start`, a manual run, a systemd/pm2 unit.
    expect(isCliManaged('direct')).toBe(false);
    // A probed or unreadable record never authorises a kill either.
    expect(isCliManaged('unknown')).toBe(false);
    expect(isCliManaged(undefined)).toBe(false);
  });
});
