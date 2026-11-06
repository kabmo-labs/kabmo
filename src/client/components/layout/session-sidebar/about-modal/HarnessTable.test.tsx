/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The About card's one row per harness — state, version and action together.
 *
 * The card used to draw the same fourteen agents TWICE: a status grid, and below
 * it a versions table. That is why it grew to 980px tall, and why a reader asking
 * "is this working, and is it current?" read the same names twice to answer two
 * halves of one question. These cases pin the merge:
 *
 *  - one row per harness, carrying BOTH the state and the version;
 *  - the action is chosen by what the harness can do — an `npm` update is a
 *    button, a self-updating CLI is its own copyable command, a vendor-managed
 *    one is the command Kabmo will not run;
 *  - an adapter and the CLI under it are TWO number lines, each with its own move;
 *  - a row with no version shows a dash, never a fabricated number;
 *  - the built-in transport is not a row.
 *
 * The fixtures live in `@/test-support/harness-table.test-util`, so a second spec
 * of the same rows cannot drift into a different wire shape.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { render } from 'preact';
import { act } from 'preact/test-utils';

import { harnessCategoryFor } from '@/client/components/layout/session-sidebar/about-modal/HarnessTable';
import {
  cliPart,
  harnessRows as rows,
  installHarnessTableDom,
  mountHarnessTable as mountTo,
  probed,
  restoreHarnessTableDom,
  summary,
  version,
} from '@/test-support/harness-table.test-util';

let container: HTMLElement;

beforeAll(() => {
  installHarnessTableDom();
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => {
  restoreHarnessTableDom();
});

/** Mount into this file's container. */
function mount(
  harnesses: Parameters<typeof mountTo>[1],
  versions: Parameters<typeof mountTo>[2],
  onOpen?: Parameters<typeof mountTo>[3],
  onUpdate?: Parameters<typeof mountTo>[4],
): HTMLElement {
  return mountTo(container, harnesses, versions, onOpen, onUpdate);
}

describe('About harness table', () => {
  test('ONE row per harness carries state AND version', () => {
    const el = mount(
      [summary({ probe: probed() })],
      [version({ agent: { version: '0.100.0', latest: '0.101.0', updateAvailable: true } })],
    );
    expect(rows(el)).toHaveLength(1);
    const text = (rows(el)[0].textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('claude');
    expect(text).toContain('ready');
    expect(text).toContain('0.100.0');
    // The action is an icon now, so the row's TEXT no longer carries the word —
    // the button is found by its accessible name instead.
    expect(Array.from(rows(el)[0].querySelectorAll('button')).some(
      (b) => b.getAttribute('aria-label')?.startsWith('Update claude'),
    )).toBe(true);
  });

  test('the agent is drawn once, not in two lists', () => {
    // The defect being fixed: fourteen agents in a grid AND fourteen in a table.
    const el = mount(
      [summary({ probe: probed() })],
      [version({ agent: { version: '0.100.0', latest: '0.101.0', updateAvailable: true } })],
    );
    const occurrences = (el.textContent ?? '').match(/claude/g) ?? [];
    // The name, its aria-label and the title attribute aside, the VISIBLE label
    // must appear exactly once.
    expect(occurrences.length).toBeLessThanOrEqual(3);
  });

  test('the action is an ICON, and only when a newer version exists', () => {
    // A permanent "Update" button claims work that does not exist, and the label
    // is spent on every row. The meaning moves to `aria-label` / `title`, so it is
    // still announced without being drawn.
    const withUpdate = mount(
      [summary()],
      [version({ agent: { version: '1.0.0', latest: '1.0.1', updateAvailable: true }, kind: 'npm' })],
    );
    const action = Array.from(withUpdate.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label')?.startsWith('Update claude'),
    );
    expect(action).toBeDefined();
    expect(action?.textContent?.trim()).toBe('');
    expect(action?.getAttribute('aria-label')).toContain('1.0.1');

    const current = mount([summary()], [version({ agent: { version: '1.0.1', latest: '1.0.1', updateAvailable: false }, kind: 'npm' })]);
    expect(Array.from(current.querySelectorAll('button')).some(
      (b) => b.getAttribute('aria-label')?.startsWith('Update claude'),
    )).toBe(false);
  });

  test('a self-updating CLI offers no action at all', () => {
    // Kabmo cannot READ a self-updating CLI's latest version, so it cannot claim
    // there is one to install.
    const el = mount(
      [summary({ id: 'opencode', label: 'opencode' })],
      [version({ id: 'opencode', label: 'opencode', kind: 'self', command: 'opencode upgrade' })],
    );
    expect(el.textContent).not.toContain('opencode upgrade');
    expect(Array.from(el.querySelectorAll('button')).some((b) => /Update/.test(b.getAttribute('aria-label') ?? ''))).toBe(false);
  });

  test('an adapter row leads with the CLI version, and keeps the adapter\'s beside it', () => {
    // `claude --version` is 2.1.318 while the ACP adapter reports 0.101.0. A row
    // showing only the adapter read as "why is my 2.x showing 0.100?".
    const el = mount(
      [summary()],
      [version({
        kind: 'npm',
        agent: { version: '0.101.0', latest: null, updateAvailable: false },
        cli: cliPart('Claude Code', '2.1.318'),
      })],
    );
    const text = (rows(el)[0].textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('2.1.318');
    expect(text).toContain('adapter 0.101.0');
    // The arrow's target is the ADAPTER's package, so it must not appear beside
    // the CLI's number: `2.1.318 → 0.101.0` compares two different products.
    expect(text).not.toContain('2.1.318→');
  });

  test('the INSTALLED version is shown, with an arrow only when there is a newer one', () => {
    // The reported shape: the row must state what is installed, and the arrow is
    // the claim that there is somewhere to move.
    const moving = mount(
      [summary()],
      [version({ agent: { version: '0.100.0', latest: '0.101.0', updateAvailable: true }, kind: 'npm' })],
    );
    const movingText = (rows(moving)[0].textContent ?? '').replace(/\s+/g, ' ');
    expect(movingText).toContain('0.100.0');
    expect(movingText).toContain('→');
    expect(movingText).toContain('0.101.0');

    const current = mount([summary()], [version({ agent: { version: '0.101.0', latest: '0.101.0', updateAvailable: false }, kind: 'npm' })]);
    const currentText = (rows(current)[0].textContent ?? '').replace(/\s+/g, ' ');
    expect(currentText).toContain('0.101.0');
    // No newer version, so no direction to point at.
    expect(currentText).not.toContain('→');
  });

  test('a row with no version shows a dash, never a number', () => {
    const el = mount([summary()], [version()]);
    const text = (rows(el)[0].textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('—');
    expect(text).not.toMatch(/\d+\.\d+\.\d+/);
  });

  test('the action icon is a DOWNLOAD, and only the part that is behind grows an arrow', () => {
    // The icon says what the press does. It used to be `ArrowUpRight`, which reads
    // as "open this elsewhere" beside a version.
    const el = mount(
      [summary()],
      [version({
        agent: { version: '0.101.0', latest: '0.102.0', updateAvailable: true },
        cli: cliPart('Claude Code', '2.1.318', '2.1.400'),
        updateAvailable: true,
      })],
    );
    const action = Array.from(el.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label')?.startsWith('Update claude'),
    );
    expect(action?.querySelector('svg')).not.toBeNull();
    expect(action?.querySelector('.lucide-download')).not.toBeNull();
    expect(action?.querySelector('.lucide-arrow-up-right')).toBeNull();
    // BOTH parts move, so the accessible name says both — the number alone would
    // hide a second install behind one press.
    expect(action?.getAttribute('aria-label')).toContain('adapter 0.102.0');
    expect(action?.getAttribute('aria-label')).toContain('Claude Code 2.1.400');

    const row = rows(el)[0];
    const lines = Array.from(row.children[1].querySelectorAll(':scope > span'));
    // The CLI is behind on ITS line, the adapter on its own: an arrow joining
    // `2.1.318` with the adapter's 0.102.0 would compare two products.
    expect(lines[0].textContent ?? '').toContain('2.1.318→2.1.400');
    expect(lines[1].textContent ?? '').toContain('adapter 0.101.0 → 0.102.0');
  });

  test('a current adapter under a stale CLI offers the action for the CLI alone', () => {
    // The reported gap: the row said "up to date" because the ADAPTER was, while
    // `claude update` still had somewhere to go.
    const el = mount(
      [summary()],
      [version({
        agent: { version: '0.101.0', latest: '0.101.0', updateAvailable: false },
        cli: cliPart('Claude Code', '2.1.318', '2.1.400'),
        updateAvailable: true,
      })],
    );
    const action = Array.from(el.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label')?.startsWith('Update claude'),
    );
    expect(action?.getAttribute('aria-label')).toBe('Update claude to Claude Code 2.1.400');
  });

  test('the built-in transport is not a row and not counted', () => {
    const el = mount(
      [summary({ id: 'omp-rpc', label: 'omp', transport: 'rpc', builtIn: true, probe: probed() }), summary()],
      [version()],
    );
    expect(rows(el)).toHaveLength(1);
    expect(el.textContent).toContain('0/1 ready');
  });

  test('the name opens that harness, and the footer opens the overview', () => {
    const opened: string[] = [];
    const el = mount([summary()], [version()], (id) => opened.push(id));
    const nameButton = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('claude'));
    act(() => nameButton?.click());
    const footer = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Open Settings'));
    act(() => footer?.click());
    expect(opened).toEqual(['claude', '']);
    expect(harnessCategoryFor('claude')).toBe('harness:claude');
    expect(harnessCategoryFor('')).toBe('harness-index');
  });

  test('a harness that is NOT installed offers no action at all', () => {
    // Measured: an Update button appeared for agents that were never installed,
    // and pressing it could only produce a `not found` from npm.
    const el = mount(
      [summary({ id: 'cursor', label: 'cursor', canLaunch: false, unavailable: '`cursor-agent` is not installed' })],
      [version({ id: 'cursor', label: 'cursor', installed: false, kind: null })],
    );
    const text = (rows(el)[0].textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('not installed');
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Update')).toBe(false);
    expect(text).not.toContain('cursor-agent update');
  });

  test('name and version share LINE ONE, state and the adapter share LINE TWO', () => {
    // The rows are two lines tall, and each cell must lay out the same two line
    // boxes or the number drifts off the name it belongs to. Measured before this
    // was pinned: the version sat 7.5px below the name (cells centered
    // independently) and the arrow + newer number each took a flex row of their
    // own, so `0.100.0 → 0.101.0` read as three stacked fragments.
    const el = mount(
      [summary({ probe: probed() })],
      [version({
        kind: 'npm',
        agent: { version: '0.101.0', latest: '0.102.0', updateAvailable: true },
        cli: cliPart('Claude Code', '2.1.318'),
      })],
    );
    const cells = rows(el)[0].children;
    const [nameCell, versionCell] = cells;

    // The name cell: the glyph, then a column of exactly two line boxes — the
    // label row and the state row.
    const nameColumn = nameCell.lastElementChild!;
    expect(nameColumn.children).toHaveLength(2);
    expect(nameColumn.children[0].textContent).toContain('claude');
    expect(nameColumn.children[1].textContent).toContain('ready');

    // The version cell: exactly TWO line boxes — the number line and the
    // adapter line. A third child would mean the arrow broke onto its own row.
    const lines = versionCell.querySelectorAll(':scope > span');
    expect(lines).toHaveLength(2);

    // Line one carries the whole `current → latest` statement.
    const numberLine = lines[0].textContent ?? '';
    expect(numberLine).toContain('2.1.318');
    expect(lines[1].textContent ?? '').toContain('adapter 0.101.0');
    expect(lines[1].textContent ?? '').toContain('0.102.0');

    // And a row with no adapter keeps ONE line, so the number still owns the
    // first row instead of being pushed down by an empty box.
    const plain = mount([summary()], [version({ agent: { version: '0.100.0', latest: '0.101.0', updateAvailable: true } })]);
    const plainLines = rows(plain)[0].children[1].querySelectorAll(':scope > span');
    expect(plainLines).toHaveLength(1);
    expect(plainLines[0].textContent).toContain('0.100.0');
    expect(plainLines[0].textContent).toContain('→');
    expect(plainLines[0].textContent).toContain('0.101.0');
  });

  test('the header says how many could move', () => {
    const el = mount(
      [summary({ id: 'a', label: 'a' }), summary({ id: 'b', label: 'b' })],
      [version({ agent: { version: '1.0.0', latest: '2.0.0', updateAvailable: true }, id: 'a' }), version({ id: 'b' })],
    );
    expect(el.textContent).toContain('1 update');
  });
});
