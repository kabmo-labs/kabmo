/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one answer three surfaces ask: is there an update, and to what.
 *
 * The states that matter are the ones a naive comparison gets wrong, and each is
 * pinned here because the surfaces disagreeing is invisible until a header counts
 * a button that will not render:
 *
 * - a GIT clone is behind when its remote's COMMIT differs, even at the same
 *   version — a fix shipped without a bump;
 * - a BUNDLED install is behind only on a strictly newer version, because the
 *   store's copy is what it would install;
 * - a LOCAL directory has no source at all and never has an update.
 */

import { describe, expect, test } from 'bun:test';
import { countPluginUpdates, pluginUpdate } from '@/shared/lib/panels/update';
import type { PanelGitStatus, PanelPluginStatus } from '@/shared/types';

const clone = (overrides: Partial<PanelPluginStatus> = {}): PanelPluginStatus => ({
  pluginId: 'git-plugin',
  name: 'Git Plugin',
  version: '1.0.0',
  built: true,
  isPackage: true,
  enabled: true,
  bundled: false,
  origin: 'git',
  gitOrigin: 'https://example.test/plugin.git',
  ...overrides,
});

const status = (overrides: Partial<PanelGitStatus> = {}): PanelGitStatus => ({
  current: 'aaaaaaa',
  latest: 'bbbbbbb',
  updateAvailable: true,
  checkedAt: Date.now(),
  ...overrides,
});

describe('a git clone', () => {
  test('is behind when the probe says its commit moved', () => {
    expect(pluginUpdate(clone(), status())).toEqual({});
  });

  test('names the version the remote declares, so the button can say what it installs', () => {
    expect(pluginUpdate(clone(), status({ latestVersion: '1.1.0' }))).toEqual({ version: '1.1.0' });
  });

  test('is current when the probe found nothing, whatever the versions say', () => {
    // The probe is the authority: a remote at the same commit cannot install
    // anything, so a stale `latestVersion` must not resurrect the button.
    expect(pluginUpdate(clone({ latestVersion: '9.9.9' }), status({ updateAvailable: false }))).toBeNull();
  });

  test('is unknown, not current, when it was never probed', () => {
    // A `latestVersion` with no probe behind it describes a status the probe
    // never wrote, so the button stays off until the remote is actually asked.
    expect(pluginUpdate(clone({ latestVersion: '1.2.0' }), undefined)).toBeNull();
  });

  test('is unknown, not current, when the probe errored', () => {
    expect(pluginUpdate(clone(), status({ updateAvailable: false, error: 'unreachable' }))).toBeNull();
  });
});

describe('a bundled install', () => {
  const bundled = (overrides: Partial<PanelPluginStatus> = {}) =>
    clone({ pluginId: 'store-plugin', origin: 'bundled', bundled: true, gitOrigin: null, ...overrides });

  test('is behind when the store ships a newer version', () => {
    expect(pluginUpdate(bundled({ latestVersion: '2.0.0' }), undefined)).toEqual({ version: '2.0.0' });
  });

  test('is current at the same version', () => {
    expect(pluginUpdate(bundled({ latestVersion: '1.0.0' }), undefined)).toBeNull();
  });

  test('is current when the store version is unknown', () => {
    expect(pluginUpdate(bundled(), undefined)).toBeNull();
  });
});

describe('a local directory', () => {
  test('never has an update, even when a version looks newer', () => {
    expect(
      pluginUpdate(clone({ origin: 'local', gitOrigin: null, latestVersion: '2.0.0' }), status()),
    ).toBeNull();
  });
});

describe('the count', () => {
  test('counts exactly the cards that would render an Update', () => {
    const plugins = [
      clone({ pluginId: 'a' }),
      clone({ pluginId: 'b', origin: 'bundled', bundled: true, gitOrigin: null, latestVersion: '2.0.0' }),
      clone({ pluginId: 'c', origin: 'local', gitOrigin: null }),
      clone({ pluginId: 'd', origin: 'bundled', bundled: true, gitOrigin: null, latestVersion: '1.0.0' }),
    ];
    // `a` is behind by commit, `b` by version; `c` and `d` are current.
    expect(countPluginUpdates(plugins, { a: status() })).toBe(2);
  });
});
