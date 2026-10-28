/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The remote → wiki URL mapping.
 *
 * Both hosts publish a wiki at `<origin>.wiki.git`, which is the whole reason
 * one implementation covers them; the cases here are the shapes a real
 * workspace holds — the public HTTPS remote, the self-hosted GitLab remote that
 * carries its own basic-auth user, and an SSH remote — plus the ones that must
 * be refused rather than fetched (a local path, an empty value).
 *
 * The credential case is the load-bearing one: the URL that authenticates the
 * fetch is the URL that must never reach the page.
 */

import { describe, expect, test } from 'bun:test';
import { parseWikiRemote, redactRemoteUrl, wikiWebUrl } from '@/server/lib/wiki/remote';

describe('parseWikiRemote', () => {
  test('appends the wiki suffix to an https remote', () => {
    const parsed = parseWikiRemote('https://github.com/jgraph/drawio.git');
    expect(parsed).toMatchObject({
      host: 'github.com',
      slug: 'jgraph/drawio',
      projectUrl: 'https://github.com/jgraph/drawio',
      wikiRemote: 'https://github.com/jgraph/drawio.wiki.git',
    });
  });

  test('works on a remote with no .git suffix', () => {
    expect(parseWikiRemote('https://github.com/rajebdev/outline-cli')?.wikiRemote)
      .toBe('https://github.com/rajebdev/outline-cli.wiki.git');
  });

  test('keeps a self-hosted remote’s own credentials on the fetch URL', () => {
    const parsed = parseWikiRemote('https://user:token@git-rbi.jatismobile.com/jns6_5/drrealhandler.git');
    expect(parsed?.host).toBe('git-rbi.jatismobile.com');
    expect(parsed?.slug).toBe('jns6_5/drrealhandler');
    // The fetch URL authenticates the way the checkout does …
    expect(parsed?.wikiRemote).toBe('https://user:token@git-rbi.jatismobile.com/jns6_5/drrealhandler.wiki.git');
    // … and the project URL that leaves the server does not.
    expect(parsed?.projectUrl).toBe('https://git-rbi.jatismobile.com/jns6_5/drrealhandler');
  });

  test('keeps a GitLab subgroup in the slug', () => {
    const parsed = parseWikiRemote('ssh://git@gitlab.com/group/sub/proj.git');
    expect(parsed?.slug).toBe('group/sub/proj');
    // The fetch URL keeps the remote's own user, exactly as `git fetch` needs it.
    expect(parsed?.wikiRemote).toBe('ssh://git@gitlab.com/group/sub/proj.wiki.git');
  });

  test('accepts an scp-style remote', () => {
    const parsed = parseWikiRemote('git@github.com:owner/name.git');
    expect(parsed).toMatchObject({ host: 'github.com', slug: 'owner/name', wikiRemote: 'git@github.com:owner/name.wiki.git' });
  });

  test('refuses anything a wiki cannot hang off', () => {
    for (const remote of ['', '   ', '/local/bare/path.git', 'https://github.com/onlyowner', 'not a url']) {
      expect(parseWikiRemote(remote)).toBe(null);
    }
  });
});

describe('redactRemoteUrl', () => {
  test('strips the credential and nothing else', () => {
    expect(redactRemoteUrl('https://user:token@host/o/n.git')).toBe('https://host/o/n.git');
    expect(redactRemoteUrl('https://host/o/n.git')).toBe('https://host/o/n.git');
    expect(redactRemoteUrl('git@host:o/n.git')).toBe('git@host:o/n.git');
  });
});

describe('wikiWebUrl', () => {
  test('uses each host’s own wiki path', () => {
    expect(wikiWebUrl('github', 'github.com', 'jgraph/drawio')).toBe('https://github.com/jgraph/drawio/wiki');
    expect(wikiWebUrl('gitlab', 'gitlab.com', 'gitlab-org/cli')).toBe('https://gitlab.com/gitlab-org/cli/-/wikis/home');
  });

  test('says nothing for a host it cannot address', () => {
    expect(wikiWebUrl('other', 'git.example.test', 'o/n')).toBe(null);
  });
});
