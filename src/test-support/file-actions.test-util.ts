/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared mount for `useFileActions`'s specs: the DOM globals Preact needs,
 * the stubbed `/api/fs/action` endpoint, and the click helpers the specs drive
 * the hook with.
 *
 * Extracted for the reason `file-explorer.test-util.ts` was: the row hook grew a
 * second family of specs (the clipboard), and a second copy of the mount is how
 * the two files drift into testing different setups. The dynamic imports below
 * are load-bearing — Preact binds its environment at evaluation time, so a
 * static import would capture the DOM-less one and every render would fail.
 */

import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { FileActions, useFileActions as UseFileActionsHook } from '@/client/hooks/workspace/file-tree-actions';
import { createStubClipboard, type StubClipboard, type StubClipboardOptions } from '@/test-support/file-clipboard.test-util';

/** What the stubbed endpoint was asked, and what it answers. */
export interface FileActionsServer {
  requests: Array<Record<string, string>>;
  /** The body every request answers with. */
  result: { success?: boolean; path?: string; error?: string; type?: string; data?: unknown };
}

export interface FileActionsHarness {
  /** The mounted hook's return value, or null before the first mount. */
  actions: () => FileActions | null;
  /** The stub clipboard the mounted row was handed. */
  clipboard: () => StubClipboard | null;
  /** Files the row asked the editor to open, in order. */
  opened: Array<{ path: string; name: string }>;
  /** How many times the row asked the panel to re-read the tree. */
  refreshes: () => number;
  /** A fresh server record; call before `mount`. */
  server: (result?: FileActionsServer['result']) => FileActionsServer;
  /** Serve `server` from the stubbed fetch. */
  stubFetch: (server: FileActionsServer) => void;
  /** Mount the hook for one row, optionally a folder and with clipboard options. */
  mount: (
    file: { path: string; name: string },
    options?: { diff?: { staged?: boolean; status?: string }; clipboard?: StubClipboardOptions },
  ) => Promise<void>;
  /** Let the request chain and the render it queues land. */
  settle: () => Promise<void>;
  /** Run one user interaction inside an `act` boundary. */
  step: (fn: () => void) => Promise<void>;
  /** Open the create dialog the way the context menu does. */
  openCreateDialog: () => Promise<void>;
  /** Type `name` into the open create dialog and submit it. */
  createNamed: (name: string) => Promise<void>;
  /** Install the DOM globals (call from `beforeAll`). */
  install: () => Promise<void>;
  /** Restore the runner's own globals (call from `afterAll`). */
  restore: () => void;
  /** Reset per-test state and give the spec a container (call from `beforeEach`). */
  reset: () => void;
  /** Tear the mounted tree down (call from `afterEach`). */
  cleanup: () => void;
}

export function createFileActionsHarness(): FileActionsHarness {
  let useFileActions: typeof UseFileActionsHook;
  let h: typeof PreactH;
  let render: typeof PreactRender;
  let act: typeof PreactAct;
  let mounted: FileActions | null = null;
  let mountedClipboard: StubClipboard | null = null;
  let container: HTMLElement;
  const opened: Array<{ path: string; name: string }> = [];
  let refreshes = 0;

  const domGlobals = (win: Window): Record<string, unknown> => ({
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
  });

  const installed: Record<string, unknown> = {};
  const displaced: Record<string, unknown> = {};
  /** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
  const nativeFetch = Bun.fetch;

  const harness: FileActionsHarness = {
    actions: () => mounted,
    clipboard: () => mountedClipboard,
    opened,
    refreshes: () => refreshes,
    server: (result = {}) => ({ requests: [], result }),
    stubFetch(server) {
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        const form = init?.body as FormData;
        const fields: Record<string, string> = {};
        for (const [key, value] of form.entries()) fields[key] = String(value);
        server.requests.push(fields);
        // The fetcher reads `text()` and parses it itself, so a stub that only
        // offers `json()` would leave every response looking empty — the request
        // would be recorded and the effect would never see an answer.
        const body = JSON.stringify(server.result);
        return { ok: true, text: async () => body };
      }) as unknown as typeof fetch;
    },
    async settle() {
      // Several `act` boundaries, each draining microtasks: the fetcher's chain
      // (`fetch` → `text()` → parse → `setData` → `setState`) resolves over
      // several turns, and a state update queued outside an `act` boundary is
      // only flushed when the next one arrives. No timers — the hook resolves on
      // promises, so waiting on the clock would only be guessing.
      for (let i = 0; i < 8; i++) {
        await act(async () => {
          for (let turn = 0; turn < 8; turn++) await Promise.resolve();
        });
      }
    },
    async step(fn) {
      await act(async () => {
        fn();
      });
    },
    async mount(file, options = {}) {
      const clipboard = createStubClipboard(options.clipboard ?? {});
      mountedClipboard = clipboard;
      const Probe = () => {
        mounted = useFileActions({
          // `basePath` is the ABSOLUTE listing root the server reported, and it
          // is what Copy Path anchors on — `rootPath` is the client's own
          // (possibly `~`-relative) workspace path, which is not resolvable
          // outside the panel.
          file: { ...file, basePath: '/root', rootPath: '/root', repo: '.' },
          diff: options.diff,
          onOpenFile: (target) => opened.push({ path: target.path, name: target.name }),
          onActionComplete: () => refreshes++,
          clipboard,
          isFolder: file.path === file.name,
        });
        return null;
      };
      await act(async () => {
        render(h(Probe, {}), container);
      });
    },
    async openCreateDialog() {
      await act(async () => {
        mounted?.handleAction('new_file');
      });
    },
    async createNamed(name) {
      await harness.openCreateDialog();
      await act(async () => {
        mounted?.setCreateName(name);
      });
      await act(async () => {
        mounted?.submitCreate({ preventDefault() {} } as never);
      });
      await harness.settle();
    },
    async install() {
      const win = new Window({ url: 'http://localhost' });
      for (const [key, value] of Object.entries(domGlobals(win))) {
        displaced[key] = (globalThis as Record<string, unknown>)[key];
        installed[key] = value;
        (globalThis as Record<string, unknown>)[key] = value;
      }
      ({ useFileActions } = await import('@/client/hooks/workspace/file-tree-actions'));
      ({ h, render } = await import('preact'));
      ({ act } = await import('preact/test-utils'));
    },
    restore() {
      globalThis.fetch = nativeFetch;
      for (const key of Object.keys(installed)) {
        if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
        else (globalThis as Record<string, unknown>)[key] = displaced[key];
      }
    },
    reset() {
      mounted = null;
      mountedClipboard = null;
      opened.length = 0;
      refreshes = 0;
      container = document.createElement('div');
      document.body.appendChild(container);
    },
    cleanup() {
      if (container) render(null, container);
      container?.remove();
    },
  };
  return harness;
}

/** Register the four lifecycle hooks a spec file needs, in the order bun runs them. */
export function useFileActionsHarness(harness: FileActionsHarness): void {
  beforeAll(() => harness.install());
  afterAll(() => harness.restore());
  beforeEach(() => harness.reset());
  afterEach(() => harness.cleanup());
}
