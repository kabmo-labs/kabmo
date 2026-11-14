/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The catalog UI's three state rules, each of which used to read as a different
 * true sentence:
 *
 * - **A source with no scan says "Not scanned", never a number.** `skillCount`
 *   was a literal (`3`) and `stars`/`updatedAt` were literals too, so a card
 *   announced a repository's size that no request had measured.
 * - **Only the row whose request is in flight goes busy.** The install button
 *   flipped its label after the whole list reloaded, so a slow install looked
 *   like a dead click and a second click started a second CLI run.
 * - **A row the server would skip is pre-unticked and not selectable** (no
 *   description, or already installed) — the import panel must not offer a
 *   checkbox that can only produce a failure line.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { CatalogSkillItem, GitSkillEntry, SkillCatalogSource } from '@/shared/types';
import { SkillCard } from '@/client/components/settings/categories/skill-catalog/SkillCard';
import { describeScan } from '@/client/components/settings/categories/skill-catalog/SourceRail';
import { GitImportPanel } from '@/client/components/settings/categories/skill-catalog/GitImportPanel';
import type { GitImportController } from '@/client/hooks/settings/skill-git-import';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

const skill: CatalogSkillItem = {
  id: 'cat-1',
  sourceId: 'skillshare',
  name: 'review-pr',
  description: 'Reviews a pull request.',
  repoTag: 'acme/skills',
  installs: 12_400,
};

describe('describeScan', () => {
  test('an unscanned source reports "Not scanned", not a guessed count', () => {
    const source: SkillCatalogSource = { id: 'a', name: 'A', repo: 'acme/skills', skillCount: null };
    expect(describeScan(source)).toBe('Not scanned');
  });

  test('a scanned source reports its real count and when it was taken', () => {
    const source: SkillCatalogSource = {
      id: 'a',
      name: 'A',
      repo: 'acme/skills',
      skillCount: 1,
      scannedAt: Date.now() - 5 * 60_000,
    };
    expect(describeScan(source)).toBe('1 skill · scanned 5m ago');
  });

  test('a count with no timestamp is still a count', () => {
    expect(describeScan({ id: 'a', name: 'A', repo: 'acme/skills', skillCount: 4 })).toBe('4 skills');
  });
});

describe('SkillCard', () => {
  test('the busy row says what it is doing and refuses a second click', () => {
    const el = mount(h(SkillCard, { skill, installed: false, busy: true, onInstallToggle: () => {} }));
    const button = el.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Installing…');
    expect(button.disabled).toBe(true);
  });

  test('an installed row offers removal, not install', () => {
    const el = mount(h(SkillCard, { skill, installed: true, busy: false, onInstallToggle: () => {} }));
    expect(el.textContent).toContain('Installed');
    expect(el.textContent).not.toContain('Installing…');
  });

  test('the weekly download count is compacted and shown', () => {
    const el = mount(h(SkillCard, { skill, installed: false, busy: false, onInstallToggle: () => {} }));
    expect(el.textContent).toContain('12K weekly');
  });
});

/** A controller with the panel's own shape, so the panel is exercised for real. */
function controller(overrides: Partial<GitImportController> = {}): GitImportController {
  const skills: GitSkillEntry[] = [
    { path: 'skills/alpha', name: 'alpha', description: 'First', loadable: true },
    { path: 'skills/beta', name: 'beta', description: '', loadable: false },
    { path: 'skills/gamma', name: 'gamma', description: 'Third', loadable: true, installed: true },
  ];
  return {
    inspecting: false,
    installing: false,
    repo: 'acme/skills',
    url: 'acme/skills',
    skills,
    notes: [],
    selected: ['skills/alpha'],
    overwrite: false,
    error: null,
    result: null,
    inspect: async () => {},
    toggle: () => {},
    toggleAll: () => {},
    setOverwrite: () => {},
    install: async () => null,
    reset: () => {},
    ...overrides,
  };
}

describe('GitImportPanel', () => {
  test('an unloadable or already-installed row is disabled and names why', () => {
    const el = mount(h(GitImportPanel, { controller: controller(), onInstalled: () => {} }));
    const boxes = [...el.querySelectorAll('input[type="checkbox"]')].slice(0, 3) as HTMLInputElement[];
    expect(boxes[0]?.disabled).toBe(false);
    expect(boxes[1]?.disabled).toBe(true);
    expect(boxes[2]?.disabled).toBe(true);
    expect(el.textContent).toContain('no description — omp will not load it');
    expect(el.textContent).toContain('already installed');
  });

  test('the install button counts what is actually selected', () => {
    const el = mount(h(GitImportPanel, { controller: controller(), onInstalled: () => {} }));
    expect(el.textContent).toContain('Install 1 skill');
    expect(el.textContent).toContain('1 of 1 installable selected');
  });

  test('a result renders the server’s per-row reason instead of a toast', () => {
    const el = mount(
      h(GitImportPanel, {
        controller: controller({
          result: {
            repo: 'acme/skills',
            installed: ['alpha'],
            skipped: [{ name: 'gamma', reason: 'already installed — enable overwrite to replace it' }],
            skills: [],
          },
        }),
        onInstalled: () => {},
      }),
    );
    expect(el.textContent).toContain('1 installed · 1 skipped');
    expect(el.textContent).toContain('already installed — enable overwrite to replace it');
  });

  test('an inspect failure is shown in the panel, not swallowed', () => {
    const el = mount(
      h(GitImportPanel, {
        controller: controller({ repo: null, skills: [], selected: [], error: 'fatal: repository not found' }),
        onInstalled: () => {},
      }),
    );
    expect(el.textContent).toContain('fatal: repository not found');
  });
});
