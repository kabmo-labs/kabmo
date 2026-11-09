/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's test harness: a fake disk, a real realtime server, and the
 * click helpers the panel's specs drive it with.
 *
 * Extracted because several spec files exercise the same panel, and each was
 * carrying its own copy of the mount, the HTTP stub and the helpers. The HTTP
 * stub is a real directory model (see `file-explorer-disk.test-util`): specs
 * mutate `disk` between reads, which is what makes a refresh assertion fail on a
 * panel that answered from its children cache instead of from the server.
 */

import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { fsTopic, reposTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import type { GitStatusPayload } from '@/server/lib/fs/git-status-read';
import { diskHas, entriesOf, moveOnDisk, writeToDisk, type Disk } from '@/test-support/file-explorer-disk.test-util';
import { fireDrag, rowElementFor, settleDrag, transferOf } from '@/test-support/file-explorer-drag.test-util';
import { renderFileExplorer } from '@/test-support/file-explorer-render.test-util';

export type { Disk } from '@/test-support/file-explorer-disk.test-util';

export const ROOT = '/ws';
export const SESSION = 'new-files-panel';
const TOPIC = fsTopic(`${ROOT}\u0000.`);
const GIT_STATUS: GitStatusPayload = { changes: [], branch: 'main', branches: [], remoteBranches: [], isRepo: true };

export interface FileExplorerHarness {
  /** The fake directory model the spec mutates between reads. */
  disk: Disk;
  /** Every `/api/fs/dir` request, in order, as `path` (`.` for the root). */
  dirReads: string[];
  /** Paths whose NEXT read answers a non-JSON 500 (a transport failure). */
  failNext: Set<string>;
  /** Every create / rename / transfer the panel posted, as its form fields. */
  createRequests: Array<Record<string, string>>;
  renameRequests: Array<Record<string, string>>;
  transferRequests: Array<Record<string, string>>;
  /** Files the panel asked the editor to open, in order. */
  openedFiles: Array<{ path: string; name: string }>;
  container: HTMLElement;
  server: RealtimeTestServer | null;
  /** Reset the disk state, mount the panel, and settle its first reads. */
  mount: () => Promise<void>;
  /**
   * Re-render the mounted panel with a different `active` flag.
   *
   * The desktop layout keeps a view mounted and hides it with CSS when the
   * right column is collapsed or another view is on screen, so this is how a
   * spec reaches "the user opened the panel again" without a remount.
   */
  setActive: (active: boolean) => Promise<void>;
  /** Tear the panel down and stop the listener. */
  unmount: () => void;
  clickRow: (name: string) => Promise<void>;
  /** Right-click a row by name (the ROW context menu, never the root one). */
  rightClickRow: (name: string) => Promise<void>;
  clickRefresh: () => Promise<void>;
  /** The panel's scrolling background — what a right-click on empty space hits. */
  panelBackground: () => HTMLElement;
  /** Right-click the background, leaving its menu open. */
  openMenuOnBackground: () => Promise<void>;
  /** Right-click the background and click its New File / New Folder row. */
  openRootNewFile: () => Promise<void>;
  openRootNewFolder: () => Promise<void>;
  /** Type a name into the open create dialog and submit it. */
  submitNewFile: (name: string) => Promise<void>;
  /** Type a destination into the open rename dialog and submit it. */
  submitRename: (path: string) => Promise<void>;
  renameInput: () => HTMLInputElement | null;
  /** Every row name the tree is currently drawing, in order. */
  visibleNames: () => string[];
  /** The whole rendered document's text — a dialog's inline refusal lives here. */
  documentText: () => string;
  /** Every button label currently in the document — the menu assertions read it. */
  buttonLabels: () => string[];
  /** Click a button by its exact label (a context-menu row, a dialog action). */
  clickMenuRow: (label: string) => Promise<void>;
  /** Drag `from` onto `to` (or the background when null): dragstart, dragover, drop. */
  dragRow: (from: string, to: string | null) => Promise<void>;
  /**
   * Hover `over` with `from` in flight and stop there.
   *
   * A drop is not always the whole story: a hovered collapsed chain UNFOLDS, and
   * the level it exposed is a row only once that has happened — which is what a
   * drag to `dev/src/main` inside the row labelled `dev/src/main/code` needs.
   */
  hoverRow: (from: string, over: string) => Promise<void>;
  /** Let go of a drag started by `hoverRow`, without dropping it anywhere. */
  releaseDrag: (from: string) => Promise<void>;
  /** Start a drag and leave it in flight over nothing. */
  startDrag: (from: string) => Promise<void>;
  /** Drop the drag in flight on the panel background — the listing root. */
  dropOnBackground: () => Promise<void>;
  /** The element carrying a row's drag handlers, by the row's visible text. */
  rowFor: (name: string) => HTMLElement;
  /** DOM globals for the whole file (call from beforeAll / afterAll). */
  install: () => void;
  restore: () => void;
}

export function createFileExplorerHarness(): FileExplorerHarness {
  /** The transfer of a drag left in flight by `startDrag`. */
  let inFlight = transferOf();
  const harness: FileExplorerHarness = {
    disk: {},
    dirReads: [],
    failNext: new Set(),
    createRequests: [],
    renameRequests: [],
    transferRequests: [],
    openedFiles: [],
    container: null as unknown as HTMLElement,
    server: null,
    install() {
      installDomGlobals(new Window({ url: 'http://localhost' }));
    },
    restore() {
      (globalThis as unknown as Record<string, unknown>).fetch = Bun.fetch;
      restoreDomGlobals();
    },
    unmount() {
      if (harness.container) {
        render(null, harness.container);
        harness.container.remove();
      }
      resetRealtimeClient();
      harness.server?.stop();
      harness.server = null;
    },
    async mount() {
      harness.failNext = new Set();
      harness.createRequests = [];
      harness.renameRequests = [];
      harness.transferRequests = [];
      harness.openedFiles = [];
      // A fresh mount is a fresh session: the panel's per-session UI state
      // (the clipboard among it) is otherwise carried over from the previous
      // spec, and a cut taken in one test would offer Paste in the next.
      forgetSession(SESSION);
      harness.server = await startRealtimeTestServer(new Map<string, TopicResolver>([
        // The root listing rides the topic; the panel's own reads go over HTTP.
        [TOPIC, async () => ({ files: entriesOf(harness.disk, '.'), root: ROOT })],
        [reposTopic(ROOT), async () => ({ repos: ['.'], reposPending: false })],
      ]));
      const win = new Window({ url: `http://127.0.0.1:${harness.server.port}` });
      installDomGlobals(win);
      const target = globalThis as unknown as Record<string, unknown>;
      target.WebSocket = pristineWebSocket;
      target.fetch = async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
        if (url.includes('/state')) return json({ sessionId: SESSION, state: {} });
        if (url.includes('reposOnly')) return json({ repos: ['.'], reposPending: false });
        if (url.includes('/api/fs/git')) return json(GIT_STATUS);
        if (url.includes('/api/fs/action')) {
          const form = init?.body as FormData;
          const fields: Record<string, string> = {};
          for (const [key, value] of form.entries()) fields[key] = String(value);
          // A transfer (duplicate/paste) is recorded separately from a create:
          // the two answer different shapes and the assertions read them apart.
          if (fields.actionType === 'duplicate' || fields.actionType === 'paste') {
            harness.transferRequests.push(fields);
            return json({ success: true, path: `moved-${fields.actionType}` });
          }
          if (fields.actionType === 'rename') {
            harness.renameRequests.push(fields);
            // The real route refuses an existing destination; the disk is the
            // authority here too, so a refusal spec drives the same path.
            const destination = fields.newPath;
            if (destination !== fields.path && diskHas(harness.disk, destination)) {
              return json({ error: `${destination} already exists` }, 409);
            }
            moveOnDisk(harness.disk, fields.path, destination);
            return json({ success: true, path: destination, previousPath: fields.path });
          }
          harness.createRequests.push(fields);
          // The create route answers with the new entry's path relative to the
          // LISTED root; the folder is `.` for the panel's own background menu.
          // `kind` rides back because the tree draws a folder differently from a
          // file, and the request is the only place it is stated.
          const kind = fields.kind === 'folder' ? 'folder' : 'file';
          const rel = writeToDisk(harness.disk, fields.path, fields.name, kind);
          return json({ success: true, kind, path: rel });
        }
        if (url.includes('/api/fs/dir')) {
          const path = new URL(url, 'http://127.0.0.1').searchParams.get('path') ?? '.';
          harness.dirReads.push(path);
          // A transport failure: the folder is fine, the answer is not JSON.
          if (harness.failNext.delete(path)) return new Response('gateway blew up', { status: 500 });
          const dir = harness.disk[path];
          if (!dir) return json({ error: 'Failed to read directory' });
          return json({ files: entriesOf(harness.disk, path), root: ROOT, path });
        }
        return json({});
      };

      harness.container = document.createElement('div');
      document.body.appendChild(harness.container);
      await renderPanel(true);
    },
    async setActive(active) {
      await renderPanel(active);
    },
    async clickRow(name) {
      // The deepest element whose own text is exactly `name`: `TreeItem` wraps
      // its row in a div that reads the same, and dispatching on the wrapper
      // would bubble past the row's handler to the panel background.
      const rows = [...harness.container.querySelectorAll('div')].filter((el) => el.textContent?.trim() === name);
      const row = rows[rows.length - 1];
      if (!row) throw new Error(`no row named ${name}`);
      await act(async () => {
        row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      });
      for (let i = 0; i < 10; i += 1) await act(async () => {});
    },
    async rightClickRow(name) {
      const matches = [...harness.container.querySelectorAll('div')].filter((el) => el.textContent?.trim() === name);
      const row = matches[matches.length - 1];
      if (!row) throw new Error(`no row named ${name}`);
      await act(async () => {
        row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
      });
      for (let i = 0; i < 5; i += 1) await act(async () => {});
    },
    async clickRefresh() {
      const button = [...harness.container.querySelectorAll('button')].find((el) => el.getAttribute('title') === 'Refresh');
      if (!button) throw new Error('no Refresh button');
      await act(async () => {
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      });
      for (let i = 0; i < 20; i += 1) await act(async () => {});
    },
    panelBackground() {
      const scroller = harness.container.querySelector('.scrollbar-overlay-container');
      if (!scroller) throw new Error('no panel background');
      return scroller as HTMLElement;
    },
    async openMenuOnBackground() {
      await act(async () => {
        harness.panelBackground().dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
      });
      for (let i = 0; i < 5; i += 1) await act(async () => {});
    },
    async openRootNewFile() {
      await harness.openMenuOnBackground();
      await harness.clickMenuRow('New File');
    },
    async openRootNewFolder() {
      await harness.openMenuOnBackground();
      await harness.clickMenuRow('New Folder');
    },
    async submitRename(path) {
      const input = harness.renameInput();
      if (!input) throw new Error('no rename dialog');
      await act(async () => {
        input.value = path;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      for (let i = 0; i < 5; i += 1) await act(async () => {});
      await harness.clickMenuRow('Rename');
      for (let i = 0; i < 20; i += 1) await act(async () => {});
    },
    renameInput() {
      return document.querySelector('input[aria-label^="Rename "]') as HTMLInputElement | null;
    },
    visibleNames() {
      // A row's name span is the leaf that carries it; the row wrapper reads the
      // same text, so the SPAN is what is collected (one per row).
      return [...harness.container.querySelectorAll('span')]
        .map((el) => el.textContent?.trim() ?? '')
        .filter((text) => text.length > 0);
    },
    documentText() {
      return document.body.textContent ?? '';
    },
    async submitNewFile(name) {
      const input = document.querySelector('input[aria-label^="New "]') as HTMLInputElement | null;
      if (!input) throw new Error('no create dialog');
      await act(async () => {
        input.value = name;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      for (let i = 0; i < 5; i += 1) await act(async () => {});
      await harness.clickMenuRow('Create');
      for (let i = 0; i < 20; i += 1) await act(async () => {});
    },
    buttonLabels() {
      return [...document.querySelectorAll('button')].map((el) => el.textContent?.trim() ?? '');
    },
    async clickMenuRow(label: string) {
      const row = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
      if (!row) throw new Error(`no ${label} menu row`);
      await act(async () => {
        row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      });
      for (let i = 0; i < 5; i += 1) await act(async () => {});
    },
    async dragRow(from, to) {
      const source = harness.rowFor(from);
      const target = to === null ? harness.panelBackground() : harness.rowFor(to);
      const transfer = transferOf();
      await settleDrag(() => fireDrag(source, 'dragstart', transfer), 3);
      await settleDrag(() => fireDrag(target, 'dragover', transfer), 3);
      await settleDrag(() => fireDrag(target, 'drop', transfer), 0);
      await settleDrag(() => fireDrag(source, 'dragend', transfer), 20);
    },
    async hoverRow(from, over) {
      inFlight = transferOf();
      await settleDrag(() => fireDrag(harness.rowFor(from), 'dragstart', inFlight), 3);
      await settleDrag(() => fireDrag(harness.rowFor(over), 'dragover', inFlight), 5);
    },
    async releaseDrag(from) {
      await settleDrag(() => fireDrag(harness.rowFor(from), 'dragend', inFlight), 20);
    },
    async startDrag(from) {
      inFlight = transferOf();
      await settleDrag(() => fireDrag(harness.rowFor(from), 'dragstart', inFlight), 3);
    },
    async dropOnBackground() {
      const background = harness.panelBackground();
      await settleDrag(() => fireDrag(background, 'dragenter', inFlight), 3);
      await settleDrag(() => fireDrag(background, 'dragover', inFlight), 3);
      await settleDrag(() => fireDrag(background, 'drop', inFlight), 20);
    },
    rowFor(name: string) {
      return rowElementFor(harness.container, name);
    },
  };
  /** Draw (or re-draw) the panel with the given visibility, then settle its reads. */
  async function renderPanel(active: boolean) {
    await renderFileExplorer(harness.container, SESSION, ROOT, active, (file) =>
      harness.openedFiles.push({ path: file.path, name: file.name }),
    );
  }
  return harness;
}
