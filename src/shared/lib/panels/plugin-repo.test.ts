/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The GitHub plugin-repository naming rule.
 *
 * Every case here is a URL that reached a refusal or an install, so the pinned
 * behaviour is: the SAME repository is recognised through every spelling git
 * accepts (a spelling that slipped through would be a way past the rule), the
 * rule applies to GitHub only, and the plugin name derived from a compliant
 * repository has no prefix in it.
 */

import { describe, expect, test } from 'bun:test';
import {
  KABMO_PLUGIN_REPO_PREFIX,
  normalisePluginSpec,
  parseGithubPluginRepo,
  pluginNameFromRepo,
  pluginRepoKey,
  pluginRepoNameError,
  samePluginRepo,
} from '@/shared/lib/panels/plugin-repo';

describe('parseGithubPluginRepo', () => {
  test('reads every spelling of one repository', () => {
    const expected = { owner: 'acme', repo: 'kabmo-plugins-panel' };
    for (const url of [
      'https://github.com/acme/kabmo-plugins-panel',
      'https://github.com/acme/kabmo-plugins-panel.git',
      'https://github.com/acme/kabmo-plugins-panel/',
      'https://github.com/acme/kabmo-plugins-panel.git/',
      'https://github.com/acme/kabmo-plugins-panel/tree/main',
      'http://github.com/acme/kabmo-plugins-panel',
      'https://www.github.com/acme/kabmo-plugins-panel',
      'ssh://git@github.com/acme/kabmo-plugins-panel.git',
      'git@github.com:acme/kabmo-plugins-panel.git',
    ]) {
      expect(parseGithubPluginRepo(url), url).toEqual(expected);
    }
  });

  test('is null for another host or a local path', () => {
    for (const value of [
      'https://gitlab.com/acme/kabmo-plugins-panel',
      'git@gitlab.example:team/panels.git',
      '/srv/repos/kabmo-plugins-panel',
      '~/repos/kabmo-plugins-panel',
      'kabmo-plugins-panel',
      '',
    ]) {
      expect(parseGithubPluginRepo(value), value).toBeNull();
    }
  });
});

describe('pluginRepoNameError', () => {
  test('accepts a prefixed GitHub repository', () => {
    expect(pluginRepoNameError('https://github.com/acme/kabmo-plugins-kanban')).toBeNull();
  });

  test('refuses an unprefixed GitHub repository and names the rule', () => {
    const error = pluginRepoNameError('https://github.com/acme/kanban-panel');
    expect(error).toContain(`"${KABMO_PLUGIN_REPO_PREFIX}<plugin>"`);
    expect(error).toContain('acme/kanban-panel');
    expect(error).toContain("plugin's own name does not need the prefix");
  });

  test('does not restrict a non-GitHub source', () => {
    expect(pluginRepoNameError('https://gitlab.com/acme/kanban-panel')).toBeNull();
    expect(pluginRepoNameError('/srv/repos/kanban-panel')).toBeNull();
  });
});

describe('pluginNameFromRepo', () => {
  test('strips the prefix and lowercases, which is the plugin name', () => {
    expect(pluginNameFromRepo('https://github.com/acme/kabmo-plugins-Kanban')).toBe('kanban');
    expect(pluginNameFromRepo('git@github.com:acme/kabmo-plugins-kanban.git')).toBe('kanban');
  });

  test('is null for a repository that does not follow the rule', () => {
    expect(pluginNameFromRepo('https://github.com/acme/kanban')).toBeNull();
    expect(pluginNameFromRepo('https://github.com/acme/kabmo-plugins-')).toBeNull();
  });
});

describe('samePluginRepo and pluginRepoKey', () => {
  test('one repository has one identity across spellings', () => {
    const https = 'https://github.com/Acme/kabmo-plugins-Kanban.git';
    const ssh = 'git@github.com:acme/kabmo-plugins-kanban';
    expect(samePluginRepo(https, ssh)).toBe(true);
    expect(pluginRepoKey(https)).toBe('acme/kabmo-plugins-kanban');
    expect(pluginRepoKey(ssh)).toBe('acme/kabmo-plugins-kanban');
  });

  test('different repositories are different', () => {
    expect(samePluginRepo('https://github.com/acme/kabmo-plugins-a', 'https://github.com/acme/kabmo-plugins-b')).toBe(
      false,
    );
  });
});

describe('normalisePluginSpec', () => {
  test('keeps a URL, expands owner/repo, and leaves a bare name unresolved', () => {
    expect(normalisePluginSpec('https://github.com/acme/kabmo-plugins-x')).toBe('https://github.com/acme/kabmo-plugins-x');
    expect(normalisePluginSpec('acme/kabmo-plugins-x')).toBe('https://github.com/acme/kabmo-plugins-x');
    expect(normalisePluginSpec('/srv/repos/x')).toBe('/srv/repos/x');
    expect(normalisePluginSpec('kanban')).toBeNull();
    expect(normalisePluginSpec('  ')).toBeNull();
  });
});
