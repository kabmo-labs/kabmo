/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The skills sidebar's search/filter behaviour and the detail pane's save gating.
 *
 * Three facts are pinned, each of which was a way for the pane to lie:
 *
 * - **A filter chip's count is over the WHOLE scope.** Counting the visible rows
 *   made every chip read `0` as soon as it was not the active one, so "Read-only
 *   5" disappeared the moment a user looked for it.
 * - **Save stays disabled until the draft differs from disk.** The old pane
 *   offered a permanent "Save Changes" that rewrote an unchanged SKILL.md.
 * - **A missing description is a blocking error, not a hint.** omp refuses to load
 *   a SKILL.md without one, so a save that succeeds would create a skill that
 *   never runs.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { SkillItem } from '@/shared/types';
import {
  SKILL_FILTERS,
  filterCounts,
  filterSkills,
  scopeLabel,
  sourceBadge,
} from '@/client/components/settings/categories/skill-settings/row-meta';
import { SkillDetailPane } from '@/client/components/settings/categories/skill-settings/DetailPane';
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

function skill(overrides: Partial<SkillItem> = {}): SkillItem {
  return {
    id: 'omp-user-alpha',
    name: 'alpha',
    description: 'First skill',
    location: 'user',
    instructions: '---\ndescription: First skill\n---\n\ndo the thing\n',
    project: 'omp',
    source: 'native:user',
    managed: true,
    ...overrides,
  };
}

const LIST: SkillItem[] = [
  skill(),
  skill({
    id: 'omp-project-beta',
    name: 'beta',
    description: 'Second skill',
    source: 'native:project',
    location: 'project',
    hidden: true,
  }),
  skill({ id: 'omp-user-gamma', name: 'gamma', description: 'Third skill', source: 'agents:user', managed: false }),
];

describe('row metadata', () => {
  test('a discovery source reads as a short badge', () => {
    expect(sourceBadge(LIST[0]!)).toBe('omp');
    expect(sourceBadge(LIST[2]!)).toBe('agents');
    expect(sourceBadge(skill({ source: undefined }))).toBe('other');
  });

  test('the scope comes from the source, not from the location field', () => {
    expect(scopeLabel(LIST[0]!)).toBe('user');
    expect(scopeLabel(LIST[1]!)).toBe('project');
  });
});

describe('filterSkills and filterCounts', () => {
  test('chips count the whole scope, not the visible rows', () => {
    const counts = filterCounts(LIST);
    expect(counts).toEqual({ all: 3, managed: 2, 'read-only': 1, hidden: 1 });
    // The count of a filter that is NOT active is still its real count.
    expect(counts[SKILL_FILTERS[1]!.id]).toBe(2);
  });

  test('managed and read-only partition the list', () => {
    expect(filterSkills(LIST, '', 'managed').map((item) => item.name)).toEqual(['alpha', 'beta']);
    expect(filterSkills(LIST, '', 'read-only').map((item) => item.name)).toEqual(['gamma']);
  });

  test('the search matches the name, the description and the source', () => {
    expect(filterSkills(LIST, 'gam', 'all').map((item) => item.name)).toEqual(['gamma']);
    expect(filterSkills(LIST, 'Second skill', 'all').map((item) => item.name)).toEqual(['beta']);
    expect(filterSkills(LIST, 'agents', 'all').map((item) => item.name)).toEqual(['gamma']);
  });
});

describe('SkillDetailPane', () => {
  test('an unchanged draft cannot be saved', () => {
    const el = mount(
      h(SkillDetailPane, { skill: skill(), isCreatingNew: false, onSave: () => {} }),
    );
    const save = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Save changes'));
    expect(save).toBeDefined();
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(el.textContent).toContain('Saved — nothing to write');
  });

  test('a draft missing its description reports that omp would not load it', () => {
    const el = mount(
      h(SkillDetailPane, {
        skill: skill({ description: '' }),
        isCreatingNew: false,
        onSave: () => {},
      }),
    );
    expect(el.textContent).toContain('omp does not load a SKILL.md without one');
    const save = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Save changes'));
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  test('a read-only skill offers no editor or save at all', () => {
    const el = mount(
      h(SkillDetailPane, { skill: skill({ managed: false, source: 'agents:user' }), isCreatingNew: false, onSave: () => {} }),
    );
    expect(el.textContent).toContain('read-only');
    expect(el.textContent).not.toContain('Save changes');
    expect((el.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  test('the body the pane saves carries no second frontmatter block', () => {
    const saved: Partial<SkillItem>[] = [];
    const el = mount(
      h(SkillDetailPane, {
        skill: skill({ instructions: '---\ndescription: First skill\n---\n\ndo the thing\n' }),
        isCreatingNew: false,
        onSave: (draft) => saved.push(draft),
      }),
    );
    // The pane has two textareas: the description and the SKILL.md body.
    const textarea = [...el.querySelectorAll('textarea')].at(-1) as HTMLTextAreaElement;
    expect(textarea.value.trim()).toBe('do the thing');

    const save = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Save changes'))!;
    expect((save as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      textarea.value = 'do a different thing';
      textarea.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
    });
    const after = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Save changes'))!;
    expect((after as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      // happy-dom's window is installed as a global, so the event must come from
      // the document's own realm rather than a bare constructor.
      after.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
    });
    expect(saved[0]?.instructions).toBe('do a different thing');
    expect(saved[0]?.instructions).not.toContain('---');
  });
});
