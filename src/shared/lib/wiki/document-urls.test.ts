/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a wiki page's own references are rewritten before rendering.
 *
 * Two failures this pins: an image reference must reach the asset endpoint that
 * can actually serve it (a wiki's images are in the wiki's repository, not the
 * project's, so there is no host URL to point at), and a link must carry the
 * resolved page path so the panel can navigate in-place. A reference that is not
 * in the wiki — the author's external URL — must be left exactly as written.
 */

import { describe, expect, test } from 'bun:test';
import { buildWikiAssetUrl, rewriteWikiReferences } from '@/shared/lib/wiki/document-urls';
import { buildWikiEntries } from '@/shared/lib/wiki/pages';

const entries = buildWikiEntries([
  'Home.md',
  'guides/Deployment.md',
  'images/schema.png',
]);

const scope = { path: 'Home.md', entries, root: '/ws', repo: 'projects/x' };

describe('buildWikiAssetUrl', () => {
  test('carries the scope so the asset comes from the same wiki', () => {
    expect(buildWikiAssetUrl('images/schema.png', { root: '/ws', repo: 'projects/x' }))
      .toBe('/api/wiki/asset?path=images%2Fschema.png&root=%2Fws&repo=projects%2Fx');
  });

  test('omits the repo when it is the workspace root itself', () => {
    expect(buildWikiAssetUrl('images/schema.png', { root: '/ws', repo: '.' }))
      .toBe('/api/wiki/asset?path=images%2Fschema.png&root=%2Fws');
  });
});

describe('rewriteWikiReferences', () => {
  test('points an image at the asset route', () => {
    expect(rewriteWikiReferences('<img src="images/schema.png">', scope))
      .toBe('<img src="/api/wiki/asset?path=images%2Fschema.png&amp;root=%2Fws&amp;repo=projects%2Fx">');
  });

  test('points a link at the page it names, extension resolved', () => {
    expect(rewriteWikiReferences('<a href="guides/Deployment">x</a>', scope))
      .toBe('<a href="/api/wiki/asset?path=guides%2FDeployment.md&amp;root=%2Fws&amp;repo=projects%2Fx" data-wiki-path="guides/Deployment.md">x</a>');
  });

  test('a link to a file that is not a page keeps the asset URL and no marker', () => {
    const entries = buildWikiEntries(['Home.md', 'files/spec.pdf']);
    const html = rewriteWikiReferences('<a href="files/spec.pdf">spec</a>', { ...scope, entries });
    expect(html).toBe('<a href="/api/wiki/asset?path=files%2Fspec.pdf&amp;root=%2Fws&amp;repo=projects%2Fx">spec</a>');
  });

  test('resolves a bare path from the wiki root', () => {
    const entries = buildWikiEntries(['Home.md', 'trd/v1.3.2/home.md', 'trd/v1.3.3/home.md']);
    const html = rewriteWikiReferences('<a href="trd/v1.3.3/home">x</a>', {
      ...scope,
      path: 'trd/v1.3.2/home.md',
      entries,
    });
    expect(html).toContain('data-wiki-path="trd/v1.3.3/home.md"');
  });

  test('leaves external and unresolvable references untouched', () => {
    const html = '<a href="https://x.test">x</a><a href="missing-page">y</a><img src="https://cdn.test/a.png">';
    expect(rewriteWikiReferences(html, scope)).toBe(html);
  });

  test('does not touch a literal src inside escaped code', () => {
    const html = '<code class="language-html">&lt;img src=&quot;images/a.png&quot;&gt;</code>';
    expect(rewriteWikiReferences(html, scope)).toBe(html);
  });

  test('gives a heading the id its own table of contents names', () => {
    // The renderer's own id keeps the emoji, so `#overview` matched nothing and
    // every TOC entry was inert.
    expect(rewriteWikiReferences('<h2 id="🎯-overview">🎯 Overview</h2>', scope))
      .toBe('<h2 id="overview">🎯 Overview</h2>');
    expect(rewriteWikiReferences('<h3>Required Tools</h3>', scope))
      .toBe('<h3 id="required-tools">Required Tools</h3>');
  });
});
