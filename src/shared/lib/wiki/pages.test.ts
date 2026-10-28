/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wiki's page list and its reference resolution.
 *
 * The cases pinned here are the ones a real wiki produced and a naive
 * implementation got wrong: gollum's `[[Embed Diagrams]]` naming a file called
 * `Embed-Diagrams.md`, GitLab's `[v1.6.0](change_logs/v1.6.0)` omitting the
 * extension, both hosts' chrome fragments (`_Sidebar`) landing in the nav, and
 * GitLab's `.gitlab/redirects.yml` being provider metadata rather than a page.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildWikiEntries,
  expandGollumLinks,
  resolveWikiReference,
  wikiEntryLookup,
  wikiHeadingSlug,
} from '@/shared/lib/wiki/pages';
import {
  findWikiSidebarPath,
  parseWikiSidebar,
  sectionsFromEntries,
  withRemainingPages,
} from '@/shared/lib/wiki/sidebar';

const DRAWIO_TREE = [
  'Home.md',
  'deploying.md',
  'Embed-Diagrams.md',
  'Getting-Support.md',
  'self-help-resources.md',
  'Setting-up-a-OneDrive-project-to-use-with-diagrams.net.md',
  'Stale-bot-FAQ.md',
  'Translations.md',
  'images/app_branding.png',
  'images/schema.svg',
  '_Sidebar.md',
  '_Footer.md',
];

const GITLAB_TREE = [
  'Home.md',
  'Testing.md',
  '_sidebar.md',
  'change_logs/v1.4.1.md',
  'change_logs/v1.6.0.md',
  // The nested layout a real GitLab wiki uses, and the reason a bare path is
  // resolved from the root: `trd/v1.3.2/home.md` links to `trd/v1.3.3/home`.
  'trd/v1.3.2/home.md',
  'trd/v1.3.2/HLD.md',
  'trd/v1.3.3/home.md',
  '.gitlab/redirects.yml',
];

describe('buildWikiEntries', () => {
  test('lists markdown pages before assets, Home first', () => {
    const entries = buildWikiEntries(DRAWIO_TREE);
    expect(entries[0].path).toBe('Home.md');
    expect(entries.map((entry) => entry.isMarkdown)).toEqual([
      true, true, true, true, true, true, true, true, false, false,
    ]);
    expect(entries.filter((entry) => !entry.isMarkdown).map((entry) => entry.path)).toEqual([
      'images/app_branding.png',
      'images/schema.svg',
    ]);
  });

  test('keeps assets in the tree so a page reference can resolve', () => {
    const entries = buildWikiEntries(GITLAB_TREE);
    expect(entries.some((entry) => entry.path === 'change_logs/v1.6.0.md')).toBe(true);
    expect(entries.some((entry) => entry.path === '.gitlab/redirects.yml')).toBe(false);
  });

  test('drops both hosts’ chrome fragments, whatever their case', () => {
    const paths = buildWikiEntries([...DRAWIO_TREE, ...GITLAB_TREE]).map((entry) => entry.path);
    expect(paths).not.toContain('_Sidebar.md');
    expect(paths).not.toContain('_Footer.md');
    expect(paths).not.toContain('_sidebar.md');
  });

  test('groups a folder and strips the extension from the title', () => {
    const entries = buildWikiEntries(GITLAB_TREE);
    const changelog = entries.find((entry) => entry.path === 'change_logs/v1.6.0.md');
    expect(changelog).toMatchObject({ title: 'v1.6.0', folder: 'change_logs', isMarkdown: true });
  });
});

describe('resolveWikiReference', () => {
  const lookup = wikiEntryLookup(buildWikiEntries([...DRAWIO_TREE, ...GITLAB_TREE]));

  test('resolves a bare path from the wiki root, not the page folder', () => {
    // The shape a real GitLab wiki writes: from `trd/v1.3.2/home.md`, a link to
    // `trd/v1.3.3/home` is rooted at the wiki, while page-relative resolution
    // looked for `trd/v1.3.2/trd/v1.3.3/home` and found nothing — 25 of that
    // wiki's 41 links then opened a browser tab instead of a page.
    expect(resolveWikiReference('trd/v1.3.3/home', 'trd/v1.3.2/home.md', lookup)).toBe('trd/v1.3.3/home.md');
    expect(resolveWikiReference('trd/v1.3.2/HLD', 'trd/v1.3.2/home.md', lookup)).toBe('trd/v1.3.2/HLD.md');
  });

  test('still resolves a bare sibling name beside the page', () => {
    // `Home.md` has no folder of its own, so both bases are the root here.
    expect(resolveWikiReference('change_logs/v1.6.0', 'Home.md', lookup)).toBe('change_logs/v1.6.0.md');
  });

  test('an explicit ./ or ../ asks for the page folder', () => {
    expect(resolveWikiReference('./v1.4.1', 'change_logs/v1.6.0.md', lookup)).toBe('change_logs/v1.4.1.md');
    expect(resolveWikiReference('../Home', 'change_logs/v1.6.0.md', lookup)).toBe('Home.md');
    // `../trd/v1.3.3/home` from a nested page is the root form written the other way.
    expect(resolveWikiReference('../trd/v1.3.3/home', 'trd/v1.3.2/home.md', lookup)).toBe('trd/v1.3.3/home.md');
  });

  test('a root-relative path is the same as a bare one', () => {
    expect(resolveWikiReference('/change_logs/v1.6.0', 'Home.md', lookup)).toBe('change_logs/v1.6.0.md');
  });

  test('resolves case-insensitively', () => {
    expect(resolveWikiReference('translations', 'Home.md', lookup)).toBe('Translations.md');
    expect(resolveWikiReference('HOMEs.md', 'Home.md', lookup)).toBe(null);
  });

  test('leaves anything that is not an in-wiki reference alone', () => {
    for (const reference of [
      'https://x.test/a',
      'mailto:a@b.c',
      '//cdn.test/a',
      '#section',
      'missing-page',
      '',
    ]) {
      expect(resolveWikiReference(reference, 'Home.md', lookup)).toBe(null);
    }
  });

  test('cannot climb out of the wiki with ..', () => {
    expect(resolveWikiReference('../../../../etc/passwd', 'Home.md', lookup)).toBe(null);
  });
});

describe('findWikiSidebarPath', () => {
  test('finds the sidebar whatever its case or extension', () => {
    expect(findWikiSidebarPath(['Home.md', '_sidebar.md'])).toBe('_sidebar.md');
    expect(findWikiSidebarPath(['Home.md', '_Sidebar.md'])).toBe('_Sidebar.md');
    expect(findWikiSidebarPath(['Home.md'])).toBe(null);
  });

  test('prefers the root sidebar over a nested one', () => {
    expect(findWikiSidebarPath(['guides/_Sidebar.md', '_sidebar.md'])).toBe('_sidebar.md');
    expect(findWikiSidebarPath(['guides/_Sidebar.md'])).toBe('guides/_Sidebar.md');
  });
});

describe('parseWikiSidebar', () => {
  // The exact shape this repo's own GitLab wiki writes.
  const SIDEBAR = `### 📚 Navigation

- [🏠 Home](Home)
- [🧪 Testing Guide](Testing)

---

### 📋 Changelogs

- [v1.6.0](change_logs/v1.6.0)
- [v1.4.1](change_logs/v1.4.1)

---

### 📊 Info

**Version**: 1.6.0
**Java**: 1.8
`;

  const entries = buildWikiEntries(['Home.md', 'Testing.md', 'change_logs/v1.6.0.md', 'change_logs/v1.4.1.md', 'Orphan.md']);
  const sections = parseWikiSidebar(SIDEBAR, '_sidebar.md', entries);

  test('keeps the author’s groups and labels', () => {
    expect(sections.map((section) => section.title)).toEqual(['📚 Navigation', '📋 Changelogs', '📊 Info']);
    expect(sections[0].links.map((link) => link.label)).toEqual(['🏠 Home', '🧪 Testing Guide']);
    expect(sections[1].links.map((link) => link.label)).toEqual(['v1.6.0', 'v1.4.1']);
  });

  test('resolves each link to the page it names', () => {
    expect(sections[1].links[0].path).toBe('change_logs/v1.6.0.md');
  });

  test('keeps a non-link block as the section’s notes', () => {
    expect(sections[2].links).toEqual([]);
    expect(sections[2].notes).toEqual(['Version: 1.6.0', 'Java: 1.8']);
  });

  test('classifies an external link and a dangling one', () => {
    const parsed = parseWikiSidebar('- [Repo](https://github.com/o/n)\n- [Gone](nowhere)\n', '_sidebar.md', entries);
    expect(parsed[0].links[0]).toMatchObject({ url: 'https://github.com/o/n', path: null });
    expect(parsed[0].links[1]).toMatchObject({ url: null, path: null, target: 'nowhere' });
  });

  test('reads a nested bullet and a link carrying a title', () => {
    const parsed = parseWikiSidebar('  - [Deep](change_logs/v1.6.0 "the title")\n', '_sidebar.md', entries);
    expect(parsed[0].links[0]).toMatchObject({ label: 'Deep', path: 'change_logs/v1.6.0.md' });
  });
});

describe('withRemainingPages', () => {
  const entries = buildWikiEntries(['Home.md', 'Orphan.md', 'change_logs/v1.0.0.md']);
  const sidebar = parseWikiSidebar('- [Home](Home)\n', '_sidebar.md', entries);

  test('appends a page the sidebar never mentions', () => {
    // A sidebar is the author's navigation, not an index — the panel has no
    // address bar, so an unlisted page would be unreachable.
    const merged = withRemainingPages(sidebar, entries);
    expect(merged.at(-1)?.title).toBe('Other pages');
    expect(merged.at(-1)?.links.map((link) => link.path)).toEqual(['Orphan.md', 'change_logs/v1.0.0.md']);
  });

  test('adds nothing when the sidebar lists every page', () => {
    const full = parseWikiSidebar('- [Home](Home)\n- [Orphan](Orphan)\n- [v1](change_logs/v1.0.0)\n', '_sidebar.md', entries);
    expect(withRemainingPages(full, entries)).toHaveLength(1);
  });
});

describe('sectionsFromEntries', () => {
  test('groups a sidebar-less wiki by folder, markdown pages only', () => {
    const entries = buildWikiEntries(['Home.md', 'guides/A.md', 'guides/B.md', 'images/x.png']);
    expect(sectionsFromEntries(entries).map((section) => [section.title, section.links.length])).toEqual([
      ['Pages', 1],
      ['guides', 2],
    ]);
  });
});

describe('wikiHeadingSlug', () => {
  test('drops an emoji but keeps the variation selector after it', () => {
    // The two shapes a real wiki produced: a symbol is not a letter and is
    // dropped, while the U+FE0F mark that follows it survives — which is why the
    // anchor GitLab writes for `## ⚠️ Migration Queries` starts with `%EF%B8%8F`.
    expect(wikiHeadingSlug('🎯 Overview')).toBe('overview');
    expect(wikiHeadingSlug('⚠️ Migration Queries')).toBe('\ufe0f-migration-queries');
    expect(wikiHeadingSlug('Test Count Summary')).toBe('test-count-summary');
    expect(wikiHeadingSlug('C++ & Rust: a/b')).toBe('c-rust-ab');
  });
});

describe('expandGollumLinks', () => {
  test('turns a bare page link into a markdown link, encoding the space', () => {
    // `[x](Embed Diagrams)` is not a link — a destination cannot hold a space —
    // so the target is percent-encoded and resolved back to the dashed page.
    expect(expandGollumLinks('see [[Embed Diagrams]]')).toBe('see [Embed Diagrams](Embed%20Diagrams)');
  });

  test('keeps the label and the target of a piped link', () => {
    expect(expandGollumLinks('[[Deploying|deploying]]')).toBe('[Deploying](deploying)');
    expect(expandGollumLinks('[[Deploying|deploying|anchor]]')).toBe('[Deploying](deploying#anchor)');
  });

  test('leaves fenced blocks and inline code as written', () => {
    const source = '```\n[[not a link]]\n```\n\ninline `[[x]]` and [[real]]';
    expect(expandGollumLinks(source)).toBe('```\n[[not a link]]\n```\n\ninline `[[x]]` and [real](real)');
  });
});
