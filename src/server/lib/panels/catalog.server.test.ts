/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The marketplace catalog: appending an entry, pruning one, and the repair for
 * an entry whose directory is already gone.
 *
 * The rules pinned here are the ones a wrong answer makes invisible rather than
 * loud:
 *
 * - the file's own name, description and earlier entries SURVIVE a write — it is
 *   a read-modify-write, and a template would drop them;
 * - an entry is pruned by its `source` path, not by its `name`, because a
 *   hand-written entry may carry any label while the path is what the scan
 *   resolves;
 * - an entry that is not there is a SUCCESS, so a repair is idempotent;
 * - a `source` escaping the marketplace root is refused, because it arrives from
 *   a browser and is compared verbatim against every entry's source;
 * - `forget` touches NO directory — deleting files is the remove action's job,
 *   and a repair that deleted a directory it did not expect would be a data
 *   loss the user never asked for.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendCatalogEntry,
  forgetCatalogEntry,
  pruneCatalogEntry,
  pruneCatalogRegistry,
  registerCatalogRegistry,
} from '@/server/lib/panels/catalog.server';
import { getMarketplaceCatalogPath, getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';

let root = '';

function writeCatalog(catalog: unknown): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(getMarketplaceCatalogPath(), JSON.stringify(catalog, null, 2));
}

/** The catalog as the file holds it, so an assertion reads what was WRITTEN. */
function readCatalog(): {
  name?: string;
  description?: string;
  plugins?: Array<{ name: string; source: string }>;
  registries?: Array<{ repo: string; name?: string }>;
} {
  return JSON.parse(fs.readFileSync(getMarketplaceCatalogPath(), 'utf8')) as {
    name?: string;
    description?: string;
    plugins?: Array<{ name: string; source: string }>;
    registries?: Array<{ repo: string; name?: string }>;
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-catalog-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  invalidatePanelScan();
});

afterEach(() => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('appendCatalogEntry', () => {
  test('preserves the marketplace name, description and earlier entries', async () => {
    writeCatalog({
      name: 'Acme Tools',
      description: 'Internal panels.',
      plugins: [{ name: 'old', source: 'plugins/old' }],
    });

    expect((await appendCatalogEntry({ name: 'demo', source: 'plugins/demo' })).ok).toBe(true);

    const catalog = readCatalog();
    expect(catalog.name).toBe('Acme Tools');
    expect(catalog.description).toBe('Internal panels.');
    expect(catalog.plugins?.map((entry) => entry.source)).toEqual(['plugins/old', 'plugins/demo']);
  });

  test('is idempotent by name', async () => {
    writeCatalog({ plugins: [{ name: 'demo', source: 'plugins/demo' }] });
    await appendCatalogEntry({ name: 'demo', source: 'plugins/demo' });
    expect(readCatalog().plugins).toHaveLength(1);
  });
});

describe('pruneCatalogEntry', () => {
  test('drops the named entry and keeps the rest', async () => {
    writeCatalog({
      name: 'Keep',
      plugins: [
        { name: 'keep-me', source: 'plugins/keep-me' },
        { name: 'gone', source: 'plugins/gone' },
      ],
    });

    expect((await pruneCatalogEntry('plugins/gone')).ok).toBe(true);
    const catalog = readCatalog();
    expect(catalog.plugins?.map((entry) => entry.source)).toEqual(['plugins/keep-me']);
    expect(catalog.name).toBe('Keep');
  });

  test('an entry that is not there is a success, so a repair can be repeated', async () => {
    writeCatalog({ plugins: [{ name: 'demo', source: 'plugins/demo' }] });
    expect((await pruneCatalogEntry('plugins/never-existed')).ok).toBe(true);
    expect(readCatalog().plugins).toHaveLength(1);
  });

  test('reports a catalog that is not JSON instead of rewriting it', async () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(getMarketplaceCatalogPath(), '{ not json');
    const result = await pruneCatalogEntry('plugins/demo');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not valid JSON');
    expect(fs.readFileSync(getMarketplaceCatalogPath(), 'utf8')).toBe('{ not json');
  });
});

describe('forgetCatalogEntry', () => {
  test('drops the entry and leaves the directory alone', async () => {
    // The directory is absent — that is the state the repair exists for — while
    // a DIFFERENT plugin's directory is present and must not be touched.
    const other = join(getMarketplacePluginsDir(), 'other');
    fs.mkdirSync(other, { recursive: true });
    writeCatalog({
      plugins: [
        { name: 'ghost', source: 'plugins/ghost' },
        { name: 'other', source: 'plugins/other' },
      ],
    });

    expect((await forgetCatalogEntry('plugins/ghost')).ok).toBe(true);
    expect(readCatalog().plugins?.map((entry) => entry.source)).toEqual(['plugins/other']);
    expect(fs.existsSync(other)).toBe(true);
  });

  test('refuses a source that escapes the marketplace root', async () => {
    writeCatalog({ plugins: [{ name: 'demo', source: 'plugins/demo' }] });
    for (const source of ['../../etc', '/etc/passwd', 'plugins/../../outside']) {
      const result = await forgetCatalogEntry(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('does not name an entry inside the marketplace');
    }
    expect(readCatalog().plugins).toHaveLength(1);
  });

  test('refuses an empty source', async () => {
    writeCatalog({ plugins: [{ name: 'demo', source: 'plugins/demo' }] });
    expect((await forgetCatalogEntry('   ')).ok).toBe(false);
  });
});

describe('registerCatalogRegistry', () => {
  test('writes the registration, preserving the catalog it already had', async () => {
    writeCatalog({ name: 'Kabmo', plugins: [{ name: 'old', source: 'plugins/old' }] });

    const result = await registerCatalogRegistry('https://github.com/acme/kabmo-plugins-kanban');
    expect(result).toMatchObject({ ok: true, repo: 'acme/kabmo-plugins-kanban' });

    const catalog = readCatalog();
    expect(catalog.name).toBe('Kabmo');
    // The registration is a POINTER: the plugin's own entry is written when it
    // is installed, so registering must not invent one.
    expect(catalog.plugins?.map((entry) => entry.source)).toEqual(['plugins/old']);
    expect(catalog.registries).toEqual([{ repo: 'acme/kabmo-plugins-kanban' }]);
  });

  test('is idempotent by repository, whatever the spelling', async () => {
    writeCatalog({});
    await registerCatalogRegistry('https://github.com/acme/kabmo-plugins-kanban');
    await registerCatalogRegistry('git@github.com:acme/kabmo-plugins-kanban.git');
    expect(readCatalog().registries).toHaveLength(1);
  });

  test('refuses a repository that does not follow the naming rule', async () => {
    writeCatalog({});
    const result = await registerCatalogRegistry('https://github.com/acme/kanban');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error).toContain('kabmo-plugins-');
    expect(readCatalog().registries).toBeUndefined();
  });

  test('refuses a non-GitHub source', async () => {
    writeCatalog({});
    expect((await registerCatalogRegistry('https://gitlab.com/acme/kabmo-plugins-kanban')).ok).toBe(false);
  });
});

describe('pruneCatalogRegistry', () => {
  test('drops the registration and keeps every other entry', async () => {
    writeCatalog({
      plugins: [{ name: 'keep-me', source: 'plugins/keep-me' }],
      registries: [{ repo: 'acme/kabmo-plugins-a' }, { repo: 'acme/kabmo-plugins-b' }],
    });

    expect((await pruneCatalogRegistry('https://github.com/acme/kabmo-plugins-a.git')).ok).toBe(true);
    const catalog = readCatalog();
    expect(catalog.registries).toEqual([{ repo: 'acme/kabmo-plugins-b' }]);
    expect(catalog.plugins?.map((entry) => entry.source)).toEqual(['plugins/keep-me']);
  });

  test('a repository that is not registered is a success', async () => {
    writeCatalog({ registries: [{ repo: 'acme/kabmo-plugins-a' }] });
    expect((await pruneCatalogRegistry('acme/kabmo-plugins-nope')).ok).toBe(true);
    expect(readCatalog().registries).toHaveLength(1);
  });
});
