/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which presets the Add Provider picker may offer, and how they are grouped.
 *
 * The rule differs by preset kind, because the two kinds write different things:
 *
 * - A **bundled** preset names a provider omp already ships (Anthropic, Azure,
 *   Bedrock, Vertex, Codex). Its entry in `models.yml` is an OVERRIDE — omp
 *   keeps serving its own model list and only the endpoint changes — and the
 *   writer is add-only, so re-offering it is safe and is the documented way to
 *   point a built-in provider at a proxy.
 * - Any other preset creates a provider entry of its own, so a slug that is
 *   already DEFINED — connected, or carrying its own `baseUrl` in models.yml or
 *   Kabmo overlay — is not re-offered; that provider is managed from the
 *   sidebar, which can reconnect it and edit its endpoint.
 *
 * `status` alone is the wrong test: omp reports ~60 providers it merely
 * KNOWS (`get_login_providers`), which are `disconnected` with no endpoint and
 * no credential. Treating those as "already added" hid every gateway preset —
 * the one case where a user wants to bring their own key.
 */

import type { PresetProviderOption, ProviderItem } from '@/shared/types/settings/provider';

/**
 * True when the provider already owns this slug in a config file — connected,
 * or carrying its own `baseUrl` from models.yml or Kabmo overlay.
 */
export function providerOwnsSlug(provider: ProviderItem | undefined): boolean {
  return provider !== undefined && (provider.status === 'connected' || Boolean(provider.baseUrl));
}

/**
 * Slugs already DEFINED in a config file — the ones a new provider entry would
 * collide with. Deliberately not every provider omp reports: it lists ~60 it
 * merely knows (`get_login_providers`), all `disconnected` with no endpoint, and
 * treating those as taken blocks the user from ever configuring them.
 */
export function configuredProviderSlugs(providers: ProviderItem[]): string[] {
  return providers
    .filter((provider) => provider.slug.trim().length > 0 && providerOwnsSlug(provider))
    .map((provider) => provider.slug);
}

export function buildAvailableProviderPresets(
  providers: ProviderItem[],
  presets: PresetProviderOption[],
): PresetProviderOption[] {
  const bySlug = new Map<string, ProviderItem>();
  for (const provider of providers) {
    const slug = provider.slug.trim().toLowerCase();
    if (slug) bySlug.set(slug, provider);
  }
  const seenSlugs = new Set<string>();
  const available: PresetProviderOption[] = [];

  for (const preset of presets) {
    const slug = preset.slug.trim().toLowerCase();
    if (seenSlugs.has(slug)) continue;
    if (!preset.bundled && providerOwnsSlug(bySlug.get(slug))) continue;
    seenSlugs.add(slug);
    available.push(preset);
  }

  return available;
}

/** Presets bucketed into their `group`, in the order the presets declare them. */
export function groupProviderPresets(
  presets: PresetProviderOption[],
): Array<{ group: string; options: PresetProviderOption[] }> {
  const groups: Array<{ group: string; options: PresetProviderOption[] }> = [];
  for (const preset of presets) {
    const existing = groups.find((entry) => entry.group === preset.group);
    if (existing) existing.options.push(preset);
    else groups.push({ group: preset.group, options: [preset] });
  }
  return groups;
}
