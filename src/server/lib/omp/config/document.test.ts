/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The comment-preserving YAML config writer and the two settings it edits.
 *
 * These modules are the only place the chamber writes into omp's own config
 * files, so each promise here is a data-loss promise:
 *
 * - `withOmpYamlDocument` must refuse a file that is not a YAML mapping (the
 *   alternative is overwriting a user's hand-authored file with a scalar), must
 *   leave the file byte-identical when an edit reports `changed: false`, and
 *   must create a new config `0600` because these files hold plaintext keys.
 * - `plainOf` must return PLAIN values: a node would make `Array.isArray` false
 *   and a membership check silently see an empty list.
 * - `disabledProviders` is path-scoped — re-enabling one provider must not
 *   delete a `{ path, providers }` entry, and disabling must not flatten the
 *   list to bare strings.
 * - A model override is only accepted for a model the provider registers, and
 *   a cleared override is deleted rather than written as `null`.
 *
 * `PI_CODING_AGENT_DIR` is redirected to a temp dir, so the real
 * `~/.omp/agent` config is never read or written.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSeq, parseDocument } from 'yaml';
import { testPosix } from '@/test-support/platform';

import {
  OmpConfigError,
  plainOf,
  seqAt,
  valueAt,
  withOmpYamlDocument,
} from '@/server/lib/omp/config/document';
import {
  disableNativeProvider,
  enableNativeProvider,
  readDisabledProviderEntries,
  readDisabledProviders,
} from '@/server/lib/omp/config/disabled-providers';
import { writeModelOverride } from '@/server/lib/omp/config/model-overrides';
import { SCHEMA_EXTRAS } from '@/shared/lib/omp/config/schema-extras';
import { OMP_SCHEMA } from '@/shared/lib/omp/config/schema';

let root = '';
let agentDir = '';
let prevAgentDir: string | undefined;

const configPath = () => join(agentDir, 'config.yml');
const modelsPath = () => join(agentDir, 'models.yml');

function write(file: string, content: string, mode?: number): string {
  fs.mkdirSync(join(file, '..'), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode !== undefined) fs.chmodSync(file, mode);
  return file;
}

const read = (file: string) => fs.readFileSync(file, 'utf8');

beforeAll(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'ompchamber-document-'));
  agentDir = join(root, 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  prevAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(() => {
  if (prevAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = prevAgentDir;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('document node readers', () => {
  test('seqAt returns the sequence node only, never a map or scalar', () => {
    const doc = parseDocument('list:\n  - a\n  - b\nmap:\n  k: v\nscalar: x\n');
    expect(isSeq(seqAt(doc, ['list']))).toBe(true);
    expect(seqAt(doc, ['map'])).toBeNull();
    expect(seqAt(doc, ['scalar'])).toBeNull();
    expect(seqAt(doc, ['missing'])).toBeNull();
  });

  test('plainOf and valueAt unwrap nodes to plain values; scalars read through the keep-scalar get', () => {
    const doc = parseDocument('scalar: 7\nmap:\n  k: v\nseq:\n  - 1\n  - 2\n');
    expect(plainOf<number>(doc, doc.get('scalar', true))).toBe(7);
    expect(valueAt<Record<string, string>>(doc, ['map'])).toEqual({ k: 'v' });
    expect(valueAt<number[]>(doc, ['seq'])).toEqual([1, 2]);
    expect(plainOf(doc, undefined)).toBeUndefined();
    expect(plainOf(doc, null)).toBeUndefined();
  });

  test('valueAt at a path yields a real array, not a YAML node', () => {
    const doc = parseDocument('a:\n  b:\n    - one\n    - two\n');
    const list = valueAt<string[]>(doc, ['a', 'b']);
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain('one');
    expect(valueAt(doc, ['a', 'missing'])).toBeUndefined();
  });

  test('OmpConfigError carries its own name', () => {
    expect(new OmpConfigError('boom').name).toBe('OmpConfigError');
  });
});

describe('withOmpYamlDocument', () => {
  test('a missing file is created and the edit result is returned', async () => {
    const path = join(root, 'created', 'config.yml');
    const result = await withOmpYamlDocument(path, (doc) => {
      doc.set('key', 'value');
      return { result: 'ok', changed: true };
    });
    expect(result).toBe('ok');
    expect(read(path)).toContain('key: value');
  });

  // `statSync().mode` is a POSIX property (Windows reports a synthesised 0o666),
  // so the create- and kept-mode assertions are POSIX-only.
  testPosix('a missing file is created 0600', async () => {
    const path = join(root, 'created-0600', 'config.yml');
    await withOmpYamlDocument(path, (doc) => {
      doc.set('key', 'value');
      return { result: 'ok', changed: true };
    });
    expect(fs.statSync(path).mode & 0o777).toBe(0o600);
  });

  test('changed:false leaves the file byte-identical and absent if it never existed', async () => {
    const path = write(join(root, 'noop', 'config.yml'), '# note\nkeep: 1\n');
    const before = read(path);
    expect(await withOmpYamlDocument(path, () => ({ result: 1, changed: false }))).toBe(1);
    expect(read(path)).toBe(before);

    const absent = join(root, 'noop', 'absent.yml');
    await withOmpYamlDocument(absent, () => ({ result: 0, changed: false }));
    expect(fs.existsSync(absent)).toBe(false);
  });

  test('comments and unrelated keys survive an edit', async () => {
    const path = write(join(root, 'kept', 'config.yml'), '# top comment\nkeep: 1\n', 0o640);
    await withOmpYamlDocument(path, (doc) => {
      doc.set('added', true);
      return { result: null, changed: true };
    });
    const after = read(path);
    expect(after).toContain('# top comment');
    expect(after).toContain('keep: 1');
    expect(after).toContain('added: true');
  });

  testPosix('the file mode is kept across an edit', async () => {
    const path = write(join(root, 'kept-mode', 'config.yml'), '# top comment\nkeep: 1\n', 0o640);
    await withOmpYamlDocument(path, (doc) => {
      doc.set('added', true);
      return { result: null, changed: true };
    });
    expect(fs.statSync(path).mode & 0o777).toBe(0o640);
  });

  test('invalid YAML and a non-mapping document are refused with OmpConfigError', async () => {
    const invalid = write(join(root, 'bad', 'invalid.yml'), 'key: [unclosed\n');
    await expect(withOmpYamlDocument(invalid, () => ({ result: null, changed: true })))
      .rejects.toThrow(OmpConfigError);

    const scalar = write(join(root, 'bad', 'scalar.yml'), 'just a string\n');
    await expect(withOmpYamlDocument(scalar, () => ({ result: null, changed: true })))
      .rejects.toThrow(/must contain a YAML mapping/);
    expect(read(scalar)).toBe('just a string\n');
  });
});

describe('disabledProviders', () => {
  test('a missing config.yml reads as an empty disabled list', async () => {
    fs.rmSync(configPath(), { force: true });
    expect(await readDisabledProviderEntries()).toEqual([]);
    expect(await readDisabledProviders(agentDir)).toEqual(new Set());
    expect(await enableNativeProvider('deepseek')).toBe(false);
  });

  test('bare slugs always apply; a path-scoped entry applies only under its prefix', async () => {
    write(configPath(), [
      'disabledProviders:',
      '  - always',
      '  - path: ' + join(root, 'work'),
      '    providers: [work-only]',
      '  - paths: ["/other"]',
      '    values: [other-only]',
      '',
    ].join('\n'));
    expect(await readDisabledProviders(join(root, 'work', 'sub'))).toEqual(new Set(['always', 'work-only']));
    expect(await readDisabledProviders(root)).toEqual(new Set(['always']));
    expect((await readDisabledProviderEntries()).length).toBe(3);
  });

  test('disable appends without flattening the list and preserves comments', async () => {
    write(configPath(), '# keep me\ndisabledProviders:\n  - path: /p\n    providers: [x]\nother: 1\n');
    expect(await disableNativeProvider('deepseek')).toBe(true);
    const after = read(configPath());
    expect(after).toContain('# keep me');
    expect(after).toContain('other: 1');
    expect(after).toContain('providers:');
    expect(await readDisabledProviders(root)).toEqual(new Set(['deepseek']));
    expect(await disableNativeProvider('deepseek')).toBe(false);
  });

  test('a slug disabled only through a path-scoped entry cannot be disabled twice', async () => {
    write(configPath(), 'disabledProviders:\n  - path: /p\n    providers: [x]\n');
    expect(await disableNativeProvider('x')).toBe(false);
  });

  test('enable removes a bare slug and reports whether anything changed', async () => {
    write(configPath(), 'disabledProviders:\n  - a\n  - b\n');
    expect(await enableNativeProvider('a')).toBe(true);
    expect(await readDisabledProviderEntries()).toEqual(['b']);
    expect(await enableNativeProvider('missing')).toBe(false);
  });

  test('enable edits the path-scoped entry in place, keeping its key and siblings', async () => {
    write(configPath(), 'disabledProviders:\n  - path: /p\n    providers: [x, y]\n');
    expect(await enableNativeProvider('x')).toBe(true);
    const after = read(configPath());
    expect(after).toContain('providers:');
    expect(after).toContain('y');
    expect(after).not.toContain('x,');
    expect(await readDisabledProviders(join('/p', 'sub'))).toEqual(new Set(['y']));
  });

  test('enable deletes a path-scoped entry once its last provider is gone', async () => {
    write(configPath(), 'disabledProviders:\n  - path: /p\n    providers: [only]\n  - keep\n');
    expect(await enableNativeProvider('only')).toBe(true);
    expect(await readDisabledProviderEntries()).toEqual(['keep']);
  });
});

describe('writeModelOverride', () => {
  const seedModels = (extra = '') => write(modelsPath(), [
    'providers:',
    '  deepseek:',
    '    models:',
    '      - id: chat',
    '      - id: reason',
    extra,
    '',
  ].join('\n'));

  test('an unknown provider/model pair is reported and the file is untouched', async () => {
    seedModels();
    const before = read(modelsPath());
    expect(await writeModelOverride({ provider: 'deepseek', modelId: 'nope', maxTokens: 10 })).toEqual({
      written: false,
      unknownTarget: true,
      reason: 'nope is not registered under provider "deepseek" in models.yml',
    });
    expect(read(modelsPath())).toBe(before);
  });

  test('maxTokens is written, then cleared away with its empty parents', async () => {
    seedModels();
    expect(await writeModelOverride({ provider: 'deepseek', modelId: 'chat', maxTokens: 4096 })).toEqual({ written: true });
    expect(read(modelsPath())).toContain('maxTokens: 4096');
    expect(await writeModelOverride({ provider: 'deepseek', modelId: 'chat', maxTokens: null })).toEqual({ written: true });
    expect(read(modelsPath())).not.toContain('maxTokens');
    expect(read(modelsPath())).not.toContain('modelOverrides');
  });

  test('a non-positive maxTokens is refused and nothing is written', async () => {
    seedModels();
    const before = read(modelsPath());
    await expect(writeModelOverride({ provider: 'deepseek', modelId: 'chat', maxTokens: 0 }))
      .rejects.toThrow(/maxTokens must be a positive number/);
    expect(read(modelsPath())).toBe(before);
  });

  test('a reasoning effort writes the full vocabulary, and keeps a catalog-provided one', async () => {
    seedModels();
    await writeModelOverride({ provider: 'deepseek', modelId: 'reason', reasoningEffort: 'medium' });
    expect(read(modelsPath())).toContain('defaultLevel: medium');
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(read(modelsPath())).toContain(`- ${level}`);
    }

    write(modelsPath(), [
      'providers:',
      '  deepseek:',
      '    models:',
      '      - id: reason',
      '    modelOverrides:',
      '      reason:',
      '        thinking:',
      '          mode: effort',
      '          efforts: [low, high]',
      '',
    ].join('\n'));
    await writeModelOverride({ provider: 'deepseek', modelId: 'reason', reasoningEffort: 'medium' });
    const after = read(modelsPath());
    expect(after).toContain('- low');
    expect(after).toContain('- high');
    expect(after).toContain('- medium');
  });

  test('clearing the last override drops the whole entry', async () => {
    seedModels();
    await writeModelOverride({ provider: 'deepseek', modelId: 'chat', reasoningEffort: 'high' });
    expect(read(modelsPath())).toContain('defaultLevel: high');
    await writeModelOverride({ provider: 'deepseek', modelId: 'chat', reasoningEffort: null });
    expect(read(modelsPath())).not.toContain('modelOverrides');
  });

  test('a malformed modelOverrides node is refused rather than replaced', async () => {
    write(modelsPath(), 'providers:\n  deepseek:\n    models:\n      - id: chat\n    modelOverrides: not-a-map\n');
    await expect(writeModelOverride({ provider: 'deepseek', modelId: 'chat', maxTokens: 5 }))
      .rejects.toThrow(/modelOverrides must be a mapping/);
    expect(read(modelsPath())).toContain('modelOverrides: not-a-map');
  });
});

describe('SCHEMA_EXTRAS', () => {
  test('every extra is a complete UI row with a known type', () => {
    for (const [key, entry] of Object.entries(SCHEMA_EXTRAS)) {
      expect(key.length).toBeGreaterThan(0);
      expect(['boolean', 'string', 'number', 'enum', 'array', 'record']).toContain(entry.type);
      expect(entry.ui.tab.length).toBeGreaterThan(0);
      expect(entry.ui.label.length).toBeGreaterThan(0);
      expect(entry.ui.description.length).toBeGreaterThan(0);
    }
  });

  test('pins the rows whose defaults the panel renders', () => {
    expect(SCHEMA_EXTRAS['retry.enabled']).toMatchObject({ type: 'boolean', default: true });
    expect(SCHEMA_EXTRAS['cycleOrder']).toMatchObject({ type: 'array', default: ['smol', 'default', 'slow'] });
    expect(SCHEMA_EXTRAS['disabledProviders']).toMatchObject({ type: 'array', default: [] });
    expect(SCHEMA_EXTRAS['compaction.reserveTokens']?.type).toBe('number');
    expect(SCHEMA_EXTRAS['compaction.reserveTokens']).not.toHaveProperty('default');
  });

  test('an extra never silently overrides an upstream schema row', () => {
    const upstream = Object.keys(OMP_SCHEMA.entries);
    for (const key of Object.keys(SCHEMA_EXTRAS)) {
      expect(upstream).not.toContain(key);
    }
  });
});
