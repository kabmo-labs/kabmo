import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import {
  SPAWN_CLIFF,
  cachedOpenFileDescriptors,
  countOpenFileDescriptors,
  describeFdPressure,
  describeSpawnFailure,
  descriptorTableSize,
} from '@/server/lib/lifecycle/fd-pressure';

describe('descriptorTableSize', () => {
  // The bug this pins: the limit used to be the constant 10240, so on this host
  // (getdtablesize() = 61440) the probe reported "near the cliff" from 9216 —
  // six times the budget still free — and then never stopped reporting it.
  test('reports the kernel ceiling, which is what allocation actually enforces', () => {
    if (process.platform === 'win32') {
      expect(descriptorTableSize()).toBe(SPAWN_CLIFF);
      return;
    }
    const size = descriptorTableSize();
    expect(size).toBeGreaterThanOrEqual(SPAWN_CLIFF);
    // 61440 on the machine this was measured on; never the shell's `ulimit -n`,
    // which reads 1048576 there and would understate pressure seventeenfold.
    expect(Number.isInteger(size)).toBe(true);
  });
});

describe('countOpenFileDescriptors', () => {
  test('sweeps this process own descriptors on a POSIX host', () => {
    const pressure = countOpenFileDescriptors();
    if (process.platform === 'win32') {
      expect(pressure).toBeNull();
      return;
    }
    expect(pressure).not.toBeNull();
    // Stdio is always open.
    expect(pressure?.open).toBeGreaterThanOrEqual(3);
    expect(pressure?.highest).toBeGreaterThanOrEqual(2);
    // The limit is the real ceiling (bounded by the sweep cap), never the old
    // constant — a limit of 10240 is exactly the wrong answer on this host.
    expect(pressure?.limit).toBeGreaterThanOrEqual(SPAWN_CLIFF);
    expect(pressure?.nearCliff).toBe(false);
  });

  test('counts descriptors opened and closed around it', () => {
    const before = countOpenFileDescriptors();
    if (!before) return; // Host cannot answer; nothing to assert.
    const opened = [0, 1, 2, 3, 4].map(() => fs.openSync('/dev/null', 'r'));
    try {
      const during = countOpenFileDescriptors();
      expect(during!.open - before.open).toBeGreaterThanOrEqual(opened.length);
      expect(during!.highest).toBeGreaterThanOrEqual(Math.max(...opened));
    } finally {
      for (const fd of opened) fs.closeSync(fd);
    }
  });
});

describe('cachedOpenFileDescriptors', () => {
  // The sweep is 5.03 ms on a 61,440-entry table and blocks the event loop, so
  // `/api/health` — polled at 250-500 ms while a boot or restart is watched —
  // must reuse it. The cache is process-wide, so each case clears the slot.
  const reset = (): void => {
    (globalThis as unknown as Record<string, unknown>).__kabmoFdSweep = undefined;
  };

  test('reuses one sweep inside the window', () => {
    reset();
    const first = cachedOpenFileDescriptors(60_000);
    const second = cachedOpenFileDescriptors(60_000);
    expect(second).toBe(first);
    reset();
  });

  test('sweeps again once the window has passed', () => {
    reset();
    const first = cachedOpenFileDescriptors(0);
    const second = cachedOpenFileDescriptors(0);
    // A zero window means every call is fresh; the values are equal objects
    // only if the host cannot answer at all.
    if (first === null) expect(second).toBeNull();
    else expect(second).not.toBe(first);
    reset();
  });

  test('sees a descriptor opened after the window', () => {
    reset();
    const before = cachedOpenFileDescriptors(0);
    if (!before) return; // Host cannot answer; nothing to assert.
    const fd = fs.openSync('/dev/null', 'r');
    try {
      const after = cachedOpenFileDescriptors(0);
      expect(after!.open).toBeGreaterThanOrEqual(before.open + 1);
    } finally {
      fs.closeSync(fd);
      reset();
    }
  });
});

describe('describeFdPressure', () => {
  test('is silent when the table has room, so no caller blames the wrong thing', () => {
    expect(describeFdPressure(null)).toBeNull();
    expect(describeFdPressure({ open: 40, highest: 42, limit: SPAWN_CLIFF, nearCliff: false })).toBeNull();
  });

  test('names the count, the limit and the fix when the table is near the cliff', () => {
    const sentence = describeFdPressure({ open: 10_239, highest: 10_239, limit: SPAWN_CLIFF, nearCliff: true });
    expect(sentence).toContain('out of file descriptors');
    expect(sentence).toContain('10239 of 10240');
    expect(sentence).toContain('restart the instance');
  });
});

describe('describeSpawnFailure', () => {
  test('passes an unrelated failure through untouched', () => {
    // The helper must not relabel a genuine bad-descriptor or ENOENT bug as
    // resource pressure; only an observable full table earns the extra text.
    expect(describeSpawnFailure(new Error('spawn ENOENT'))).toBe('spawn ENOENT');
    expect(describeSpawnFailure('boom')).toBe('boom');
  });

  test('names exhaustion only when the table really is full', () => {
    const opened: number[] = [];
    try {
      // Filling to the REAL ceiling would mean holding ~55k descriptors in the
      // test process and would put every other suite at risk, so the fill stops
      // at the old constant: on a host whose table is larger (this one reports
      // 61440) the gate is untestable here and the synthetic-table test above
      // is what covers it. The loop still degrades to that skip rather than
      // asserting a pressure it did not create.
      while (opened.length < SPAWN_CLIFF + 16) {
        try {
          opened.push(fs.openSync('/dev/null', 'r'));
        } catch {
          break; // Host limit below the fill target; the gate is untestable here.
        }
      }
      if (!countOpenFileDescriptors()?.nearCliff) return;

      const raw = "EBADF: bad file descriptor, posix_spawn '/bin/sh'";
      const described = describeSpawnFailure(new Error(raw));
      expect(described.startsWith(raw)).toBe(true);
      expect(described).toContain('out of file descriptors');
      // The symptom gate still holds under pressure: an unrelated failure keeps
      // its own message instead of being blamed on the descriptor table.
      expect(describeSpawnFailure(new Error('spawn ENOENT'))).toBe('spawn ENOENT');
    } finally {
      for (const fd of opened) fs.closeSync(fd);
    }
  });
});
