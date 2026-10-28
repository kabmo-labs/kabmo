/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Utility to determine whether the application is running in MOCK mode.
 *
 * - When MOCK=true (or MOCK=1): all data uses mock / simulated presets (demo chat traces, mock token analytics, mock settings presets).
 * - When MOCK=false (or MOCK=0): all data uses real data (real SQLite persistence, real token calculations, real workspace state).
 * - Unset (or any unrecognized value) defaults to REAL data — Kabmo is a
 *   diagnostic console for a live omp install, so demo presets must be opted
 *   into explicitly rather than inherited by omission.
 */
export function isMockMode(): boolean {
  const envVal = (Bun.env.MOCK || '').trim().toLowerCase();

  return envVal === 'true' || envVal === '1' || envVal === 'on' || envVal === 'yes';
}

export function getMockModeInfo(): { isMock: boolean; rawEnv: string } {
  const isMock = isMockMode();
  return {
    isMock,
    rawEnv: Bun.env.MOCK || (isMock ? 'true' : 'false (default)'),
  };
}
