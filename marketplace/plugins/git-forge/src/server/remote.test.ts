/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The remote parser, over the shapes a real checkout actually holds.
 *
 * Every case here is a remote this workspace has used or one a self-hosted
 * install produces, because the parser's job is to be right about the URL git
 * reports rather than about a canonical form.
 */

import { describe, expect, test } from 'bun:test';

import { apiBaseFor, bitbucketPath, gitlabProject, parseRemote, providerForHost } from './remote';

function parsed(raw: string, options?: Parameters<typeof parseRemote>[1]) {
  const result = parseRemote(raw, options);
  if ('error' in result) throw new Error(`expected a remote, got: ${result.error}`);
  return result;
}

describe('parseRemote', () => {
  test('reads an https GitHub remote', () => {
    const remote = parsed('https://github.com/kabmo-labs/kabmo.git');
    expect(remote.provider).toBe('github');
    expect(remote.host).toBe('github.com');
    expect(remote.slug).toBe('kabmo-labs/kabmo');
    expect(remote.webUrl).toBe('https://github.com/kabmo-labs/kabmo');
    expect(remote.apiBase).toBe('https://api.github.com');
  });

  test('reads the scp form, which is what a checkout usually holds', () => {
    const remote = parsed('git@github.com:kabmo-labs/kabmo.git');
    expect(remote.provider).toBe('github');
    expect(remote.host).toBe('github.com');
    expect(remote.slug).toBe('kabmo-labs/kabmo');
    expect(remote.webUrl).toBe('https://github.com/kabmo-labs/kabmo');
  });

  test('reads an ssh:// remote', () => {
    const remote = parsed('ssh://git@github.com/kabmo-labs/kabmo.git');
    expect(remote.slug).toBe('kabmo-labs/kabmo');
    expect(remote.apiBase).toBe('https://api.github.com');
  });

  test('strips credentials instead of echoing them', () => {
    const remote = parsed('https://user:ghp_secret@git-rbi.jatismobile.com/jns6_5/drrealhandler.git');
    expect(remote.host).toBe('git-rbi.jatismobile.com');
    expect(remote.webUrl).toBe('https://git-rbi.jatismobile.com/jns6_5/drrealhandler');
    expect(JSON.stringify(remote)).not.toContain('ghp_secret');
  });

  test('treats a host that is not GitHub as GitLab', () => {
    const remote = parsed('https://git-rbi.jatismobile.com/jns6_5/drrealhandler.git');
    expect(remote.provider).toBe('gitlab');
    expect(remote.apiBase).toBe('https://git-rbi.jatismobile.com/api/v4');
  });

  test('keeps a GitLab subgroup in the slug', () => {
    const remote = parsed('git@gitlab.com:group/sub/project.git');
    expect(remote.slug).toBe('group/sub/project');
    expect(gitlabProject(remote.slug)).toBe('group%2Fsub%2Fproject');
  });

  test('reads a GitHub Enterprise host as GitHub, with its /api/v3 root', () => {
    const remote = parsed('https://github.mycorp.com/team/app');
    expect(remote.provider).toBe('github');
    expect(remote.apiBase).toBe('https://github.mycorp.com/api/v3');
  });

  test('keeps a port and the http scheme', () => {
    const remote = parsed('http://localhost:3000/team/app.git');
    expect(remote.host).toBe('localhost:3000');
    expect(remote.provider).toBe('gitlab');
    expect(remote.apiBase).toBe('http://localhost:3000/api/v4');
    expect(remote.webUrl).toBe('http://localhost:3000/team/app');
  });

  test('a provider setting beats the guess', () => {
    const remote = parsed('https://github.com/kabmo-labs/kabmo.git', { provider: 'gitlab' });
    expect(remote.provider).toBe('gitlab');
    expect(remote.apiBase).toBe('https://github.com/api/v4');
  });

  test('an apiBase setting beats the derived root', () => {
    const remote = parsed('https://github.com/kabmo-labs/kabmo.git', { apiBase: 'https://proxy.local/gh/' });
    expect(remote.apiBase).toBe('https://proxy.local/gh');
  });

  test('refuses a local path', () => {
    for (const raw of ['/srv/repo', './repo', 'C:\\repo', 'C:/repo']) {
      expect('error' in parseRemote(raw)).toBe(true);
    }
  });

  test('refuses a remote with no repository in it', () => {
    expect('error' in parseRemote('https://github.com/onlyowner')).toBe(true);
    expect('error' in parseRemote('')).toBe(true);
    expect('error' in parseRemote(null)).toBe(true);
  });
});

describe('providerForHost', () => {
  test('the four hosts each resolve, and a name that contains another does not win', () => {
    expect(providerForHost('github.com')).toBe('github');
    expect(providerForHost('github.mycorp.com')).toBe('github');
    expect(providerForHost('gitlab.com')).toBe('gitlab');
    expect(providerForHost('git-rbi.jatismobile.com')).toBe('gitlab');
    expect(providerForHost('gitea.example.com')).toBe('gitea');
    expect(providerForHost('codeberg.org')).toBe('gitea');
    expect(providerForHost('forgejo.internal')).toBe('gitea');
    expect(providerForHost('bitbucket.org')).toBe('bitbucket');
    // `gitbucket` contains `bucket` but is not Bitbucket, and its own name says
    // nothing else either — so it falls to the default rather than matching a
    // host it is not.
    expect(providerForHost('gitbucket.example.com')).toBe('gitlab');
  });
});

describe('bitbucketPath', () => {
  test('two segments split; a subgroup is refused rather than guessed', () => {
    expect(bitbucketPath('team/repo')).toEqual({ workspace: 'team', repo: 'repo' });
    expect(bitbucketPath('group/sub/repo')).toBeNull();
    expect(bitbucketPath('lonely')).toBeNull();
  });
});

describe('apiBaseFor', () => {
  test('github.com is the one host with no path prefix', () => {
    expect(apiBaseFor('github', 'github.com', 'https')).toBe('https://api.github.com');
    expect(apiBaseFor('github', 'ghe.internal', 'https')).toBe('https://ghe.internal/api/v3');
    expect(apiBaseFor('gitlab', 'gitlab.com', 'https')).toBe('https://gitlab.com/api/v4');
    expect(apiBaseFor('gitea', 'gitea.example.com', 'https')).toBe('https://gitea.example.com/api/v1');
  });

  test('Bitbucket Cloud is not on the repository hostname', () => {
    expect(apiBaseFor('bitbucket', 'bitbucket.org', 'https')).toBe('https://api.bitbucket.org/2.0');
    // A self-hosted Bitbucket SERVER is a different API (1.0, on its own host),
    // so the override is the only way to reach one — documented, not guessed.
    expect(apiBaseFor('bitbucket', 'bitbucket.internal', 'https', 'https://bitbucket.internal/rest/api/1.0/')).toBe(
      'https://bitbucket.internal/rest/api/1.0',
    );
  });
});
