/**
 * Applies a requested update. oh-my-pi is updated through the omp binary;
 * Kabmo through the shared self-update engine, which replaces the running
 * install in place (bun global install, or git fast-forward + rebuild).
 *
 * Neither branch restarts anything: this module only reports what happened.
 * The caller decides, because the console has to flush the result to the
 * browser BEFORE the process that is serving it goes away.
 */

import { updateOmpChamber } from '@/server/lib/updates/install';
import { applyOmpUpdate } from '@/server/lib/updates/omp';
import { withUpdateSlot } from '@/server/lib/updates/single-flight';
import { recycleStandbyProcesses } from '@/server/lib/omp/session/standby.server';
import type { UpdateApplyResult, UpdateTarget } from '@/shared/types/updates';

/** A stage label or a line of command output, as the update produces it. */
export interface UpdateProgressHooks {
  onLine?: (chunk: string) => void;
  onStage?: (label: string) => void;
}

/**
 * `updated` is what the caller needs to decide about a restart: an "already up
 * to date" answer is a success that must not bounce a healthy server.
 */
export interface AppliedUpdate {
  result: UpdateApplyResult;
  updated: boolean;
}

/**
 * Runs one update, and refuses to start while another holds the slot — see
 * `single-flight.ts` for why the console cannot be the gate. The refusal is
 * thrown, not returned as a result: it is the caller's decision whether that is
 * a 409 before the work starts or a failure frame inside it.
 */
export async function applyUpdate(target: UpdateTarget, hooks: UpdateProgressHooks = {}): Promise<AppliedUpdate> {
  return withUpdateSlot(target, async () => {
    if (target === 'omp') {
      try {
        const { output, updated } = await applyOmpUpdate({ onLine: hooks.onLine });
        // A replaced binary leaves every standby process on the old build, and
        // nothing else would ever notice: the utility pool answers the provider
        // and model lists for up to five minutes and a prewarmed session host
        // waits for the next send. Recycled only when the install actually
        // moved — an "already up to date" run must not bounce a warm pool.
        if (updated) await recycleStandbyProcesses();
        return {
          result: { success: true, target: 'omp', manual: false, message: updated ? 'oh-my-pi updated' : 'oh-my-pi is already up to date', output },
          updated,
        };
      } catch (err) {
        return {
          result: {
            success: false,
            target: 'omp',
            manual: false,
            message: err instanceof Error ? err.message : 'Failed to update oh-my-pi',
          },
          updated: false,
        };
      }
    }

    if (target === 'ompchamber') {
      const result = await updateOmpChamber({ onLine: hooks.onLine, onStage: hooks.onStage });
      return {
        result: {
          success: result.success,
          target: 'ompchamber',
          manual: result.manual,
          message: result.message,
          output: result.output || undefined,
        },
        updated: result.updated,
      };
    }

    return {
      result: { success: false, target, manual: true, message: 'Unknown update target' },
      updated: false,
    };
  });
}
