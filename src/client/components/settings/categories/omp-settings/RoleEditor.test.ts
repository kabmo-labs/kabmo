/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The model-role editor: role coverage, the model PICKER, and presets.
 *
 * Pinned because each of these was a bug or a gap first:
 *
 *   - **Role coverage.** The panel offered 9 of omp's 16 built-in roles, so
 *     `memory`, `image`, `web`, `speech`, `dictation`, `judge` and `widget`
 *     could not be set from the console. The expected list is omp's own
 *     `MODEL_ROLE_IDS` at 18.12.6 (read from the installed package,
 *     `pi-tui/src/overlays/model-browser.ts`), so an upstream addition surfaces
 *     as a failure here rather than as a silently missing row.
 *   - **A role row is a SELECT, not a text field.** A free-text `provider/model`
 *     box cannot be typed reliably and a typo silently falls back to omp's own
 *     resolution. The candidates are grouped per provider, only the role's own
 *     kinds are offered, and the stored value stays selectable when the catalog
 *     no longer lists it.
 *   - **The selection and "in use" are two facts.** `in use` is derived by
 *     comparing the live map with the preset, so there is no stored "last
 *     applied" flag to go stale. The SELECTION survives a hand edit, because it
 *     is the target of `Update` — tying it to the comparison made Update
 *     unreachable in the save-back flow it exists for.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { RoleEditor } from '@/client/components/settings/categories/omp-settings/RoleEditor';
import {
  MODEL_ROLES,
  ROLE_IDS,
  candidatesForRole,
  matchPreset,
  roleAcceptsCandidate,
  roleMapsEqual,
} from '@/shared/lib/omp/config/model-roles';
import type { ModelRoleCandidate, ModelRolePreset } from '@/shared/types/model-roles';

/** omp 18.12.6 `MODEL_ROLE_IDS`. */
const OMP_ROLES = [
  'default', 'smol', 'slow', 'vision', 'plan', 'commit', 'tiny', 'memory', 'task', 'advisor', 'widget',
  'image', 'web', 'speech', 'dictation', 'judge',
];
/** The roles this panel used to omit. */
const PREVIOUSLY_MISSING = ['memory', 'image', 'web', 'speech', 'dictation', 'judge', 'widget'];

const CANDIDATES: ModelRoleCandidate[] = [
  { selector: 'kenari/deepseek-v4-flash', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'kenari', kind: 'chat' },
  { selector: 'kenari/glm-5', id: 'glm-5', name: 'GLM-5', provider: 'kenari', kind: 'chat' },
  { selector: 'local/gemma-3-1b', id: 'gemma-3-1b', name: 'Gemma 3 1B', provider: 'local', kind: 'tiny' },
  { selector: 'web/brave', id: 'brave', name: 'Brave', provider: 'web', kind: 'search' },
  { selector: 'local/whisper-base', id: 'whisper-base', name: 'Whisper Base', provider: 'local', kind: 'stt' },
  { selector: 'local/kokoro', id: 'kokoro', name: 'Kokoro-82M', provider: 'local', kind: 'tts' },
  { selector: 'local/flux', id: 'flux', name: 'FLUX.1', provider: 'local', kind: 'image' },
];

const PRESETS: ModelRolePreset[] = [
  {
    id: 'p-cheap',
    name: 'cheap',
    roles: { default: 'kenari/deepseek-v4-flash', tiny: 'local/gemma-3-1b' },
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'p-think',
    name: 'thinking',
    roles: { default: 'kenari/glm-5' },
    createdAt: 2,
    updatedAt: 2,
  },
];

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

async function mount(roles: Record<string, string>, overrides: Partial<Parameters<typeof RoleEditor>[0]> = {}): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  const props = {
    roles,
    presets: PRESETS,
    candidates: CANDIDATES,
    candidatesError: null,
    onSaveRoles: async () => true,
    onSavePreset: async () => true,
    onUpdatePreset: async () => true,
    onDeletePreset: async () => true,
    savedRole: null,
    ...overrides,
  };
  await act(async () => {
    render(h(RoleEditor, props), container);
  });
  return container;
}

describe('role table', () => {
  test('every one of omp’s built-in roles is present', () => {
    expect([...ROLE_IDS].sort()).toEqual([...OMP_ROLES].sort());
  });

  test('the roles the editor used to omit are each offered as a picker', async () => {
    const el = await mount({});
    for (const role of PREVIOUSLY_MISSING) {
      const select = el.querySelector(`select[aria-label*="(${role})"]`);
      expect(select, `${role} must be editable`).not.toBeNull();
    }
  });

  test('a chat role and a kind role fall under the section omp assigns them', () => {
    expect(MODEL_ROLES.advisor.section).toBe('chat');
    expect(MODEL_ROLES.widget.section).toBe('chat');
    expect(MODEL_ROLES.dictation.section).toBe('kind');
  });
});

describe('role candidate rules', () => {
  test('a chat role offers chat models only, and a kind role its own kind', () => {
    expect(candidatesForRole('default', CANDIDATES).every((c) => c.kind === 'chat')).toBe(true);
    expect(candidatesForRole('web', CANDIDATES).map((c) => c.selector)).toEqual(['web/brave']);
    expect(candidatesForRole('dictation', CANDIDATES).map((c) => c.selector)).toEqual(['local/whisper-base']);
    expect(candidatesForRole('speech', CANDIDATES).map((c) => c.selector)).toEqual(['local/kokoro']);
    expect(candidatesForRole('image', CANDIDATES).map((c) => c.selector)).toEqual(['local/flux']);
  });

  test('tiny and judge accept a tiny model as well as a chat model', () => {
    const tiny = candidatesForRole('tiny', CANDIDATES).map((c) => c.selector);
    expect(tiny).toContain('local/gemma-3-1b');
    expect(tiny).toContain('kenari/glm-5');
    const judge = candidatesForRole('judge', CANDIDATES).map((c) => c.selector);
    expect(judge).toContain('local/gemma-3-1b');
    expect(judge).toContain('kenari/deepseek-v4-flash');
  });

  test('web also admits a chat model that declares grounding, and nothing else does', () => {
    const grounded: ModelRoleCandidate = {
      selector: 'kenari/glm-5', id: 'glm-5', name: 'GLM-5', provider: 'kenari', kind: 'chat', webCapable: true,
    };
    expect(roleAcceptsCandidate('web', grounded)).toBe(true);
    expect(roleAcceptsCandidate('web', { ...grounded, webCapable: false })).toBe(false);
    expect(roleAcceptsCandidate('default', grounded)).toBe(true);
    // A search model is not a chat role's business.
    expect(roleAcceptsCandidate('default', CANDIDATES[3])).toBe(false);
  });

  test('an unknown role accepts nothing', () => {
    expect(candidatesForRole('nope', CANDIDATES)).toEqual([]);
  });
});

describe('role rows', () => {
  test('the picker groups candidates by provider and carries the stored value', async () => {
    const el = await mount({ default: 'kenari/glm-5' });
    const select = el.querySelector('select[aria-label*="(default)"]') as HTMLSelectElement;
    expect(select.value).toBe('kenari/glm-5');
    const groups = [...select.querySelectorAll('optgroup')].map((group) => group.getAttribute('label'));
    expect(groups).toEqual(['kenari']);
    // "omp default" is always the first option — it is how an override is removed.
    expect(select.options[0].value).toBe('');
  });

  test('a stored selector the catalog no longer lists stays selectable', async () => {
    const el = await mount({ default: 'gone/model-x' });
    const select = el.querySelector('select[aria-label*="(default)"]') as HTMLSelectElement;
    expect(select.value).toBe('gone/model-x');
    const values = [...select.options].map((option) => option.value);
    expect(values).toContain('gone/model-x');
  });

  test('choosing a model writes the whole map with that role set', async () => {
    const writes: Array<Record<string, string>> = [];
    const el = await mount({ tiny: 'local/gemma-3-1b' }, {
      onSaveRoles: async (roles) => { writes.push(roles); return true; },
    });
    const select = el.querySelector('select[aria-label*="(default)"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'kenari/glm-5';
      select.dispatchEvent(new window.Event('change'));
    });
    expect(writes).toEqual([{ tiny: 'local/gemma-3-1b', default: 'kenari/glm-5' }]);
  });

  test('choosing “omp default” removes the role from the map', async () => {
    const writes: Array<Record<string, string>> = [];
    const el = await mount({ default: 'kenari/glm-5', tiny: 'local/gemma-3-1b' }, {
      onSaveRoles: async (roles) => { writes.push(roles); return true; },
    });
    const select = el.querySelector('select[aria-label*="(default)"]') as HTMLSelectElement;
    await act(async () => {
      select.value = '';
      select.dispatchEvent(new window.Event('change'));
    });
    expect(writes).toEqual([{ tiny: 'local/gemma-3-1b' }]);
  });
});

describe('presets', () => {
  test('the preset equal to the live map reads as active', () => {
    expect(matchPreset(PRESETS, { ...PRESETS[0].roles })?.name).toBe('cheap');
    expect(matchPreset(PRESETS, { default: 'kenari/glm-5', extra: 'a/b' })).toBeNull();
    expect(roleMapsEqual({ a: '1' }, { a: '1' })).toBe(true);
    expect(roleMapsEqual({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    expect(roleMapsEqual({ a: '1' }, { a: '2' })).toBe(false);
  });

  test('the picker names the preset the live map equals, and reads in use', async () => {
    const active = await mount({ ...PRESETS[0].roles });
    const picker = active.querySelector('select[aria-label="Model role preset"]') as HTMLSelectElement;
    expect(picker.value).toBe('p-cheap');
    expect(active.textContent).toContain('in use');
  });

  test('a map no preset matches leaves the picker on Custom', async () => {
    const el = await mount({ default: 'kenari/deepseek-v4-flash' });
    const picker = el.querySelector('select[aria-label="Model role preset"]') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(el.textContent).not.toContain('in use');
  });

  test('a hand edit keeps the selection and reads modified, so Update stays reachable', async () => {
    const el = await mount({ ...PRESETS[0].roles });
    const select = el.querySelector('select[aria-label*="(default)"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'kenari/glm-5';
      select.dispatchEvent(new window.Event('change'));
    });
    const picker = el.querySelector('select[aria-label="Model role preset"]') as HTMLSelectElement;
    expect(picker.value).toBe('p-cheap');
    expect(el.textContent).toContain('modified');
    expect(el.textContent).not.toContain('in use');
    const update = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Update'))!;
    expect(update.disabled).toBe(false);
  });

  test('Update stores the live map into the selected preset', async () => {
    const updates: ModelRolePreset[] = [];
    const el = await mount({ ...PRESETS[0].roles }, {
      onUpdatePreset: async (preset) => { updates.push(preset); return true; },
    });
    const select = el.querySelector('select[aria-label*="(default)"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'kenari/glm-5';
      select.dispatchEvent(new window.Event('change'));
    });
    const update = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Update'))!;
    await act(async () => { update.click(); });
    expect(updates.length).toBe(1);
    expect(updates[0].id).toBe('p-cheap');
    expect(updates[0].roles).toEqual({ default: 'kenari/glm-5', tiny: 'local/gemma-3-1b' });
  });

  test('choosing a preset applies its whole role map', async () => {
    const writes: Array<Record<string, string>> = [];
    const el = await mount({}, { onSaveRoles: async (roles) => { writes.push(roles); return true; } });
    const picker = el.querySelector('select[aria-label="Model role preset"]') as HTMLSelectElement;
    await act(async () => {
      picker.value = 'p-think';
      picker.dispatchEvent(new window.Event('change'));
    });
    expect(writes).toEqual([PRESETS[1].roles]);
  });

  test('Update and Delete are refused with no selected preset', async () => {
    const el = await mount({ default: 'kenari/deepseek-v4-flash' });
    const update = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Update'))!;
    expect(update.disabled).toBe(true);
  });

  test('a failed catalog is reported and the rows stay editable', async () => {
    const el = await mount({ default: 'kenari/glm-5' }, { candidates: [], candidatesError: 'omp binary not found' });
    expect(el.textContent).toContain('Model catalog unavailable');
    expect(el.textContent).toContain('omp binary not found');
    const select = el.querySelector('select[aria-label*="(default)"]') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    // The stored selector survives even with no catalog to draw options from.
    expect(select.value).toBe('kenari/glm-5');
  });

  test('a refused write is shown in place', async () => {
    const el = await mount({}, { writeError: 'Invalid value: modelRoles' });
    expect(el.textContent).toContain('Invalid value: modelRoles');
  });

  test('deleting clears the selection', async () => {
    const deleted: string[] = [];
    const el = await mount({ ...PRESETS[0].roles }, {
      onDeletePreset: async (preset) => { deleted.push(preset.id); return true; },
    });
    const trash = el.querySelector('button[title^="Delete"]') as HTMLButtonElement;
    await act(async () => { trash.click(); });
    const confirm = [...el.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Delete')!;
    await act(async () => { confirm.click(); });
    expect(deleted).toEqual(['p-cheap']);
    const picker = el.querySelector('select[aria-label="Model role preset"]') as HTMLSelectElement;
    expect(picker.value).toBe('');
  });
});
