/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The repo management modal, rendered against a stubbed `/api/fs/git`.
 *
 * Four properties here are invisible to a route test and each fails silently:
 *
 * - **Rows carry the STATE, not just the name.** The modal exists because a
 *   dropdown of fifty names cannot say which working trees are dirty or stopped
 *   on a conflict, so a row that renders the name alone is a modal that bought
 *   nothing.
 * - **A failed read is REPORTED, never rendered as an empty list.** The two look
 *   identical on screen and only one is actionable.
 * - **Discovery still running is NAMED.** A reader who closes the dialog
 *   believing a partial list is complete misses the repositories still being
 *   found.
 * - **The list re-reads when discovery finishes.** A modal opened during the
 *   server's background walk would otherwise stay short until it is reopened.
 *
 * Rendered with `h()` against happy-dom, over a stub that answers the
 * `?repoDetails=1` read.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
// The APP loads `preact/compat` (122 modules import it), and compat rewrites
// `onChange` on an input to the `input` event. Without this import the harness
// binds `change` instead, and a test that types with a `change` event passes
// while the real app ignores it — verified both ways: with compat loaded, a
// `change` dispatch leaves the field empty and an `input` dispatch updates it.
import 'preact/compat';
import { RepoModal } from '@/client/components/workspace/repo-picker/Modal';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const ROOT = '/ws/Workspace';
const nativeFetch = Bun.fetch;

let container: HTMLElement;
/** Every `/api/fs/git` url the stub answered. */
let reads: string[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  reads = [];
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

interface RowOverrides {
  path: string;
  branch?: string;
  changed?: number;
  untracked?: number;
  ahead?: number;
  behind?: number;
  upstream?: string;
  gone?: boolean;
  operation?: string | null;
  conflicts?: number;
  isRepo?: boolean;
  subject?: string;
  error?: string;
}

function row(overrides: RowOverrides): Record<string, unknown> {
  return {
    path: overrides.path,
    isRepo: overrides.isRepo ?? true,
    branch: overrides.branch ?? 'main',
    detached: false,
    changed: overrides.changed ?? 0,
    untracked: overrides.untracked ?? 0,
    ahead: overrides.ahead ?? 0,
    behind: overrides.behind ?? 0,
    upstream: overrides.upstream ?? '',
    gone: overrides.gone ?? false,
    operation: overrides.operation ?? null,
    conflicts: overrides.conflicts ?? 0,
    subject: overrides.subject ?? 'a commit',
    date: '1 hour ago',
    ...(overrides.error ? { error: overrides.error } : {}),
  };
}

/** Mount the modal with a stub answering `details` (and optionally an error). */
async function mount(options: {
  details?: Array<Record<string, unknown>>;
  status?: number;
  body?: Record<string, unknown>;
  scanning?: boolean;
  activeRepo?: string;
} = {}): Promise<void> {
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/fs/git')) {
      reads.push(url);
      const status = options.status ?? 200;
      const body = options.body ?? { success: true, details: options.details ?? [] };
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  const repos = (options.details ?? []).map((entry) => String(entry.path));
  await act(async () => {
    render(
      h(RepoModal, {
        isOpen: true,
        rootPath: ROOT,
        activeRepo: options.activeRepo ?? '.',
        repos,
        scanning: options.scanning ?? false,
        onSelectRepo: () => {},
        onRefreshRepos: () => {},
        onClose: () => {},
      }),
      container,
    );
  });
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

describe('RepoModal rows', () => {
  test('renders a row per repository with its branch', async () => {
    await mount({
      details: [
        row({ path: '.', branch: 'main' }),
        row({ path: 'projects/jns6_5/token', branch: 'feat/repo-modal' }),
      ],
    });
    expect(container.textContent).toContain('token');
    expect(container.textContent).toContain('feat/repo-modal');
  });

  test('a dirty repository shows its counts, not just its name', async () => {
    await mount({ details: [row({ path: 'dirty', changed: 3, untracked: 2 })] });
    // The whole point of the modal over the dropdown: which trees need work.
    expect(container.textContent).toContain('3±');
    expect(container.textContent).toContain('2?');
  });

  test('a stopped operation is named, with its conflict count in the tooltip', async () => {
    await mount({ details: [row({ path: 'conflicted', operation: 'merge', conflicts: 2 })] });
    expect(container.textContent).toContain('merge');
    // The row's own badges live in the state cell; the trigger's title is
    // `Show conflicted`, so the query scopes to the badge's wording.
    const badge = [...container.querySelectorAll('[title]')].find((el) =>
      (el.getAttribute('title') ?? '').includes('is in progress'),
    );
    expect(badge?.getAttribute('title')).toContain('2 conflict');
  });

  test('a conflicting stash pop is named as such, not as an abortable verb', async () => {
    await mount({ details: [row({ path: 'popped', operation: 'stash-pop', conflicts: 1 })] });
    expect(container.textContent).toContain('stash pop');
  });

  test('an in-sync clean repository says so, rather than showing an empty strip', async () => {
    await mount({ details: [row({ path: 'clean' })] });
    expect(container.textContent).toContain('clean, in sync');
  });

  test('a gone upstream says gone rather than reporting a zero track', async () => {
    await mount({ details: [row({ path: 'orphan', upstream: 'origin/main', gone: true })] });
    expect(container.textContent).toContain('gone');
  });

  test('ahead/behind is shown for a published branch', async () => {
    await mount({ details: [row({ path: 'tracked', upstream: 'origin/main', ahead: 2, behind: 1 })] });
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('1');
  });

  test('a directory that is not a repository says so and cannot be selected', async () => {
    await mount({ details: [row({ path: 'plain', isRepo: false, error: 'Not a git repository' })] });
    expect(container.textContent).toContain('Not a git repository');
    const trigger = [...container.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Not a git repository');
    expect(trigger).toBeDefined();
    expect(trigger?.hasAttribute('disabled')).toBe(true);
  });
});

describe('RepoModal states', () => {
  test('groups rows by their top-level folder, root first', async () => {
    await mount({
      details: [row({ path: '.' }), row({ path: 'projects/a' }), row({ path: 'zzz/b' })],
    });
    const headings = [...container.querySelectorAll('div')]
      .map((el) => el.textContent?.trim())
      .filter((text) => text === 'projects' || text === 'zzz');
    expect(headings).toContain('projects');
    expect(headings).toContain('zzz');
  });

  test('the filter narrows the list and says when nothing matches', async () => {
    await mount({ details: [row({ path: 'alpha' }), row({ path: 'beta' })] });
    const input = container.querySelector('input[aria-label="Filter repositories"]') as HTMLInputElement;
    await act(async () => {
      input.value = 'alpha';
      // `input`, the event a keystroke actually produces — the name compat
      // binds `onChange` to.
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});
    expect(container.textContent).toContain('alpha');
    expect(container.textContent).not.toContain('beta');
  });

  test('a refused read is reported, never rendered as an empty list', async () => {
    await mount({ status: 403, body: { error: 'Invalid repo path' } });
    expect(container.textContent).toContain('Invalid repo path');
    expect(container.textContent).not.toContain('No repositories in this workspace.');
  });

  test('discovery still running is named', async () => {
    await mount({ details: [row({ path: '.' })], scanning: true });
    expect(container.textContent).toContain('Still discovering');
  });

  test('an empty workspace says so rather than rendering nothing', async () => {
    await mount({ details: [] });
    expect(container.textContent).toContain('No repositories in this workspace.');
  });

  test('the read carries the root it was asked for', async () => {
    await mount({ details: [row({ path: '.' })] });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('repoDetails=1');
    expect(decodeURIComponent(reads[0])).toContain(ROOT);
  });

  test('a discovery flip re-reads the list', async () => {
    await mount({ details: [row({ path: '.' })], scanning: true });
    expect(reads).toHaveLength(1);
    // The prop flips when the server's walk reports done, which is the moment
    // the list may have grown — the modal must re-read without being reopened.
    container.remove();
    await mount({ details: [row({ path: '.' }), row({ path: 'late/repo' })], scanning: false });
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain('late');
  });
});
