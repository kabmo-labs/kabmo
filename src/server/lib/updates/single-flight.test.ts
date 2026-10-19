/**
 * The single-flight contract for updates. Two properties matter and neither is
 * visible from the call site: a run refusing to start while another holds the
 * slot, and the slot always being free again afterwards — a stuck claim would
 * answer "already running" until the server restarted.
 */

import { describe, expect, test } from 'bun:test';

import { runningUpdate, UpdateInProgressError, withUpdateSlot } from '@/server/lib/updates/single-flight';

/** A run that stays open until `release()` is called. */
function deferred() {
  let release!: (value: string) => void;
  const promise = new Promise<string>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('withUpdateSlot', () => {
  test('a run is refused while another holds the slot', async () => {
    const gate = deferred();
    const running = withUpdateSlot('omp', () => gate.promise);
    expect(runningUpdate()).toBe('omp');

    await expect(withUpdateSlot('ompchamber', async () => 'never')).rejects.toThrow(UpdateInProgressError);

    gate.release('done');
    await expect(running).resolves.toBe('done');
  });

  test('the refusal names the update that is already running', async () => {
    const gate = deferred();
    const running = withUpdateSlot('ompchamber', () => gate.promise);

    const error = await withUpdateSlot('omp', async () => 'never').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UpdateInProgressError);
    expect((error as Error).message).toContain('Kabmo');

    gate.release('done');
    await expect(running).resolves.toBe('done');
  });

  test('the slot is free again once the run settles', async () => {
    await expect(withUpdateSlot('omp', async () => 'first')).resolves.toBe('first');

    expect(runningUpdate()).toBeNull();
    await expect(withUpdateSlot('omp', async () => 'ok')).resolves.toBe('ok');
  });

  test('a run that throws does not leave the slot held', async () => {
    await expect(
      withUpdateSlot('omp', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(runningUpdate()).toBeNull();
  });
});
