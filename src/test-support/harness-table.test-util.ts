/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mount and row factories `HarnessTable`'s specs drive the card with.
 *
 * Extracted because the spec file crossed the 350-line ceiling once the per-part
 * rows arrived, and because a second copy of the fixtures is exactly how two spec
 * files drift into asserting different shapes of the same wire row.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { HarnessTable } from '@/client/components/layout/session-sidebar/about-modal/HarnessTable';
import type { HarnessVersionRow } from '@/shared/types/harness-version';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { HarnessSummary } from '@/shared/types/harness';

/** Install the DOM Preact binds to at first evaluation. */
export function installHarnessTableDom(): void {
  installDomGlobals(new Window({ url: 'http://localhost' }));
}

export function restoreHarnessTableDom(): void {
  restoreDomGlobals();
}

export function summary(overrides: Partial<HarnessSummary> = {}): HarnessSummary {
  return { id: 'claude', label: 'claude', transport: 'acp', canLaunch: true, enabled: true, probe: null, ...overrides };
}

export function version(overrides: Partial<HarnessVersionRow> = {}): HarnessVersionRow {
  const base: HarnessVersionRow = {
    id: 'claude', label: 'claude', kind: 'npm', installed: true,
    agent: { version: null, latest: null, updateAvailable: false }, cli: null,
    updateAvailable: false, note: null, command: null,
  };
  const merged = { ...base, ...overrides };
  const agent = merged.agent ?? base.agent;
  const cli = merged.cli
    ? {
        name: merged.cli.name,
        version: merged.cli.version,
        latest: merged.cli.latest,
        updateAvailable: merged.cli.updateAvailable,
      }
    : null;
  return {
    ...merged,
    agent,
    cli,
    // The route answers the UNION of the parts, because one press moves every part
    // that is behind. A fixture stating only the parts still has to produce that.
    updateAvailable: overrides.updateAvailable ?? (agent.updateAvailable || Boolean(cli?.updateAvailable)),
  };
}

/** A CLI part: only the name and version are interesting to a layout case. */
export function cliPart(name: string, version: string, latest: string | null = null): NonNullable<HarnessVersionRow['cli']> {
  return { name, version, latest, updateAvailable: Boolean(latest) };
}

export function probed(): HarnessSummary['probe'] {
  return {
    harness: 'claude',
    capabilities: {
      configModel: 5, configThinking: 0, configMode: 0, modeValues: [],
      loadSession: true, listSessions: true, forkSession: false, deleteSession: false,
      resumeSession: true, closeSession: true, hasUsage: false, hasPlan: false, steerMode: null,
      agentVersion: '0.100.0',
    },
    models: [], thinking: [], modes: [], probedAt: Date.now(),
  };
}

export function mountHarnessTable(
  container: HTMLElement,
  harnesses: HarnessSummary[],
  versions: HarnessVersionRow[],
  onOpen?: (id: string) => void,
  onUpdate?: (id: string) => Promise<string | null>,
): HTMLElement {
  act(() =>
    render(
      h(HarnessTable, {
        harnesses,
        versions,
        onOpenHarness: onOpen ?? (() => {}),
        onUpdate: onUpdate ?? (async () => null),
        updating: null,
      }),
      container,
    ),
  );
  return container;
}

/** The rows, which are the direct children of the scrolling grid. */
export function harnessRows(el: HTMLElement): HTMLElement[] {
  const scroll = el.querySelector('.scrollbar-overlay-container');
  return scroll ? Array.from(scroll.children) as HTMLElement[] : [];
}
