/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The marketplace catalog parser.
 *
 * Every rule here is a refusal, and a refusal is exactly the kind of answer that
 * goes unnoticed when it is wrong — a plugin that fails to install with no
 * reason reads as a plugin that was never listed. So each rejection is pinned
 * with the sentence the pane will show.
 *
 * The naming rule is the newest of them: a remote GitHub source must name a
 * `kabmo-plugins-<plugin>` repository, and a registered repository must be that
 * same kind of repository. Both are refused HERE, before a clone, so the cost of
 * getting the name wrong is a message rather than a timeout.
 */

import { describe, expect, test } from 'bun:test';
import {
  toMarketplaceCatalog,
  toMarketplaceRegistries,
} from '@/server/lib/panels/marketplace-catalog.server';

const ROOT = '/market/plugins/demo';

describe('toMarketplaceCatalog', () => {
  test('accepts a catalog with no plugins array as empty', () => {
    expect(toMarketplaceCatalog({ name: 'Acme' }, ROOT)).toMatchObject({ name: 'Acme', plugins: [] });
  });

  test('accepts an empty object', () => {
    expect(toMarketplaceCatalog({}, ROOT)).toMatchObject({ plugins: [] });
  });

  test('keeps a valid entry with its metadata', () => {
    const result = toMarketplaceCatalog(
      { plugins: [{ name: 'demo', source: 'plugins/demo', description: 'd', category: 'tools' }] },
      ROOT,
    );
    expect(result).toMatchObject({ plugins: [{ name: 'demo', source: 'plugins/demo', category: 'tools' }] });
  });

  test('refuses an entry with no source', () => {
    expect(toMarketplaceCatalog({ plugins: [{ name: 'demo' }] }, ROOT)).toMatchObject({
      error: expect.stringContaining('has no source'),
    });
  });

  test('refuses a source escaping the marketplace root', () => {
    expect(toMarketplaceCatalog({ plugins: [{ name: 'evil', source: '../../etc' }] }, ROOT)).toMatchObject({
      error: expect.stringContaining('escapes the marketplace directory'),
    });
  });

  test('accepts a REMOTE git source and marks it, without an escape check', () => {
    // There is no root to escape: the entry is an offer, and the installer
    // clones the URL. Reading it as a relative path is the failure this pins.
    const result = toMarketplaceCatalog(
      {
        plugins: [
          { name: 'acme', source: 'https://github.com/acme/kabmo-plugins-panels.git', version: '1.4.0' },
          { name: 'gitlab', source: 'git@gitlab.example:team/panels.git' },
          { name: 'local', source: 'plugins/local' },
        ],
      },
      ROOT,
    );
    expect(result).toMatchObject({
      plugins: [
        { name: 'acme', source: 'https://github.com/acme/kabmo-plugins-panels.git', remote: true, version: '1.4.0' },
        { name: 'gitlab', remote: true },
        { name: 'local', source: 'plugins/local' },
      ],
    });
    // A directory source carries no marker at all — absence is "a directory".
    if ('error' in result) throw new Error(result.error);
    expect(result.plugins?.[2]?.remote).toBeUndefined();
  });

  test('carries an entry author and homepage through', () => {
    expect(
      toMarketplaceCatalog(
        { plugins: [{ name: 'demo', source: 'plugins/demo', author: { name: 'Acme' }, homepage: 'https://acme.example' }] },
        ROOT,
      ),
    ).toMatchObject({ plugins: [{ author: { name: 'Acme' }, homepage: 'https://acme.example' }] });
  });

  test('refuses a non-array plugins field', () => {
    expect(toMarketplaceCatalog({ plugins: 'x' }, ROOT)).toMatchObject({
      error: expect.stringContaining('must be an array'),
    });
  });

  test('refuses a non-object body', () => {
    expect(toMarketplaceCatalog(null, ROOT)).toMatchObject({ error: expect.stringContaining('not an object') });
  });

  test('refuses a REMOTE source whose repository breaks the naming rule', () => {
    expect(
      toMarketplaceCatalog({ plugins: [{ name: 'kanban', source: 'https://github.com/acme/kanban' }] }, ROOT),
    ).toMatchObject({ error: expect.stringContaining('must be named "kabmo-plugins-<plugin>"') });
  });

  test('accepts registries and canonicalises the owner/repo shorthand', () => {
    const result = toMarketplaceCatalog(
      {
        plugins: [],
        registries: [
          { repo: 'acme/kabmo-plugins-kanban', name: 'Kanban' },
          { repo: 'https://github.com/acme/kabmo-plugins-stats.git', description: 'Stats panels' },
        ],
      },
      ROOT,
    );
    expect(result).toMatchObject({
      registries: [
        { repo: 'acme/kabmo-plugins-kanban', name: 'Kanban' },
        { repo: 'acme/kabmo-plugins-stats', description: 'Stats panels' },
      ],
    });
  });

  test('a catalog with no registries carries none, rather than an empty array', () => {
    const result = toMarketplaceCatalog({}, ROOT);
    if ('error' in result) throw new Error(result.error);
    expect(result.registries).toBeUndefined();
  });
});

describe('toMarketplaceRegistries', () => {
  test('an absent list is empty', () => {
    expect(toMarketplaceRegistries(undefined)).toEqual({ value: [] });
  });

  test('refuses a registration that is not GitHub, or not prefixed', () => {
    expect(toMarketplaceRegistries([{ repo: 'https://gitlab.com/acme/kabmo-plugins-x' }])).toMatchObject({
      error: expect.stringContaining('is not a GitHub repository'),
    });
    expect(toMarketplaceRegistries([{ repo: 'acme/kanban' }])).toMatchObject({
      error: expect.stringContaining('kabmo-plugins-'),
    });
    expect(toMarketplaceRegistries([{ repo: '' }])).toMatchObject({
      error: expect.stringContaining('has no repo'),
    });
  });

  test('refuses a non-array list and a non-object entry', () => {
    expect(toMarketplaceRegistries('x')).toMatchObject({ error: expect.stringContaining('must be an array') });
    expect(toMarketplaceRegistries([42])).toMatchObject({ error: expect.stringContaining('is not an object') });
  });
});
