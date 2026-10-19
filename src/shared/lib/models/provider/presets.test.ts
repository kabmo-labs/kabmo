/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Add Provider picker's rules, which are all silent when wrong: a preset
 * offered for a CONNECTED provider produces a second `models.yml` entry under
 * the same slug (the upsert then writes into the live one), and a preset
 * dropped while its provider is only DISCONNECTED makes the switch that hid it
 * unreachable. The dialect fields are checked too — a preset whose `api` omp
 * does not know would disable every custom provider in the file.
 */

import { describe, expect, test } from 'bun:test';

import {
  buildAvailableProviderPresets,
  configuredProviderSlugs,
  groupProviderPresets,
} from '@/shared/lib/models/provider/presets';
import { PROVIDER_APIS, providerEmptyReason, providerFetchBlockReason } from '@/shared/lib/models/provider/dialect';
import { PRESET_NEW_PROVIDERS } from '@/client/data/settings/provider';
import type { PresetProviderOption, ProviderItem } from '@/shared/types/settings/provider';

function provider(overrides: Partial<ProviderItem> & { slug: string }): ProviderItem {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    icon: overrides.slug,
    status: 'connected',
    configuredIn: 'models.yml',
    models: [],
    ...overrides,
  } as ProviderItem;
}

const PRESETS: PresetProviderOption[] = [
  { id: 'openai', name: 'OpenAI', slug: 'openai', icon: 'openai', defaultUrl: 'https://api.openai.com/v1', group: 'Frontier APIs' },
  { id: 'groq', name: 'Groq', slug: 'groq', icon: 'groq', defaultUrl: 'https://api.groq.com/openai/v1', group: 'Frontier APIs' },
  { id: 'ollama', name: 'Ollama', slug: 'ollama', icon: 'ollama', defaultUrl: 'http://127.0.0.1:11434', auth: 'none', discovery: 'ollama', group: 'Local & self-hosted' },
];

describe('buildAvailableProviderPresets', () => {
  test('drops a non-bundled preset whose slug already has an endpoint', () => {
    // A second entry under one slug is the same entry to omp; that provider is
    // managed from the sidebar instead.
    const available = buildAvailableProviderPresets(
      [provider({ slug: 'openai', baseUrl: 'https://api.openai.com/v1' })],
      PRESETS,
    );
    expect(available.map((entry) => entry.slug)).toEqual(['groq', 'ollama']);
  });

  test('keeps a preset whose provider omp merely KNOWS', () => {
    // omp reports ~60 providers it knows with no endpoint and no credential;
    // treating those as configured hid every gateway preset — the one case
    // where the user wants to bring their own key.
    const available = buildAvailableProviderPresets(
      [provider({ slug: 'openai', status: 'disconnected', disabled: true })],
      PRESETS,
    );
    expect(available.map((entry) => entry.slug)).toEqual(['openai', 'groq', 'ollama']);
  });

  test('keeps a bundled preset even when its provider is configured', () => {
    // An override for a provider omp already ships is the documented way to
    // point it at a proxy, and the writer is add-only, so re-offering is safe.
    const available = buildAvailableProviderPresets(
      [provider({ slug: 'azure', status: 'connected', baseUrl: 'https://x.openai.azure.com' })],
      [{ ...PRESETS[0], slug: 'azure', id: 'azure', bundled: true }],
    );
    expect(available.map((entry) => entry.slug)).toEqual(['azure']);
  });

  test('never offers one slug twice', () => {
    const available = buildAvailableProviderPresets(
      [provider({ slug: 'ollama', status: 'disconnected' })],
      PRESETS,
    );
    const slugs = available.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('groupProviderPresets', () => {
  test('buckets by group in declaration order and keeps members in order', () => {
    const groups = groupProviderPresets(PRESETS);
    expect(groups.map((entry) => entry.group)).toEqual(['Frontier APIs', 'Local & self-hosted']);
    expect(groups[0].options.map((entry) => entry.slug)).toEqual(['openai', 'groq']);
  });
});

describe('shipped presets', () => {
  test('every declared api is one omp accepts', () => {
    for (const preset of PRESET_NEW_PROVIDERS) {
      if (!preset.api) continue;
      expect(PROVIDER_APIS).toContain(preset.api);
    }
  });

  test('every preset carries a group and a unique id', () => {
    const ids = PRESET_NEW_PROVIDERS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of PRESET_NEW_PROVIDERS) {
      expect(preset.group.length).toBeGreaterThan(0);
    }
  });

  test('a discovery preset declares a keyless or authenticated shape, never neither', () => {
    // omp needs a dialect for every discovery provider except `proxy`, which
    // reports one per model; a preset without either would be rejected on load.
    for (const preset of PRESET_NEW_PROVIDERS) {
      if (!preset.discovery) continue;
      expect(preset.api !== undefined || preset.discovery === 'proxy').toBe(true);
    }
  });

  test('a built-in local engine preset is keyless', () => {
    // omp's implicit ollama/llama.cpp/lm-studio engines are keyless; a preset
    // that omitted `auth: none` would be registered as a provider omp reports
    // as unconfigured. LiteLLM is deliberately excluded — it is a proxy that
    // authenticates with its own master key.
    const engines = PRESET_NEW_PROVIDERS.filter(
      (preset) => preset.discovery === 'ollama'
        || preset.discovery === 'llama.cpp'
        || preset.discovery === 'lm-studio',
    );
    expect(engines.length).toBe(3);
    for (const preset of engines) {
      expect(preset.auth).toBe('none');
    }
  });
});

describe('configuredProviderSlugs', () => {
  test('names only the providers that already own a slug', () => {
    // omp reports ~60 providers it merely knows; naming those as taken would
    // block the Add Provider dialog from ever configuring one of them.
    const slugs = configuredProviderSlugs([
      provider({ slug: 'openai', status: 'disconnected' }),
      provider({ slug: 'azure', status: 'disconnected', baseUrl: 'https://x.openai.azure.com' }),
      provider({ slug: 'deepseek' }),
    ]);
    expect(slugs).toEqual(['azure', 'deepseek']);
  });
});

describe('providerEmptyReason', () => {
  test('explains a discovery provider without calling it empty', () => {
    expect(providerEmptyReason({ discovery: 'lm-studio' })).toContain('discovers this provider');
    expect(providerEmptyReason({ modelSource: 'discovery' })).toContain('discovers this provider');
  });

  test('an override names the missing credential rather than only the shape', () => {
    const withKey = providerEmptyReason({ modelSource: 'override' });
    expect(withKey).toContain('Endpoint override');
    expect(withKey).toContain('still needs a credential');

    // A keyless override has nothing missing, so it must not claim one is.
    const keyless = providerEmptyReason({ modelSource: 'override', auth: 'none' });
    expect(keyless).toContain('Endpoint override');
    expect(keyless).not.toContain('still needs a credential');
  });

  test('an unexplained empty list stays unexplained', () => {
    // A hosted provider with no models is a problem; inventing a reassuring
    // reason for it would hide the failure.
    expect(providerEmptyReason({})).toBeUndefined();
    expect(providerEmptyReason({ modelSource: 'fetch' })).toBeUndefined();
  });
});

describe('providerFetchBlockReason', () => {
  test('a models.yml provider with an endpoint may fetch', () => {
    // The regression: the registry built these entries without a `baseUrl`, so
    // the button was disabled for the one set of providers whose endpoint the
    // Kabmo actually knows.
    expect(providerFetchBlockReason({ baseUrl: 'https://kenari.id/v1', modelSource: 'fetch' })).toBeUndefined();
  });

  test('a login provider names the endpoint as the reason, not the shape', () => {
    // omp owns the URL of an `omp auth` provider, so there is nothing to probe.
    const reason = providerFetchBlockReason({});
    expect(reason).toContain('no endpoint');
  });

  test('a discovery provider is blocked even though it has an endpoint', () => {
    // Fetching here would write a snapshot beside the list omp resolves live.
    const reason = providerFetchBlockReason({ baseUrl: 'http://127.0.0.1:11434', discovery: 'ollama' });
    expect(reason).toContain('lists this provider’s models itself');
    expect(providerFetchBlockReason({ baseUrl: 'http://127.0.0.1:11434', modelSource: 'discovery' })).toBeDefined();
  });

  test('an endpoint override is NOT blocked — adding specific ids is the point', () => {
    expect(providerFetchBlockReason({ baseUrl: 'https://proxy.example.com', modelSource: 'override' })).toBeUndefined();
  });
});
