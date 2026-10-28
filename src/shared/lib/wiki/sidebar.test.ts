/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a wiki's own `_Sidebar.md` into the panel's navigation.
 *
 * A sidebar is hand-written, so the parser is deliberately tolerant and every
 * tolerance is a user-visible decision: a nested bullet is just another link
 * (no hierarchy), a `---` rule separates groups instead of becoming a note, a
 * link with a `"title"` must not leak the title into the target, a label wrapped
 * in `**`/backticks is printed as plain text, and a trailing prose block becomes
 * a note (this repo's own `**Version**: …` block). Two failure modes are pinned
 * explicitly: a bracketed target that does NOT resolve must be kept with
 * `path: null` (inert text, not a dead link), and a heading with no links or
 * notes must be dropped rather than rendered as an empty group.
 *
 * `sectionsFromEntries` is the fallback for a wiki with no sidebar, and
 * `withRemainingPages` appends pages the author's nav omitted — GitLab's own nav
 * still lists them, and the panel has no address bar to reach one otherwise.
 */

import { describe, expect, test } from 'bun:test';

import { findWikiSidebarPath, parseWikiSidebar, sectionsFromEntries, withRemainingPages } from '@/shared/lib/wiki/sidebar';
import type { WikiEntry, WikiNavLink, WikiNavSection } from '@/shared/types/wiki';

const base = (path: string): string => (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '');

const entry = (path: string, folder = ''): WikiEntry => ({
  path,
  title: base(path),
  folder,
  isMarkdown: /\.(md|markdown)$/i.test(path),
});

const ENTRIES: WikiEntry[] = [
  entry('Home.md'),
  entry('guides/setup.md', 'guides'),
  entry('change_logs/v1.6.0.md', 'change_logs'),
  entry('docs/setup.md', 'docs'),
  entry('logo.png'),
];

const navLink = (label: string, path: string | null, target = path ?? 'https://example.test/x'): WikiNavLink => ({
  label,
  target,
  path,
  url: null,
});

const navSection = (title: string | null, links: WikiNavLink[]): WikiNavSection => ({ title, links, notes: [] });

describe('findWikiSidebarPath', () => {
  test('is null without a sidebar file', () => {
    expect(findWikiSidebarPath([])).toBeNull();
    expect(findWikiSidebarPath(['Home.md', 'Other.md'])).toBeNull();
    expect(findWikiSidebarPath(['Sidebar.md'])).toBeNull();
    expect(findWikiSidebarPath(['_sidebar.txt'])).toBeNull();
  });

  test('matches _Sidebar with any case and either markdown extension', () => {
    expect(findWikiSidebarPath(['_Sidebar.md'])).toBe('_Sidebar.md');
    expect(findWikiSidebarPath(['Home.md', '_sidebar.md'])).toBe('_sidebar.md');
    expect(findWikiSidebarPath(['_Sidebar.markdown'])).toBe('_Sidebar.markdown');
    expect(findWikiSidebarPath(['_sidebar'])).toBe('_sidebar');
  });

  test('a root sidebar wins over a nested one, else the first candidate', () => {
    expect(findWikiSidebarPath(['docs/_Sidebar.md', '_Sidebar.md'])).toBe('_Sidebar.md');
    expect(findWikiSidebarPath(['x/_sidebar.md', 'y/_sidebar.md'])).toBe('x/_sidebar.md');
  });
});

describe('parseWikiSidebar', () => {
  test('groups links under headings, treating nested bullets as links', () => {
    const markdown = [
      '### 📚 Navigation',
      '- [Home](Home)',
      '- [Setup](guides/setup)',
      '  - [Nested](guides/setup.md)',
      '### 📋 Changelogs',
      '- [v1.6.0](change_logs/v1.6.0.md)',
    ].join('\n');

    const sections = parseWikiSidebar(markdown, '_Sidebar.md', ENTRIES);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual({
      title: '📚 Navigation',
      notes: [],
      links: [
        { label: 'Home', target: 'Home', path: 'Home.md', url: null },
        { label: 'Setup', target: 'guides/setup', path: 'guides/setup.md', url: null },
        { label: 'Nested', target: 'guides/setup.md', path: 'guides/setup.md', url: null },
      ],
    });
    expect(sections[1].title).toBe('📋 Changelogs');
    expect(sections[1].links[0].path).toBe('change_logs/v1.6.0.md');
  });

  test('reads a link title without leaking it into the target', () => {
    const sections = parseWikiSidebar('- [Docs](guides/setup.md "Setup guide")', '_Sidebar.md', ENTRIES);
    expect(sections[0].links[0]).toEqual({
      label: 'Docs',
      target: 'guides/setup.md',
      path: 'guides/setup.md',
      url: null,
    });
  });

  test('an absolute target is an external URL, not a wiki page', () => {
    const sections = parseWikiSidebar('- [GitHub](https://github.com/x)', '_Sidebar.md', ENTRIES);
    expect(sections[0].links[0]).toEqual({
      label: 'GitHub',
      target: 'https://github.com/x',
      path: null,
      url: 'https://github.com/x',
    });
  });

  test('an unresolvable target is kept inert with a null path', () => {
    const sections = parseWikiSidebar('- [Missing](nope/missing)', '_Sidebar.md', ENTRIES);
    expect(sections[0].links[0]).toEqual({
      label: 'Missing',
      target: 'nope/missing',
      path: null,
      url: null,
    });
  });

  test('an empty label falls back to the target text', () => {
    const sections = parseWikiSidebar('- [](Home.md)', '_Sidebar.md', ENTRIES);
    expect(sections[0].links[0].label).toBe('Home.md');
  });

  test('prose lines become notes with emphasis and code ticks stripped', () => {
    const markdown = ['### 📊 Info', '**Version**: 1.6.0', '`build` 42'].join('\n');
    const sections = parseWikiSidebar(markdown, '_Sidebar.md', ENTRIES);
    expect(sections[0]).toEqual({
      title: '📊 Info',
      links: [],
      notes: ['Version: 1.6.0', 'build 42'],
    });
  });

  test('a heading label is reduced to plain text', () => {
    const bold = parseWikiSidebar('### **Bold** Section\n- [Home](Home)', '_Sidebar.md', ENTRIES);
    expect(bold[0].title).toBe('Bold Section');
    const code = parseWikiSidebar('### `code` group\n- [Home](Home)', '_Sidebar.md', ENTRIES);
    expect(code[0].title).toBe('code group');
  });

  test('horizontal rules are separators, not notes', () => {
    const markdown = ['### A', '- [Home](Home)', '---', '***', '___', '- [Setup](guides/setup)'].join('\n');
    const sections = parseWikiSidebar(markdown, '_Sidebar.md', ENTRIES);
    expect(sections).toHaveLength(1);
    expect(sections[0].links).toHaveLength(2);
    expect(sections[0].notes).toEqual([]);
  });

  test('links before any heading land in a title-less section', () => {
    const sections = parseWikiSidebar('- [Home](Home)\n### Later\n- [Setup](guides/setup)', '_Sidebar.md', ENTRIES);
    expect(sections[0].title).toBeNull();
    expect(sections[0].links[0].label).toBe('Home');
    expect(sections[1].title).toBe('Later');
  });

  test('a heading with no links or notes is dropped', () => {
    const sections = parseWikiSidebar('### Empty\n### Filled\n- [Home](Home)', '_Sidebar.md', ENTRIES);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Filled');
  });

  test('accepts heading levels 1-6, but not an over-indented or unspaced hash', () => {
    expect(parseWikiSidebar('# H1\n- [Home](Home)', '_Sidebar.md', ENTRIES)[0].title).toBe('H1');
    expect(parseWikiSidebar('###### H6\n- [Home](Home)', '_Sidebar.md', ENTRIES)[0].title).toBe('H6');
    expect(parseWikiSidebar('    # not a heading', '_Sidebar.md', ENTRIES)[0].title).toBeNull();
    expect(parseWikiSidebar('#H1', '_Sidebar.md', ENTRIES)[0].notes).toEqual(['#H1']);
  });

  test('blank lines never become notes', () => {
    const sections = parseWikiSidebar('### A\n- [Home](Home)\n\nprose', '_Sidebar.md', ENTRIES);
    expect(sections[0].notes).toEqual(['prose']);
    const spaced = parseWikiSidebar('first\n\nsecond', '_Sidebar.md', ENTRIES);
    expect(spaced[0].notes).toEqual(['first', 'second']);
  });

  test('a bare target resolves from the root first, then the sidebar folder', () => {
    const sections = parseWikiSidebar('- [Setup](setup)', 'docs/_Sidebar.md', ENTRIES);
    expect(sections[0].links[0].path).toBe('docs/setup.md');
  });

  test('an explicitly relative target is tried in the page folder first', () => {
    const sections = parseWikiSidebar('- [Up](../Home)', 'docs/_Sidebar.md', ENTRIES);
    expect(sections[0].links[0].path).toBe('Home.md');
  });
});

describe('sectionsFromEntries', () => {
  test('groups markdown pages by folder in entry order and skips assets', () => {
    const sections = sectionsFromEntries([
      entry('Home.md'),
      entry('guides/a.md', 'guides'),
      entry('guides/b.md', 'guides'),
      entry('logo.png'),
    ]);
    expect(sections.map((section) => section.title)).toEqual(['Pages', 'guides']);
    expect(sections[0].links[0]).toEqual({
      label: 'Home',
      target: 'Home.md',
      path: 'Home.md',
      url: null,
    });
    expect(sections[1].links.map((link) => link.label)).toEqual(['a', 'b']);
  });

  test('a folder that reappears later starts a new section', () => {
    const sections = sectionsFromEntries([entry('guides/a.md', 'guides'), entry('Home.md'), entry('guides/b.md', 'guides')]);
    expect(sections.map((section) => section.title)).toEqual(['guides', 'Pages', 'guides']);
  });

  test('is empty without markdown pages', () => {
    expect(sectionsFromEntries([])).toEqual([]);
    expect(sectionsFromEntries([entry('logo.png')])).toEqual([]);
  });
});

describe('withRemainingPages', () => {
  test('appends the pages the sidebar omitted', () => {
    const sections = [navSection('Nav', [navLink('Home', 'Home.md')])];
    const result = withRemainingPages(sections, [entry('Home.md'), entry('Other.md')]);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      title: 'Other pages',
      notes: [],
      links: [{ label: 'Other', target: 'Other.md', path: 'Other.md', url: null }],
    });
  });

  test('adds nothing when every page is listed', () => {
    const sections = [navSection('Nav', [navLink('Home', 'Home.md')])];
    expect(withRemainingPages(sections, [entry('Home.md')])).toHaveLength(1);
  });

  test('matching is case-insensitive and ignores assets', () => {
    const sections = [navSection('Nav', [navLink('Home', 'Home.md')])];
    const result = withRemainingPages(sections, [entry('home.md'), entry('logo.png')]);
    expect(result).toHaveLength(1);
  });

  test('a link with no resolved path does not count as listed', () => {
    const sections = [navSection('Ext', [navLink('Ext', null)])];
    const result = withRemainingPages(sections, [entry('Home.md')]);
    expect(result[1].links.map((link) => link.path)).toEqual(['Home.md']);
  });

  test('works with no sidebar at all and preserves entry order', () => {
    const result = withRemainingPages([], [entry('B.md'), entry('A.md')]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Other pages');
    expect(result[0].links.map((link) => link.label)).toEqual(['B', 'A']);
  });
});
