/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The install remedy, and the promise that nobody wrote a second copy of it.
 *
 * Kabmo refuses to start without `omp`, so this text is the first and sometimes
 * only thing a new user reads. Four surfaces print it — the startup refusal,
 * `--help`, `status` and `doctor` — and the failure mode is precisely that they
 * drift: one names the package, another names an installer, and the user is
 * left with two answers. Pinning both commands here means a surface that stops
 * using this module fails a suite instead of quietly disagreeing.
 */

import { describe, expect, test } from 'bun:test';

import { OMP_INSTALL_SCRIPT_URL, ompInstallCommands, ompInstallHintLines } from '@/server/lib/omp/core/install-hint';
import { OMP_PACKAGE } from '@/server/lib/updates/npm';

describe('ompInstallCommands', () => {
  test('the source route names the package the update path already resolves against', () => {
    expect(ompInstallCommands().source).toBe(`bun install -g ${OMP_PACKAGE}`);
  });

  test('the binary route is omp own installer', () => {
    expect(OMP_INSTALL_SCRIPT_URL).toBe('https://omp.sh/install');
    expect(ompInstallCommands().binary).toBe(`curl -fsSL ${OMP_INSTALL_SCRIPT_URL} | sh`);
  });
});

describe('ompInstallHintLines', () => {
  test('three lines: both routes and the verification', () => {
    const lines = ompInstallHintLines();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('bun install -g');
    expect(lines[1]).toContain('omp.sh/install');
    // `omp --version` is the check `readOmpInstalledVersion` performs, so a
    // user running it sees exactly what `doctor` will report.
    expect(lines[2]).toContain('omp --version');
  });

  test('the indent reaches every line, so a caller can nest the block', () => {
    const lines = ompInstallHintLines('    ');
    for (const line of lines) expect(line.startsWith('    ')).toBe(true);
  });
});
