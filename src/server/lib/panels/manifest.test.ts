/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Manifest and catalog validation.
 *
 * Every rule here is a refusal, and a refusal is exactly the kind of answer that
 * goes unnoticed when it is wrong — a plugin that fails to load with no reason
 * reads as a plugin that was never installed. So each rejection is pinned with
 * the sentence the UI will show.
 *
 * A manifest no longer describes panels: its bundle does, when it loads. What
 * is left to validate is the identity and the two paths that become filesystem
 * reads.
 */

import { test, expect, describe } from 'bun:test';
import { toManifest, toMarketplaceCatalog } from '@/server/lib/panels/manifest';

const ROOT = '/market/plugins/demo';

const MANIFEST = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js' };

/** What the minimal manifest parses to — a body with nothing optional added. */
const MANIFEST_EXPECTED = { ...MANIFEST };

describe('toManifest', () => {
  test('accepts a minimal manifest and keeps its optional fields', () => {
    expect(toManifest({ ...MANIFEST, description: 'A demo', icon: 'icon.svg' }, ROOT)).toEqual({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      app: 'dist/app.js',
      description: 'A demo',
      icon: 'icon.svg',
    });
  });

  test('accepts the branding alias for an icon', () => {
    expect(toManifest({ ...MANIFEST, branding: { icon: 'icons/mark.svg' } }, ROOT)).toMatchObject({
      branding: { icon: 'icons/mark.svg' },
    });
  });

  test('refuses a missing app bundle', () => {
    expect(toManifest({ ...MANIFEST, app: undefined }, ROOT)).toMatchObject({
      error: expect.stringContaining('no "app" bundle'),
    });
  });

  test('refuses an app path escaping the plugin root', () => {
    expect(toManifest({ ...MANIFEST, app: '../outside.js' }, ROOT)).toMatchObject({
      error: expect.stringContaining('escapes the plugin directory'),
    });
  });

  test('refuses an absolute app path', () => {
    expect(toManifest({ ...MANIFEST, app: '/etc/passwd' }, ROOT)).toMatchObject({
      error: expect.stringContaining('escapes the plugin directory'),
    });
  });

  test('refuses an icon escaping the root', () => {
    expect(toManifest({ ...MANIFEST, icon: '../x.svg' }, ROOT)).toMatchObject({
      error: expect.stringContaining('escapes the plugin directory'),
    });
  });

  test('refuses a missing or malformed id', () => {
    expect(toManifest({ ...MANIFEST, id: 'has space' }, ROOT)).toMatchObject({
      error: expect.stringContaining('id'),
    });
  });

  test('refuses a missing name and a missing version', () => {
    expect(toManifest({ ...MANIFEST, name: undefined }, ROOT)).toMatchObject({
      error: expect.stringContaining('name'),
    });
    expect(toManifest({ ...MANIFEST, version: undefined }, ROOT)).toMatchObject({
      error: expect.stringContaining('version'),
    });
  });

  test('refuses a non-object body', () => {
    expect(toManifest('nope', ROOT)).toMatchObject({ error: expect.stringContaining('not an object') });
  });

  test('accepts a server-only manifest with no app', () => {
    expect(toManifest({ ...MANIFEST, app: undefined, server: 'dist/server.js' }, ROOT)).toMatchObject({
      server: 'dist/server.js',
    });
  });

  test('refuses a manifest with neither an app nor a server', () => {
    expect(toManifest({ ...MANIFEST, app: undefined }, ROOT)).toMatchObject({
      error: expect.stringContaining('no "app" bundle or "server" entry'),
    });
  });

  test('refuses a server path escaping the plugin root', () => {
    expect(toManifest({ ...MANIFEST, server: '../outside.js' }, ROOT)).toMatchObject({
      error: expect.stringContaining('escapes the plugin directory'),
    });
  });

  test('carries a well-formed engines and capabilities block through', () => {
    const manifest = { ...MANIFEST, engines: { kabmo: '^1.2', pluginSdk: '~2.0' }, capabilities: ['panel'] };
    expect(toManifest(manifest, ROOT)).toMatchObject({
      engines: { kabmo: '^1.2', pluginSdk: '~2.0' },
      capabilities: ['panel'],
    });
  });

  test('refuses a malformed range rather than passing it', () => {
    expect(toManifest({ ...MANIFEST, engines: { kabmo: 'not a range' } }, ROOT)).toMatchObject({
      error: expect.stringContaining('is not a valid version range'),
    });
    expect(toManifest({ ...MANIFEST, engines: { kabmo: '  ' } }, ROOT)).toMatchObject({
      error: expect.stringContaining('is not a version range'),
    });
  });

  test('reads the pre-rename engines key as kabmo, so an old plugin is not refused', () => {
    expect(toManifest({ ...MANIFEST, engines: { ompchamber: '^1.2' } }, ROOT)).toMatchObject({
      engines: { kabmo: '^1.2' },
    });
  });

  test('refuses an unknown engines key', () => {
    expect(toManifest({ ...MANIFEST, engines: { chamber: '^1' } }, ROOT)).toMatchObject({
      error: expect.stringContaining('unknown key'),
    });
  });

  test('refuses a capabilities value that is not an array of strings', () => {
    expect(toManifest({ ...MANIFEST, capabilities: 'panel' }, ROOT)).toMatchObject({
      error: expect.stringContaining('is not an array'),
    });
    expect(toManifest({ ...MANIFEST, capabilities: ['panel', ''] }, ROOT)).toMatchObject({
      error: expect.stringContaining('invalid entry'),
    });
  });

  test('carries a well-formed settings definition through', () => {
    const manifest = { ...MANIFEST, settings: { note: { type: 'string', label: 'Note', default: 'hi' } } };
    expect(toManifest(manifest, ROOT)).toMatchObject({
      settings: { note: { type: 'string', label: 'Note', default: 'hi' } },
    });
  });

  test('refuses a settings definition the host cannot render', () => {
    expect(toManifest({ ...MANIFEST, settings: { mode: { type: 'select', label: 'Mode' } } }, ROOT)).toMatchObject({
      error: expect.stringContaining('unknown type'),
    });
    expect(toManifest({ ...MANIFEST, settings: { mode: { type: 'string' } } }, ROOT)).toMatchObject({
      error: expect.stringContaining('no label'),
    });
  });

  test('reads an author given as a name, and as an object with a URL', () => {
    expect(toManifest({ ...MANIFEST, author: 'Ada Lovelace' }, ROOT)).toMatchObject({
      author: { name: 'Ada Lovelace' },
    });
    expect(
      toManifest({ ...MANIFEST, author: { name: 'Acme', url: 'https://acme.example', email: 'a@acme.example' } }, ROOT),
    ).toMatchObject({ author: { name: 'Acme', url: 'https://acme.example', email: 'a@acme.example' } });
  });

  test('drops an author with no usable name instead of refusing the plugin', () => {
    // A credit is not a requirement: a malformed one must not cost the user a
    // plugin that works.
    expect(toManifest({ ...MANIFEST, author: { email: 'nobody@example' } }, ROOT)).toEqual(MANIFEST_EXPECTED);
    expect(toManifest({ ...MANIFEST, author: '   ' }, ROOT)).toEqual(MANIFEST_EXPECTED);
    expect(toManifest({ ...MANIFEST, author: 42 }, ROOT)).toEqual(MANIFEST_EXPECTED);
  });

  test('keeps declared slots in the canonical order and drops unknown names', () => {
    // Order is the table's, so the same plugin cannot list its slots two ways
    // depending on how its manifest happened to be written.
    expect(toManifest({ ...MANIFEST, slots: ['headerPanel', 'rightPanel', 'nope'] }, ROOT)).toMatchObject({
      slots: ['rightPanel', 'headerPanel'],
    });
    // A declaration that names nothing real is absent, not an empty array.
    expect(toManifest({ ...MANIFEST, slots: ['nope'] }, ROOT)).not.toHaveProperty('slots');
    expect(toManifest({ ...MANIFEST, slots: 'rightPanel' }, ROOT)).not.toHaveProperty('slots');
  });
});

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
          { name: 'acme', source: 'https://github.com/acme/panels.git', version: '1.4.0' },
          { name: 'gitlab', source: 'git@gitlab.example:team/panels.git' },
          { name: 'local', source: 'plugins/local' },
        ],
      },
      ROOT,
    );
    expect(result).toMatchObject({
      plugins: [
        { name: 'acme', source: 'https://github.com/acme/panels.git', remote: true, version: '1.4.0' },
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
});
