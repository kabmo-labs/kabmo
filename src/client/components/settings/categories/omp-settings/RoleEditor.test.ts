/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The model-role editor's role list.
 *
 * Pinned because a missing row is unreachable, not merely unlabelled: the panel
 * offered 9 of omp's 15 built-in roles, so `memory`, `image`, `web`, `speech`,
 * `dictation` and `judge` could not be set from the console even though
 * `omp config set`/`modelRoles` accept them. `dictation` is the one with a
 * feature behind it — Kabmo's own dictation reads `stt.language` from
 * config, and the local STT MODEL comes from that role — so an editor without
 * it left the model choice to omp's default with no way to change it here.
 *
 * The expected list is omp's own `MODEL_ROLE_IDS` at 18.11.0, read from the
 * installed package (`pi-tui/src/overlays/model-browser.ts`), so an upstream
 * role addition surfaces as a failure here rather than as a silently missing
 * input.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MODEL_ROLES, RoleEditor } from '@/client/components/settings/categories/omp-settings/RoleEditor';

/** omp 18.11.0 `MODEL_ROLE_IDS`. */
const OMP_ROLES = [
  'default', 'smol', 'slow', 'vision', 'plan', 'commit', 'tiny', 'memory', 'task', 'advisor',
  'image', 'web', 'speech', 'dictation', 'judge',
];
/** The six that were missing before this change. */
const PREVIOUSLY_MISSING = ['memory', 'image', 'web', 'speech', 'dictation', 'judge'];

let container: HTMLElement;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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

async function mount(modelRoles: Record<string, string>): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(RoleEditor, { modelRoles, onSaveRole: () => {}, savedRole: null }), container);
  });
  return container;
}

describe('model role coverage', () => {
  test('every one of omp’s built-in roles is present', () => {
    expect(Object.keys(MODEL_ROLES).sort()).toEqual([...OMP_ROLES].sort());
  });

  test('the six roles the editor used to omit are each offered as an input', async () => {
    const el = await mount({});
    for (const role of PREVIOUSLY_MISSING) {
      const input = el.querySelector(`input[aria-label*="(${role})"]`);
      expect(input, `${role} must be editable`).not.toBeNull();
    }
  });

  test('a chat role and a kind role fall under the section omp assigns them', async () => {
    // `judge` accepts a judge/tiny/chat model; a chat role accepts a chat model.
    expect(MODEL_ROLES.advisor.section).toBe('chat');
    expect(MODEL_ROLES.dictation.section).toBe('kind');
  });

  test('a stored value renders in its row and survives another role’s edit', async () => {
    const el = await mount({ dictation: 'local/whisper-base', default: 'kenari/deepseek-v4-flash' });
    const dictation = el.querySelector('input[aria-label*="(dictation)"]') as HTMLInputElement;
    expect(dictation.value).toBe('local/whisper-base');
    const fallback = el.querySelector('input[aria-label*="(default)"]') as HTMLInputElement;
    expect(fallback.value).toBe('kenari/deepseek-v4-flash');
  });
});
