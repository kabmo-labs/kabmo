/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared branch: one disclosure, one tree, one slot rule.
 *
 * The suite pins the three facts the design rests on after the two lists were
 * merged: a child session is rendered by the CHROME's own row component, a
 * deeper branch recurses with the guide flags of every ancestor, and a subagent
 * is a leaf whose leading 16px slot carries its state while the robot takes the
 * harness column.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following `SessionItem.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionBranch } from '@/client/components/common/session-branch';
import type { BranchControl, SessionBranchProps } from '@/client/components/common/session-branch';
import { SubagentRow } from '@/client/components/common/session-branch/SubagentRow';
import type { SessionItemData, SubagentInfo } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(node: preact.ComponentChild) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node, container);
  });
  return container;
}

/** A row stand-in that exposes the control the chrome would have received. */
const row = (session: SessionItemData, control: BranchControl) =>
  h(
    'button',
    {
      'data-testid': 'branch-row',
      'data-id': String(session.id),
      'data-expandable': String(control.expandable),
      'data-expanded': String(control.isExpanded),
    },
    session.title,
  );

function branch(overrides: Partial<SessionBranchProps> = {}) {
  const childrenOf = new Map<string, SessionItemData[]>([
    ['root', [
      { id: 'child-a', folder_id: 1, title: 'Child A' },
      { id: 'child-b', folder_id: 1, title: 'Child B' },
    ]],
    ['child-a', [
      { id: 'grandchild', folder_id: 1, title: 'Grandchild' },
    ]],
  ]);
  return h(SessionBranch, {
    parentId: 'root',
    hasSubagents: false,
    childrenOf,
    expandedIds: new Set<string>(),
    onToggle: () => {},
    activeSessionId: null,
    renderSession: row,
    style: { inset: 'px-2', insetPx: 8, slotWidth: 16, markGap: 8, padding: 'py-1', glyph: 12 },
    ...overrides,
  });
}

describe('SessionBranch', () => {
  test('renders the chrome row for each child, with the branch control', async () => {
    const el = await mount(branch());
    const rows = [...el.querySelectorAll<HTMLElement>('[data-testid="branch-row"]')];
    expect(rows.map((r) => r.dataset.id)).toEqual(['child-a', 'child-b']);
    // Child A has a child of its own, so its chevron exists; B has nothing.
    expect(rows[0]?.dataset.expandable).toBe('true');
    expect(rows[1]?.dataset.expandable).toBe('false');
  });

  test('a branch with only subagents keeps the session expandable', async () => {
    const childrenOf = new Map([
      ['root', [{ id: 'child-a', folder_id: 1, title: 'Child A', hasSubagents: true }]],
    ]);
    const el = await mount(branch({ childrenOf }));
    expect(el.querySelector<HTMLElement>('[data-testid="branch-row"]')?.dataset.expandable).toBe('true');
  });

  test('guides mark the last sibling and continue the ancestors that have one', async () => {
    const el = await mount(branch({
      expandedIds: new Set(['child-a']),
      renderSession: (session, control) => h('div', null, row(session, control)),
    }));
    const connectors = [...el.querySelectorAll<HTMLElement>('[data-guide="connector"]')];
    expect(connectors).toHaveLength(3);
    // Child A is not last at its level, the grandchild is its only child, and
    // Child B is the last row of the branch.
    expect(connectors[0]?.dataset.last).toBeUndefined();
    expect(connectors[1]?.dataset.last).toBe('true');
    expect(connectors[2]?.dataset.last).toBe('true');
    // The grandchild inherits one ancestor line, and that ancestor (Child A)
    // has a following sibling, so the line continues past the grandchild.
    const inherited = [...el.querySelectorAll<HTMLElement>('[data-guide="ancestor"]')];
    expect(inherited).toHaveLength(1);
    expect(inherited[0]?.dataset.continues).toBe('true');
  });

  test('the guide stays on the chevron column and its arm reaches the child indicator', async () => {
    const el = await mount(branch());
    const connector = el.querySelector<HTMLElement>('[data-guide="connector"]');
    const vertical = connector?.children[0] as HTMLElement;
    const horizontal = connector?.children[1] as HTMLElement;
    // Classic: one level is the 22px pitch (slot half + mark gap + glyph half),
    // so the child's indicator slot centre lands on the parent's harness centre.
    expect(connector?.style.width).toBe('22px');
    // The line stays on the parent chevron's centre; spacing is vertical only.
    expect(vertical.style.left).toBe('15px');
    expect(horizontal.style.left).toBe('15px');
    // The arm runs from the chevron column to the child slot's left edge.
    expect(horizontal.style.width).toBe('15px');
    expect(vertical.style.width).toBe('2px');
    expect(horizontal.style.height).toBe('2px');
  });

  test('the first row starts its stem below the chevron', async () => {
    const el = await mount(branch());
    const firstVertical = el.querySelector<HTMLElement>('[data-guide="connector"]')?.children[0] as HTMLElement;
    // Siblings after it continue from the row above, so only the first row
    // carries the vertical gap.
    expect(firstVertical.style.top).toBe('-6px');
  });

  test('the last sibling reaches its own centre, not just its top edge', async () => {
    const el = await mount(branch());
    const connectors = [...el.querySelectorAll<HTMLElement>('[data-guide="connector"]')];
    const lastVertical = connectors[1]?.children[0] as HTMLElement;
    expect(lastVertical.style.top).toBe('0px');
    // From its own top edge to its centre: no overlap with the sibling above, so
    // the translucent stroke cannot darken into a band.
    expect(lastVertical.style.height).toBe('50%');
  });

  test('a first-and-only child stops at its centre', async () => {
    const childrenOf = new Map<string, SessionItemData[]>([
      ['root', [{ id: 'only', folder_id: 1, title: 'Only' }]],
    ]);
    const el = await mount(branch({ childrenOf }));
    const vertical = el.querySelector<HTMLElement>('[data-guide="connector"]')?.children[0] as HTMLElement;
    expect(vertical.style.top).toBe('-6px');
    expect(vertical.style.height).toBe('calc(50% + 6px)');
  });

  test('an ancestor line sits on the same guide column as the connector', async () => {
    const el = await mount(branch({ expandedIds: new Set(['child-a']) }));
    const ancestorLine = el.querySelector<HTMLElement>('[data-guide="ancestor"] > span');
    expect(ancestorLine?.style.left).toBe('15px');
  });

  test('does not recurse into a child that is collapsed', async () => {
    const el = await mount(branch());
    expect(el.querySelector('[data-id="grandchild"]')).toBeNull();
  });

  test('an expanded row with nothing under it draws nothing', async () => {
    const el = await mount(branch({
      childrenOf: new Map([['root', []]]),
      hasSubagents: false,
    }));
    expect(el.querySelector('[data-testid="session-branch"]')).toBeNull();
  });
});

describe('SubagentRow', () => {
  const subagent: SubagentInfo = {
    id: 'Sleeper',
    agent: 'scout',
    status: 'started',
    index: 0,
    lastUpdate: Date.now(),
  };

  test('the shared slot carries the state and the robot takes the harness column', async () => {
    const el = await mount(h(SubagentRow, {
      subagent,
      sessionId: 'root',
      style: { inset: 'px-2', insetPx: 8, slotWidth: 16, markGap: 8, padding: 'py-1', glyph: 12 },
      running: true,
    }));
    const slot = el.querySelector('[data-testid="subagent-status-slot"]');
    expect(slot).not.toBeNull();
    // A live run is the pulsing dot, not an icon.
    expect(slot?.querySelector('svg')).toBeNull();
    expect(slot?.firstElementChild).not.toBeNull();
    const mark = el.querySelector('[data-testid="subagent-mark"]');
    expect(mark?.querySelector('svg')).not.toBeNull();
    // It is a robot, not a harness: no harness glyph rides the row.
    expect(el.querySelector('[data-harness]')).toBeNull();
    expect(el.querySelector('button')?.textContent).toContain('Sleeper');
  });

  test('a settled subagent draws the terminal glyph instead of a spinner', async () => {
    const el = await mount(h(SubagentRow, {
      subagent: { ...subagent, status: 'completed' },
      sessionId: 'root',
      style: { inset: '', insetPx: 0, slotWidth: 16, markGap: 8, padding: 'py-2', glyph: 13 },
      running: false,
    }));
    expect(el.querySelector('[data-testid="subagent-status-slot"] svg')).not.toBeNull();
    expect(el.querySelector('[role="status"]')).toBeNull();
  });
});
