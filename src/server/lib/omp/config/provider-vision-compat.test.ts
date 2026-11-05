/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `compat` block that makes a declared image input actually reach the wire.
 *
 * omp's model classifier derives `stripImageInput` from the model id and wins
 * over a `compat` the file does not state, so an entry carrying
 * `input: [text, image]` and nothing else is read as "vision declared, every
 * picture stripped": the pixels are replaced with
 * `[image omitted: the active model does not support image input]` before the
 * request leaves. Measured on `deepseek-v4-1-flash` against a provider that
 * accepted the identical payload when posted by hand.
 *
 * These tests pin the writer side of that pair, and the one rule that matters
 * for a hand-authored file: a `compat` the user pinned is never rewritten.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { upsertOmpProviderModels } from '@/server/lib/omp/config/providers';

const originalAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const roots: string[] = [];
let agentDir = '';

beforeEach(async () => {
  const root = await fs.promises.mkdtemp(join(tmpdir(), 'omp-vision-compat-'));
  roots.push(root);
  agentDir = join(root, 'agent');
  await fs.promises.mkdir(agentDir, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(async () => {
  if (originalAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const root of roots) await fs.promises.rm(root, { recursive: true, force: true });
});

const modelsPath = () => join(agentDir, 'models.yml');

/** Read back through fs: Bun.file memoizes across the atomic rename. */
async function readModels(): Promise<Record<string, Record<string, unknown>>> {
  const doc = Bun.YAML.parse(await fs.promises.readFile(modelsPath(), 'utf8')) as
    | { providers?: Record<string, Record<string, unknown>> }
    | null;
  if (!doc?.providers) throw new Error('models.yml has no providers map');
  return doc.providers;
}

/** One existing provider whose single model already declares the image input. */
function providerWith(input: string[]): string {
  return [
    'providers:',
    '  pinned:',
    '    baseUrl: https://old.example',
    '    apiKey: sk-old',
    '    api: openai-completions',
    '    models:',
    '      - id: m1',
    `        input: [ ${input.join(', ')} ]`,
    '',
  ].join('\n');
}

describe('vision compat on the provider write path', () => {
  test('a newly added vision model carries the compat block', async () => {
    await upsertOmpProviderModels('gw', {
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-live',
      models: [{ id: 'deepseek-v4-1-flash', imageInput: true }],
    });

    const model = (await readModels()).gw?.models;
    expect(Array.isArray(model) ? model[0] : undefined).toMatchObject({
      id: 'deepseek-v4-1-flash',
      input: ['text', 'image'],
      compat: { stripImageInput: false },
    });
  });

  test('re-importing a provider fills the compat a vision entry is missing', async () => {
    // The entry omp reads as "vision declared, pixels stripped". Re-fetching the
    // provider is the repair path, so the input list being unchanged must not
    // stop the compat from landing.
    await Bun.write(modelsPath(), providerWith(['text', 'image']));

    const result = await upsertOmpProviderModels('pinned', {
      baseUrl: 'https://old.example',
      apiKey: 'sk-old',
      models: [{ id: 'm1', imageInput: true }],
    });

    expect(result.backfilledModels).toEqual(['m1']);
    const model = (await readModels()).pinned?.models;
    expect(Array.isArray(model) ? model[0] : undefined).toMatchObject({
      input: ['text', 'image'],
      compat: { stripImageInput: false },
    });
  });

  test('a compat the user pinned is never overwritten', async () => {
    await Bun.write(modelsPath(), providerWith(['text', 'image']).replace(
      '        input: [ text, image ]\n',
      '        input: [ text, image ]\n        compat: { stripImageInput: true }\n',
    ));

    await upsertOmpProviderModels('pinned', {
      baseUrl: 'https://old.example',
      apiKey: 'sk-old',
      models: [{ id: 'm1', imageInput: true }],
    });

    const model = (await readModels()).pinned?.models;
    expect(Array.isArray(model) ? model[0] : undefined).toMatchObject({
      compat: { stripImageInput: true },
    });
  });

  test('a text-only seed leaves an entry without a compat block', async () => {
    await Bun.write(modelsPath(), providerWith(['text']));

    await upsertOmpProviderModels('pinned', {
      baseUrl: 'https://old.example',
      apiKey: 'sk-old',
      models: [{ id: 'm1', imageInput: false }],
    });

    const model = (await readModels()).pinned?.models;
    const entry = Array.isArray(model) ? model[0] : undefined;
    expect(entry).toMatchObject({ input: ['text'] });
    expect(entry?.compat).toBeUndefined();
  });
});
