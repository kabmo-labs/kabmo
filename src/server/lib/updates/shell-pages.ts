/**
 * The PUBLIC release pages, for when the GitHub API is unavailable.
 *
 * Split from `shell-release.ts` because it is a second, independent read: the API
 * path parses JSON, this one parses an Atom feed and an HTML fragment, and the two
 * share nothing but the asset-naming rules in `shell-assets`.
 *
 * ## Why it exists
 *
 * The REST API is unauthenticated at 60 requests an hour **per source IP** — and
 * on a mobile network that IP is shared with an entire carrier NAT. Measured on
 * the author's machine: `remaining: 0`, so the probe answered `null` and the
 * console drew no update button for an APK two versions behind the published one.
 * A missing button is indistinguishable from "you are up to date", which is why
 * that failed silently for as long as it did.
 *
 * `github.com/<repo>/releases.atom` is a plain Atom feed of published releases
 * (newest first) and `github.com/<repo>/releases/expanded_assets/<tag>` is the
 * HTML fragment the release page itself loads. Both are served without an API
 * budget — verified live: 200 on both, and the fragment carries every asset link.
 */

import { REPO } from '@/server/lib/updates/release-url';
import { SHELL_ASSETS, selfUpdateArtifact, versionFromAssetName } from '@/server/lib/updates/shell-assets';
import type { ShellArch } from '@/shared/lib/updates/shell-arch';
import type { ShellKind } from '@/shared/lib/updates/shell-ua';

/** How many tags to walk before giving up. */
const PAGE_SCAN = 6;

/** A tag from the Atom feed, with the release page it names. */
export interface ReleaseTag {
  name: string;
  url: string | null;
}

/** One asset found in a release's fragment. */
export interface PageAsset {
  name: string;
  downloadUrl: string;
}

/**
 * What the pages read concluded.
 *
 * THREE cases, not two, because "the feed could not be read" and "the feed was
 * read and carries no artifact of this shell" are different facts: the first
 * keeps the last good answer, the second is a cacheable empty result. Collapsing
 * them makes a momentary outage look like "no update published", which is the
 * same silence the API path's `null` exists to avoid.
 */
export type PagesResult =
  | { kind: 'found'; asset: PageAsset; releaseUrl: string | null }
  | { kind: 'none' }
  | { kind: 'unreachable' };

/**
 * The newest tag that carries this shell's artifact.
 *
 * The FIRST tag with a matching asset wins, because the feed is newest-first and
 * a release that carries no artifact of this shell (a `kabmo-sdk/v*` package
 * release, which the pipeline publishes before the app) must not stop the walk.
 */
export async function findAssetInPages(
  kind: ShellKind,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
  arch: ShellArch | null = null,
): Promise<PagesResult> {
  const feed = await fetchImpl(`https://github.com/${REPO}/releases.atom`, {
    headers: { accept: 'application/atom+xml, text/xml', ...headers },
  });
  if (!feed.ok) return { kind: 'unreachable' };

  const tags = releaseTags(await feed.text());
  if (tags.length === 0) return { kind: 'none' };

  for (const tag of tags.slice(0, PAGE_SCAN)) {
    const page = await fetchImpl(
      `https://github.com/${REPO}/releases/expanded_assets/${encodeURIComponent(tag.name)}`,
      { headers: { accept: 'text/html', ...headers } },
    );
    if (!page.ok) continue;

    const asset = shellAssetFromPage(kind, await page.text(), arch);
    if (!asset) continue;

    return { kind: 'found', asset, releaseUrl: tag.url };
  }

  return { kind: 'none' };
}

/**
 * The feed's entries, in the order GitHub lists them (newest first).
 *
 * Parsed with two regexes rather than an XML parser: the feed is a fixed shape
 * GitHub emits, and a dependency for two fields would be the larger risk. The
 * entity decode covers the one escape that appears in practice.
 */
export function releaseTags(xml: string): ReleaseTag[] {
  const tags: ReleaseTag[] = [];
  const entries = xml.split('<entry>').slice(1);

  for (const entry of entries) {
    const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1];
    if (!title) continue;
    const href = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(entry)?.[1] ?? null;
    tags.push({ name: decodeEntities(title.trim()), url: href ? decodeEntities(href) : null });
  }

  return tags;
}

/**
 * The asset links inside a release's `expanded_assets` fragment.
 *
 * The name is read out of the DOWNLOAD URL rather than the link's text: the
 * fragment wraps it in a `<span class="text-bold">` whose markup has changed
 * before, while the URL is the release's own path and carries the same name.
 *
 * The CURRENT naming scheme wins over the legacy one, for the reason
 * `shell-release`'s API path documents: a release carrying both spellings must
 * not resolve to the older version.
 */
export function shellAssetFromPage(kind: ShellKind, html: string, arch: ShellArch | null = null): PageAsset | null {
  const found: PageAsset[] = [];

  for (const match of html.matchAll(ASSET_HREF)) {
    const path = decodeEntities(match[1] ?? '');
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    if (versionFromAssetName(kind, name) !== null) found.push({ name, downloadUrl: `https://github.com${path}` });
  }

  // The architecture decides FIRST, for the reason the API path documents: a
  // desktop shell that named its own machine must not be handed the other
  // architecture's installer just because the fragment lists it first.
  if (arch) {
    const exact = found.find((asset) => selfUpdateArtifact(kind, arch, asset.name) !== null);
    if (exact) return exact;
  }

  return found.find((asset) => SHELL_ASSETS[kind].current.test(asset.name)) ?? found[0] ?? null;
}

/** One asset link in a release fragment. Stated once: the loop and the regex must agree. */
const ASSET_HREF = /href="(\/[^"]+\/releases\/download\/[^"]+)"/g;

/** The entities that appear in a feed title or a link. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
