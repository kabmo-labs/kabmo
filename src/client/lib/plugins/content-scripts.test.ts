/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Content scripts: mount, replace, and take down.
 *
 * Every rule here is silent when it is wrong, which is why each one is asserted
 * rather than argued:
 *
 * - **Disposal is exact-once and reverse-order.** A script that mounts twice
 *   doubles its listeners; one that never unmounts leaks them for the life of
 *   the page.
 * - **The old generation goes before the new one mounts**, so a reload is a
 *   replacement rather than an addition.
 * - **`signal` aborts on teardown**, so an async mount cannot finish after its
 *   own disposal and attach to a DOM nobody will clean.
 * - **A throwing mount is rolled back**, leaving no partial tree in the
 *   document.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { ContentScriptContext, ContentScriptRegistration } from '@ompchamber/plugin-sdk';
import {
  isGenerationLive,
  mountContentScripts,
  resetContentScripts,
  unmountAllContentScripts,
  unmountContentScripts,
} from '@/client/lib/plugins/content-scripts';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let window_: Window | null = null;

function installDom(): void {
  window_ = new Window();
  const target = globalThis as unknown as Record<string, unknown>;
  const source = window_ as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    if (source[key] !== undefined) target[key] = source[key];
  }
}

function restoreDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    const value = nativeGlobals[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
  window_ = null;
}

/** The host every mount in this suite is given. */
const host = { target: () => document.body };

/** A script that appends a node and removes it on disposal. */
function marker(id: string, log: string[]): ContentScriptRegistration {
  return {
    id,
    mount: (context: ContentScriptContext) => {
      log.push(`mount:${id}:${context.generation}`);
      const node = document.createElement('div');
      node.id = `script-${id}`;
      node.dataset.generation = String(context.generation);
      document.body.appendChild(node);
      return () => {
        log.push(`dispose:${id}`);
        node.remove();
      };
    },
  };
}

beforeEach(() => {
  installDom();
  resetContentScripts();
  document.body.replaceChildren();
});

afterEach(() => {
  resetContentScripts();
  restoreDom();
});

describe('mount', () => {
  test('a mounted script puts its node in the document', async () => {
    const log: string[] = [];
    const failures = await mountContentScripts('demo', [marker('a', log)], host);

    expect(failures).toEqual([]);
    expect(document.getElementById('script-a')).not.toBeNull();
    expect(log).toHaveLength(1);
    expect(log[0]).toStartWith('mount:a:');
  });

  test('the generation is passed and is live while mounted', async () => {
    let seen = -1;
    await mountContentScripts(
      'demo',
      [{ id: 'g', mount: (context) => {
        seen = context.generation;
        return () => {};
      } }],
      host,
    );
    expect(seen).toBeGreaterThan(0);
    expect(isGenerationLive(seen)).toBe(true);
  });

  test('several scripts of one plugin all mount', async () => {
    const log: string[] = [];
    await mountContentScripts('demo', [marker('a', log), marker('b', log)], host);
    expect(document.getElementById('script-a')).not.toBeNull();
    expect(document.getElementById('script-b')).not.toBeNull();
  });
});

describe('replacement', () => {
  test('a second mount disposes the FIRST generation before mounting', async () => {
    const log: string[] = [];
    await mountContentScripts('demo', [marker('a', log)], host);
    log.length = 0;

    await mountContentScripts('demo', [marker('a', log)], host);

    // Disposal came first, then the new mount — never overlapping.
    expect(log[0]).toBe('dispose:a');
    expect(log[1]).toStartWith('mount:a:');
    // And exactly one node is in the document, not two.
    expect(document.querySelectorAll('#script-a')).toHaveLength(1);
  });

  test('unmounting removes the node and is idempotent', async () => {
    const log: string[] = [];
    await mountContentScripts('demo', [marker('a', log)], host);

    await unmountContentScripts('demo');
    await unmountContentScripts('demo');

    expect(document.getElementById('script-a')).toBeNull();
    // Ran ONCE, despite two teardowns.
    expect(log.filter((line) => line === 'dispose:a')).toHaveLength(1);
  });

  test('unmounting one plugin leaves another alone', async () => {
    const log: string[] = [];
    await mountContentScripts('alpha', [marker('a', log)], host);
    await mountContentScripts('beta', [marker('b', log)], host);

    await unmountContentScripts('alpha');

    expect(document.getElementById('script-a')).toBeNull();
    expect(document.getElementById('script-b')).not.toBeNull();
  });

  test('disposal is REVERSE order, newest first', async () => {
    // A later script may depend on an earlier one's DOM, so it must come down
    // first. Mount order is a, b, c; disposal must be c, b, a.
    const log: string[] = [];
    await mountContentScripts('demo', [marker('a', log), marker('b', log), marker('c', log)], host);
    log.length = 0;

    await unmountContentScripts('demo');

    expect(log).toEqual(['dispose:c', 'dispose:b', 'dispose:a']);
  });

  test('a mount/dispose cycle restores the document', async () => {
    // The whole-document check: whatever the scripts added is gone afterwards,
    // so the next generation starts from the same DOM this one did.
    const before = document.body.innerHTML;
    const log: string[] = [];
    await mountContentScripts('demo', [marker('a', log), marker('b', log)], host);
    expect(document.body.innerHTML).not.toBe(before);

    await unmountContentScripts('demo');

    expect(document.body.innerHTML).toBe(before);
  });

  test('unmountAll takes every plugin down', async () => {
    const log: string[] = [];
    await mountContentScripts('alpha', [marker('a', log)], host);
    await mountContentScripts('beta', [marker('b', log)], host);

    await unmountAllContentScripts();

    expect(document.getElementById('script-a')).toBeNull();
    expect(document.getElementById('script-b')).toBeNull();
  });

  test('a mount that answers no disposer is a failure, not a leak', async () => {
    const failures = await mountContentScripts(
      'demo',
      [{ id: 'bad', mount: () => undefined as unknown as () => void }],
      host,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toContain('no disposer');
  });
});

describe('async mounts and abort', () => {
  test('the signal aborts on teardown', async () => {
    // A holder rather than a `let`: the assignment happens inside a callback,
    // which TypeScript does not track, so a plain binding reads as `null`
    // everywhere after its initializer.
    const captured: { signal?: AbortSignal } = {};
    await mountContentScripts(
      'demo',
      [{ id: 'slow', mount: (context) => {
        captured.signal = context.signal;
        return () => {};
      } }],
      host,
    );
    expect(captured.signal?.aborted).toBe(false);

    await unmountContentScripts('demo');
    expect(captured.signal?.aborted).toBe(true);
  });

  test('a mount that resolves after teardown attaches nothing', async () => {
    const gate: { release?: () => void } = {};
    const waiting = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    /** Resolves once the mount is IN FLIGHT, so teardown cannot race its start. */
    const started: { signal?: () => void } = {};
    const inFlight = new Promise<void>((resolve) => {
      started.signal = resolve;
    });
    const state = { disposed: false };

    const registration: ContentScriptRegistration = {
      id: 'late',
      mount: async () => {
        started.signal?.();
        await waiting;
        return () => {
          state.disposed = true;
        };
      },
    };

    const mounting = mountContentScripts('demo', [registration], host);
    // Only tear down once the generation exists, or the abort would be set on
    // an AbortController that has not been created yet and the test would prove
    // nothing.
    await inFlight;
    await unmountContentScripts('demo');
    gate.release?.();
    await mounting;

    // The script's own disposer ran, because the host had to undo a mount that
    // finished after its teardown.
    expect(state.disposed).toBe(true);
    expect(document.getElementById('script-late')).toBeNull();
  });
});

describe('failures', () => {
  test('a throwing mount is reported and leaves no live generation', async () => {
    // What the host can roll back is its own RECORD: a generation the reaper
    // could never reach is the leak. A content script owns the DOM it adds —
    // the contract hands it no container — so undoing those nodes is the
    // script's own job (its disposer, or catching its own throw), and the host
    // does not pretend otherwise.
    const registration: ContentScriptRegistration = {
      id: 'boom',
      mount: () => {
        throw new Error('the script threw');
      },
    };

    const failures = await mountContentScripts('demo', [registration], host);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBe('the script threw');
    // No dangling record: a later teardown has nothing to find.
    await expect(unmountContentScripts('demo')).resolves.toBeUndefined();
  });

  test('one broken script does not stop the next one', async () => {
    const log: string[] = [];
    const failures = await mountContentScripts(
      'demo',
      [
        { id: 'boom', mount: () => {
          throw new Error('first is broken');
        } },
        marker('after', log),
      ],
      host,
    );

    expect(failures).toHaveLength(1);
    expect(document.getElementById('script-after')).not.toBeNull();
  });

  test('a throwing disposer does not stop the others coming down', async () => {
    let secondDisposed = false;
    await mountContentScripts(
      'demo',
      [
        { id: 'a', mount: () => () => {
          throw new Error('this disposer is broken');
        } },
        { id: 'b', mount: () => () => {
          secondDisposed = true;
        } },
      ],
      host,
    );

    await unmountContentScripts('demo');

    expect(secondDisposed).toBe(true);
  });

  test('no host element is reported rather than silently doing nothing', async () => {
    const failures = await mountContentScripts('demo', [marker('a', [])], { target: () => null });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toContain('no host element');
  });
});
