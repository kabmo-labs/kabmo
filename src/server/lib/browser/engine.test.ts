/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The engine probe behind the Browser Agent panel's notice.
 *
 * The panel can only mirror Chromium, so this answer decides whether it shows
 * a live view or an explanation. The cases pin the two ways it could lie:
 * claiming Chromium when omp will open WebKit (the panel then waits forever),
 * and claiming WebKit when the engine is not installed (omp falls back to
 * Chromium and the panel would refuse a view it can actually show).
 */

import { describe, expect, test } from 'bun:test';
import { readBrowserEngineState, webkitHostCandidates } from '@/server/lib/browser/engine';

const HOME = '/home/tester';
const DEFAULT_HOST = `${HOME}/.o2/lib/abkit/ABHost`;

function deps(config: Record<string, unknown>, files: string[]) {
  return {
    readConfig: async (key: string) => config[key],
    exists: async (file: string) => files.includes(file),
    home: HOME,
    platform: 'darwin' as const,
  };
}

describe('webkitHostCandidates', () => {
  test('defaults to the ABKit host under the home directory', () => {
    expect(webkitHostCandidates(undefined, HOME, 'darwin')).toEqual([DEFAULT_HOST]);
  });

  test('a configured engine directory also offers the host inside it', () => {
    expect(webkitHostCandidates('/opt/abkit', HOME, 'darwin')).toEqual([
      '/opt/abkit',
      '/opt/abkit/ABHost',
    ]);
  });

  test('a configured executable is offered as-is', () => {
    expect(webkitHostCandidates('/opt/abkit/ABHost', HOME, 'darwin')).toEqual([
      '/opt/abkit/ABHost',
      '/opt/abkit/ABHost/ABHost',
    ]);
  });

  test('windows names the host ABHost.exe', () => {
    expect(webkitHostCandidates(undefined, 'C:\\Users\\t', 'win32')).toEqual([
      'C:\\Users\\t\\.o2\\lib\\abkit\\ABHost.exe',
    ]);
  });

  test('~ expands against the given home, never the real one', () => {
    expect(webkitHostCandidates('~/engines/abkit', HOME, 'darwin')).toEqual([
      `${HOME}/engines/abkit`,
      `${HOME}/engines/abkit/ABHost`,
    ]);
  });
});

describe('readBrowserEngineState', () => {
  test('WebKit is the default when the engine is installed', async () => {
    expect(await readBrowserEngineState(deps({}, [DEFAULT_HOST]))).toEqual({
      webkit: true,
      engineInstalled: true,
      effective: 'webkit',
    });
  });

  test('browser.webkit false selects Chromium even with the engine installed', async () => {
    const state = await readBrowserEngineState(
      deps({ 'browser.webkit': false }, [DEFAULT_HOST]),
    );
    expect(state).toEqual({ webkit: false, engineInstalled: true, effective: 'chromium' });
  });

  test('a missing engine falls back to Chromium', async () => {
    expect(await readBrowserEngineState(deps({}, []))).toEqual({
      webkit: true,
      engineInstalled: false,
      effective: 'chromium',
    });
  });

  test('a configured engine directory is honoured', async () => {
    const state = await readBrowserEngineState(
      deps({ 'browser.webkitPath': '/opt/abkit' }, ['/opt/abkit/ABHost']),
    );
    expect(state.effective).toBe('webkit');
  });

  test('a config read failure keeps the documented default instead of promising Chromium', async () => {
    const state = await readBrowserEngineState({
      readConfig: async () => {
        throw new Error('omp binary not found');
      },
      exists: async () => true,
      home: HOME,
      platform: 'darwin',
    });
    expect(state).toEqual({ webkit: true, engineInstalled: true, effective: 'webkit' });
  });
});
