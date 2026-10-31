/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two-level list: a collapsible group per FILE, a collapsible row per command.
 *
 * The behaviours pinned here are the ones a disclosure gets wrong:
 *
 * - **`inert` while collapsed, on BOTH levels.** A closed group's rows must leave
 *   the tab order and the accessibility tree — without it `Tab` walks into rows
 *   nobody can see, and a screen reader announces a command inside a closed group.
 *   The same applies inside a command row's own body.
 * - **Absent means EXPANDED.** A workspace seen for the first time must show its
 *   commands; a list that defaulted to collapsed would look like a repository
 *   with no commands in it.
 * - **The group toggle reports the file it names**, so the caller can persist it
 *   per file. Reporting an index would break the moment the scan reorders.
 * - **One row's output is not another's.** Two commands each expand into their
 *   own body, and the log of one never renders in the other.
 *
 * Rendered with `h()` against happy-dom with real clicks. The reveal is CSS
 * (`grid-template-rows`), which happy-dom does not compute, so what is asserted
 * is `data-expanded` and `inert` — what the stylesheet and the accessibility tree
 * actually read.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { CommandGroups, latestRunByCommand } from './Groups';
import type { CommandGroup, RunLog, RunSummary } from '../protocol';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

let container: HTMLElement;
/** Every action the list dispatched, in order. */
let calls: string[];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!saved.has(key)) saved.set(key, target[key]);
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (saved.has(key)) target[key] = saved.get(key);
    else delete target[key];
  }
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  calls = [];
});

/** Two groups, so a collapse of one cannot be mistaken for a collapse of all. */
const GROUPS: CommandGroup[] = [
  {
    file: 'package.json',
    cwd: '.',
    kind: 'package',
    runner: 'bun',
    commands: [
      { id: 'package.json#package:dev', name: 'dev', label: 'bun run dev', argv: ['bun', 'run', 'dev'] },
      { id: 'package.json#package:lint', name: 'lint', label: 'bun run lint', argv: ['bun', 'run', 'lint'] },
    ],
  },
  {
    file: 'Makefile',
    cwd: '.',
    kind: 'make',
    commands: [{ id: 'Makefile#make:build', name: 'build', label: 'make build', argv: ['make', 'build'] }],
  },
];

function finishedRun(commandId: string, id: string): RunSummary {
  return {
    id,
    sessionId: 's1',
    scopeKey: '/ws\0.',
    commandId,
    file: 'package.json',
    label: commandId,
    background: false,
    status: 'exited',
    startedAt: Date.now(),
    endedAt: Date.now(),
    exitCode: 0,
    signal: null,
    bytes: 3,
    ringBytes: 3,
  };
}

async function mount(overrides: Partial<Parameters<typeof CommandGroups>[0]> = {}): Promise<void> {
  container = document.createElement('div') as unknown as HTMLElement;
  document.body.appendChild(container as never);
  const props = {
    groups: GROUPS,
    runs: [] as RunSummary[],
    collapsedGroups: {} as Record<string, boolean>,
    background: {} as Record<string, boolean>,
    logs: {} as Record<string, RunLog>,
    onToggleGroup: (file: string, collapsed: boolean) => calls.push(`group:${file}:${collapsed}`),
    onToggleBackground: (id: string, next: boolean) => calls.push(`background:${id}:${next}`),
    onRun: (id: string) => calls.push(`run:${id}`),
    onStop: (id: string) => calls.push(`stop:${id}`),
    onReadLog: (id: string) => calls.push(`read:${id}`),
    truncated: false,
    sources: ['Makefile', 'package.json'],
    ...overrides,
  };
  await act(async () => {
    render(h(CommandGroups, props), container);
  });
  await act(async () => {});
}

/** Every group header, in document order. */
function groupHeaders(): HTMLButtonElement[] {
  return [...container.querySelectorAll('section > button[aria-expanded]')] as HTMLButtonElement[];
}

/**
 * A header's own body, resolved through its `aria-controls`.
 *
 * `getElementById` rather than a `#id` selector: happy-dom's test env has no
 * global `CSS` object for `CSS.escape`, and the ids come from `useId` so they are
 * already selector-safe.
 */
function bodyOf(header: HTMLButtonElement): HTMLElement {
  const id = header.getAttribute('aria-controls');
  return document.getElementById(id!) as HTMLElement;
}

/** Whether any ancestor of `el` is `inert` — i.e. whether `el` is reachable. */
function hasInertAncestor(el: Element): boolean {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.hasAttribute('inert')) return true;
  }
  return false;
}

/** The group header whose text names `file`. */
function headerFor(file: string): HTMLButtonElement {
  return groupHeaders().find((b) => b.textContent?.includes(file)) as HTMLButtonElement;
}

/**
 * The command ROW disclosures: the `aria-expanded` buttons that are NOT group
 * headers. The two levels share the attribute, and a group header is the only
 * one that is a direct child of a `section`.
 */
function rowDisclosures(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button[aria-expanded]')].filter(
    (b) => b.parentElement?.tagName !== 'SECTION',
  ) as HTMLButtonElement[];
}

describe('CommandGroups', () => {
  test('renders one collapsible group per file, collapsed by default', async () => {
    await mount();

    const headers = groupHeaders();
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toContain('package.json');
    expect(headers[1].textContent).toContain('Makefile');
    // Absent from the map means COLLAPSED: the panel opens as a list of files,
    // not every command in the repository.
    expect(headers.every((h) => h.getAttribute('aria-expanded') === 'false')).toBe(true);
    for (const header of headers) {
      expect(bodyOf(header).getAttribute('data-expanded')).toBe('false');
      expect(bodyOf(header).hasAttribute('inert')).toBe(true);
    }
    // The row level is independent: a row still does not show output it was
    // never asked to keep.
    for (const row of rowDisclosures()) {
      expect(row.getAttribute('aria-expanded')).toBe('false');
    }
  });

  test('an explicitly expanded group shows its rows AND puts them back in the tab order', async () => {
    // Only the map's explicit `false` opens a group; the other file, absent
    // from it, stays closed — an expansion is per file.
    await mount({ collapsedGroups: { Makefile: false } });

    const makeHeader = headerFor('Makefile');
    expect(makeHeader.getAttribute('aria-expanded')).toBe('true');
    const makeBody = bodyOf(makeHeader);
    expect(makeBody.getAttribute('data-expanded')).toBe('true');
    expect(makeBody.hasAttribute('inert')).toBe(false);
    // And a row inside it is REACHABLE: no ancestor of its disclosure is inert.
    // (Its own body IS inert — that row is collapsed — which is a different fact
    // from whether the group hides it.)
    const row = rowDisclosures().find((b) => makeBody.contains(b))!;
    expect(hasInertAncestor(row)).toBe(false);

    // The OTHER group is untouched — a collapse is per file.
    const pkgHeader = headerFor('package.json');
    expect(pkgHeader.getAttribute('aria-expanded')).toBe('false');
    const pkgBody = bodyOf(pkgHeader);
    expect(pkgBody.getAttribute('data-expanded')).toBe('false');
    expect(pkgBody.hasAttribute('inert')).toBe(true);
    // In the COLLAPSED group the same question answers yes: the group is what
    // takes its rows out of the tab order.
    const hiddenRow = rowDisclosures().find((b) => pkgBody.contains(b))!;
    expect(hasInertAncestor(hiddenRow)).toBe(true);
  });

  test('the group toggle reports the FILE, so the caller can persist it per file', async () => {
    await mount();
    // The group starts collapsed, so the first click EXPANDS it.
    await act(async () => headerFor('Makefile').click());
    // Reporting an index would break the moment the scan reorders the list.
    expect(calls).toEqual(['group:Makefile:false']);
  });

  test('every group header carries aria-controls naming its own body', async () => {
    await mount();
    const headers = groupHeaders();
    const ids = headers.map((h) => h.getAttribute('aria-controls'));
    // Distinct ids: a shared one would make the second header point at the first
    // body, which is how a collapse appears to do nothing.
    expect(new Set(ids).size).toBe(headers.length);
    for (const id of ids) expect(document.getElementById(id!)).not.toBeNull();
  });

  test('a command row collapses independently of its group', async () => {
    // A run, so the row has something to open — without one its disclosure is
    // disabled, which is a different test. The group is explicitly opened, or
    // the row's controls are inert behind it.
    const dev = finishedRun('package.json#package:dev', 'run-dev');
    await mount({ runs: [dev], collapsedGroups: { 'package.json': false } });
    expect(headerFor('package.json').getAttribute('aria-expanded')).toBe('true');

    const rowDisclosure = rowDisclosures()[0];
    // A run OPENS the row, so it starts expanded and the click closes it.
    expect(rowDisclosure.getAttribute('aria-expanded')).toBe('true');
    await act(async () => rowDisclosure.click());
    expect(rowDisclosure.getAttribute('aria-expanded')).toBe('false');

    // The group above it stayed expanded, and its sibling row was untouched.
    expect(headerFor('package.json').getAttribute('aria-expanded')).toBe('true');
    const sibling = rowDisclosures()[1];
    expect(sibling.getAttribute('aria-expanded')).toBe('false');
    expect(sibling.disabled).toBe(true);
  });

  test('two rows keep their own output', async () => {
    const dev = finishedRun('package.json#package:dev', 'run-dev');
    const lint = finishedRun('package.json#package:lint', 'run-lint');
    const logs: Record<string, RunLog> = {
      'run-dev': { id: 'run-dev', status: 'exited', exitCode: 0, signal: null, bytes: 3, ringBytes: 3, truncated: false, text: 'DEV-OUTPUT' },
      'run-lint': { id: 'run-lint', status: 'exited', exitCode: 0, signal: null, bytes: 3, ringBytes: 3, truncated: false, text: 'LINT-OUTPUT' },
    };
    // No flags: a row opens because its run exists, and each shows its OWN log.
    await mount({ runs: [dev, lint], logs });

    const text = container.textContent ?? '';
    expect(text).toContain('DEV-OUTPUT');
    expect(text).toContain('LINT-OUTPUT');

    // Each log is inside its OWN row's body: the row that owns `run-dev` must not
    // contain the lint text. Addressed through the row's own aria-controls, since
    // a group body CONTAINS its rows' bodies.
    const [devRow, lintRow] = rowDisclosures();
    const devBody = bodyOf(devRow);
    const lintBody = bodyOf(lintRow);
    expect(devBody.textContent).toContain('DEV-OUTPUT');
    expect(devBody.textContent).not.toContain('LINT-OUTPUT');
    expect(lintBody.textContent).toContain('LINT-OUTPUT');
    expect(lintBody.textContent).not.toContain('DEV-OUTPUT');
  });

  test('an empty scan names the files it looked for', async () => {
    await mount({ groups: [] });
    const text = container.textContent ?? '';
    expect(text).toContain('No command file found');
    expect(text).toContain('package.json');
    expect(text).toContain('Makefile');
  });

  test('a truncated scan says so', async () => {
    await mount({ truncated: true });
    expect(container.textContent).toContain('Listing the first 2 command files');
  });
});

describe('latestRunByCommand', () => {
  test('takes the NEWEST run of each command', () => {
    const older = { ...finishedRun('a#make:x', 'old'), startedAt: 100 };
    const newer = { ...finishedRun('a#make:x', 'new'), startedAt: 200 };
    const other = { ...finishedRun('b#make:y', 'other'), startedAt: 150 };

    const latest = latestRunByCommand([older, other, newer]);

    expect(latest.get('a#make:x')?.id).toBe('new');
    expect(latest.get('b#make:y')?.id).toBe('other');
    // Keyed by COMMAND, not by file+label: two commands of one name in one file
    // would otherwise share an expansion.
    expect(latest.size).toBe(2);
  });

  test('an empty list answers an empty map', () => {
    expect(latestRunByCommand([]).size).toBe(0);
  });
});
