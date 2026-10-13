/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's test harness: a fake disk, a real realtime server, and the
 * click helpers the panel's specs drive it with.
 *
 * Extracted because TWO spec files exercise the same panel — the listing
 * behaviours and the root context menu — and each was carrying its own copy of
 * the mount, the HTTP stub and the click helpers. A second copy is how the two
 * files drift into testing different setups.
 *
 * The HTTP stub is a real directory model: specs mutate `disk` between reads,
 * which is what makes a refresh assertion fail on a panel that answered from
 * its children cache instead of from the server.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { FileExplorer } from '@/client/components/workspace/file-explorer/index';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { fsTopic, reposTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import type { GitStatusPayload } from '@/server/lib/fs/git-status-read';

export const ROOT = '/ws';
export const SESSION = 'new-files-panel';
const TOPIC = fsTopic(`${ROOT}\u0000.`);

/** The fake disk: `path -> child -> (null for a folder, 'file' for a file)`. */
export type Disk = Record<string, Record<string, null | 'file'> | undefined>;

const GIT_STATUS: GitStatusPayload = { changes: [], branch: 'main', branches: [], remoteBranches: [] };

export interface FileExplorerHarness {
  /** The fake directory model the spec mutates between reads. */
  disk: Disk;
  /** Every `/api/fs/dir` request, in order, as `path` (`.` for the root). */
  dirReads: string[];
  /** Paths whose NEXT read answers a non-JSON 500 (a transport failure). */
  failNext: Set<string>;
  /** Every create the panel posted, as its form fields. */
  createRequests: Array<Record<string, string>>;
  /** Every duplicate/paste the panel posted, as its form fields. */
  transferRequests: Array<Record<string, string>>;
  /** Files the panel asked the editor to open, in order. */
  openedFiles: Array<{ path: string; name: string }>;
  container: HTMLElement;
  server: RealtimeTestServer | null;
  /** Reset the disk state, mount the panel, and settle its first reads. */
  mount: () => Promise<void>;
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
  /** Right-click the background and click the menu's New File row. */
  openRootNewFile: () => Promise<void>;
  /** Type a name into the open create dialog and submit it. */
  submitNewFile: (name: string) => Promise<void>;
  /** Every button label currently in the document — the menu assertions read it. */
  buttonLabels: () => string[];
  /** Click a button by its exact label (a context-menu row, a dialog action). */
  clickMenuRow: (label: string) => Promise<void>;
  /**
   * Drag the row named `from` onto the row named `to`, or onto the panel
   * background when `to` is null — the whole gesture, in the order the browser
   * raises it: dragstart on the source, dragover on the target (where a target
   * refuses), then drop.
   */
  dragRow: (from: string, to: string | null) => Promise<void>;
  /** Install the DOM globals (call from `beforeAll`). */
  install: () => void;
  /** Restore the runner's own globals (call from `afterAll`). */
  restore: () => void;
}

/** One directory's entries as the server emits them: folders with `children: null`. */
function entriesOf(disk: Disk, path: string): unknown[] {
  const dir = disk[path] ?? {};
  return Object.keys(dir).map((child) => {
    const rel = path === '.' ? child : `${path}/${child}`;
    return dir[child] === null
      ? { id: rel, name: child, type: 'folder', path: rel, children: null, ignored: false }
      : { id: rel, name: child, type: 'file', path: rel, ignored: false };
  });
}

export function createFileExplorerHarness(): FileExplorerHarness {
  const harness: FileExplorerHarness = {
    disk: {},
    dirReads: [],
    failNext: new Set(),
    createRequests: [],
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
        const json = (body: unknown) => new Response(JSON.stringify(body), {
          status: 200,
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
          harness.createRequests.push(fields);
          // The create route answers with the new file's path relative to the
          // LISTED root; the folder is `.` for the panel's own background menu.
          const rel = fields.path === '.' ? fields.name : `${fields.path}/${fields.name}`;
          return json({ success: true, path: rel });
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
      await act(async () => {
        render(
          h(SessionStateProvider, {
            sessionId: SESSION,
            children: h(FileExplorer, {
              rootPath: ROOT,
              enabled: true,
              onOpenFile: (file: { path: string; name: string }) =>
                harness.openedFiles.push({ path: file.path, name: file.name }),
            }),
          }),
          harness.container,
        );
      });
      for (let i = 0; i < 10; i += 1) await act(async () => {});
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
    async submitNewFile(name) {
      const input = document.querySelector('input[aria-label="New file name"]') as HTMLInputElement | null;
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
      const rowFor = (name: string) => {
        // The row itself is the element carrying the drag handlers: the deepest
        // `div` whose own text is exactly the name is the row's inner content,
        // and its parent is the handler-carrying row.
        const matches = [...harness.container.querySelectorAll('div')].filter((el) => el.textContent?.trim() === name);
        const inner = matches[matches.length - 1];
        if (!inner) throw new Error(`no row named ${name}`);
        return (inner.closest('[draggable]') as HTMLElement | null) ?? (inner.parentElement as HTMLElement);
      };
      const source = rowFor(from);
      const target = to === null ? harness.panelBackground() : rowFor(to);
      // A real `DataTransfer` does not exist in happy-dom, and the handlers read
      // only `setData`/`dropEffect`, so a minimal stand-in is what the event
      // carries. Without it `handleDragStart` would throw on `setData`.
      const transfer = {
        data: {} as Record<string, string>,
        effectAllowed: '',
        dropEffect: '',
        types: [] as string[],
        setData(type: string, value: string) {
          this.data[type] = value;
        },
        getData(type: string) {
          return this.data[type] ?? '';
        },
      };
      const fire = (element: HTMLElement, type: string) => {
        const event = new window.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        element.dispatchEvent(event);
        return event;
      };
      await act(async () => {
        fire(source, 'dragstart');
      });
      for (let i = 0; i < 3; i += 1) await act(async () => {});
      await act(async () => {
        fire(target, 'dragover');
      });
      for (let i = 0; i < 3; i += 1) await act(async () => {});
      await act(async () => {
        fire(target, 'drop');
      });
      await act(async () => {
        fire(source, 'dragend');
      });
      for (let i = 0; i < 20; i += 1) await act(async () => {});
    },
  };
  return harness;
}
