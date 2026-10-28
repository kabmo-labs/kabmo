/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which probe answers on this platform.
 *
 * The choice is by `process.platform` at module load, exactly as Kabmo's
 * own liveness probe chooses its backend — no caller knows which one it got.
 *
 * Windows gets the unsupported answer rather than a fabricated one. There is no
 * `/proc` and no `ps`, and the only subprocess-free route to another process's
 * CPU is `Get-Counter`, which reports a *sampled* percentage with no cumulative
 * counter to difference and no resident size at all. Shipping that would put a
 * different quantity in the same column as the other platforms' figures, which
 * is worse than the panel saying it cannot measure here.
 */

import { darwinProbe } from './darwin';
import { linuxProbe } from './linux';
import { psProbe } from './ps';
import type { ProcProbe } from './types';

/** The probe for the running platform. */
function selectProbe(): ProcProbe {
  switch (process.platform) {
    case 'darwin':
      return darwinProbe;
    case 'linux':
      return linuxProbe;
    case 'win32':
      return {
        name: 'win32',
        supported: false,
        reason:
          'Windows exposes no cumulative CPU counter or resident size for a foreign process without a subprocess, so this panel cannot report the same figures here.',
        list: () => [],
      };
    default:
      return psProbe;
  }
}

export const procProbe: ProcProbe = selectProbe();
