/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Small pure tables and derivations that several surfaces read at once, so a
 * drift here is a UI bug far from the edit:
 *
 * - `VIEWPORT_CLASSES` is the only place a device preset becomes CSS; a missing
 *   or misspelled key renders an unstyled iframe, and the responsive preset is
 *   the one entry that must NOT carry a border (it is not emulating a device).
 * - `SORT_OPTIONS` must stay in menu order and in lockstep with the validation
 *   list the comparator uses, or the menu offers an option sorting ignores.
 * - `pluginSelectionKey` is `(id, scope)`: the same `name@marketplace` installs
 *   into both registries, and keying by id alone made the two copies one row.
 * - `modelLabel` / `hashModel` / `pageWindow` back the raw-message browser: the
 *   label splits `provider/model`, the hash picks a stable colour, and the
 *   window condenses a long page list around the current page.
 * - `getToolInputPath` / `getToolInputAction` read raw tool arguments, which
 *   omp sends as an object but the MOCK path may send as a JSON string.
 * - `truncateTailLines` is display-only: it keeps the LAST lines (the newest
 *   output is the interesting end) and reports how many were dropped.
 * - `extractLineMeta` resolves the gutter's starting line through an ordered
 *   heuristic chain — the order is load-bearing, so each rung is pinned.
 */

import { describe, expect, test } from 'bun:test';
import { VIEWPORT_CLASSES } from '@/client/components/common/viewport';
import { SORT_LABELS, SORT_OPTIONS } from '@/client/components/common/sort-menu/options';
import { pluginSelectionKey } from '@/client/components/settings/categories/plugin-settings/selection';
import {
  ACCESS_LEVEL_DESCRIPTIONS,
  ACCESS_LEVEL_LABELS,
} from '@/client/components/workspace/chat-timeline/chat-input/access-levels';
import { hashModel, MODEL_COLORS, modelLabel, PAGE_SIZE, pageWindow } from '@/client/components/workspace/context-panel/raw-messages';
import {
  getToolInputAction,
  getToolInputPath,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-input';
import {
  MAX_OUTPUT_LINES,
  truncateTailLines,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';
import { extractLineMeta } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/read-line-meta';
import type { PluginItem } from '@/shared/types';
import type { ToolCallData } from '@/shared/types/chat';

describe('VIEWPORT_CLASSES', () => {
  test('every preset mode maps to a non-empty class string', () => {
    expect(Object.keys(VIEWPORT_CLASSES).sort()).toEqual(
      ['desktop-16-9', 'laptop', 'mobile', 'mobile-lg', 'responsive', 'tablet'].sort(),
    );
    for (const [mode, classes] of Object.entries(VIEWPORT_CLASSES)) {
      expect(classes.trim(), mode).not.toBe('');
    }
  });

  test('device presets get a frame; the responsive preset is a bare full-bleed box', () => {
    expect(VIEWPORT_CLASSES.responsive).toBe('w-full h-full border-0');
    for (const mode of ['desktop-16-9', 'laptop', 'tablet', 'mobile', 'mobile-lg'] as const) {
      expect(VIEWPORT_CLASSES[mode], mode).toContain('border');
      expect(VIEWPORT_CLASSES[mode], mode).toContain('overflow-hidden');
    }
  });

  test('the presets carry the device pixel sizes the labels promise', () => {
    expect(VIEWPORT_CLASSES.laptop).toContain('w-[1024px]');
    expect(VIEWPORT_CLASSES.tablet).toContain('w-[768px]');
    expect(VIEWPORT_CLASSES.mobile).toContain('w-[375px]');
    expect(VIEWPORT_CLASSES['mobile-lg']).toContain('w-[414px]');
  });
});

describe('sort menu options', () => {
  test('menu order is the declared order', () => {
    expect(SORT_OPTIONS).toEqual(['A-Z', 'Z-A', 'LATEST_SESSION', 'LATEST_ADDED']);
  });

  test('every option has a label and the time-based ones are title-cased', () => {
    for (const option of SORT_OPTIONS) {
      expect(SORT_LABELS[option], option).toBeTruthy();
    }
    expect(SORT_LABELS.LATEST_SESSION).toBe('Latest Session');
    expect(SORT_LABELS.LATEST_ADDED).toBe('Latest Added');
    expect(SORT_LABELS['A-Z']).toBe('A-Z');
  });
});

describe('pluginSelectionKey', () => {
  const plugin = (id: string, scope: PluginItem['scope']): PluginItem =>
    ({ id, scope, name: id, packageName: id, version: '1.0.0', kind: 'marketplace', enabled: true, description: '' }) as PluginItem;

  test('the same plugin id in both registries yields two distinct keys', () => {
    const userKey = pluginSelectionKey(plugin('manifest@local-mkt', 'user'));
    const projectKey = pluginSelectionKey(plugin('manifest@local-mkt', 'project'));
    expect(userKey).not.toBe(projectKey);
    expect(userKey).toBe('manifest@local-mkt::user');
    expect(projectKey).toBe('manifest@local-mkt::project');
  });

  test('two different ids in the same scope stay distinct', () => {
    expect(pluginSelectionKey(plugin('a@mkt', 'user'))).not.toBe(pluginSelectionKey(plugin('b@mkt', 'user')));
  });
});

describe('access level labels', () => {
  test('every approval mode has a label and a description', () => {
    expect(Object.keys(ACCESS_LEVEL_LABELS).sort()).toEqual(['always-ask', 'write', 'yolo']);
    for (const mode of Object.keys(ACCESS_LEVEL_LABELS)) {
      expect(ACCESS_LEVEL_DESCRIPTIONS[mode as keyof typeof ACCESS_LEVEL_LABELS], mode).toBeTruthy();
    }
  });

  test('the labels say what the mode actually does', () => {
    expect(ACCESS_LEVEL_LABELS['always-ask']).toBe('Always ask');
    expect(ACCESS_LEVEL_LABELS.write).toBe('Minimal');
    expect(ACCESS_LEVEL_LABELS.yolo).toBe('Full bypass');
    expect(ACCESS_LEVEL_DESCRIPTIONS.yolo).toContain('without asking');
  });
});

describe('raw-message helpers', () => {
  test('modelLabel splits provider from model, and passes a bare id through', () => {
    expect(modelLabel('deepseek/deepseek-v4-flash')).toBe('deepseek · deepseek-v4-flash');
    expect(modelLabel('bare-model')).toBe('bare-model');
  });

  test('a leading slash is not a provider separator', () => {
    // `slash > 0` is the guard: an id starting with '/' has no provider part.
    expect(modelLabel('/leading')).toBe('/leading');
  });

  test('hashModel is deterministic, non-negative, and indexes a real colour', () => {
    const first = hashModel('deepseek/deepseek-v4-flash');
    expect(first).toBe(hashModel('deepseek/deepseek-v4-flash'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(MODEL_COLORS[first % MODEL_COLORS.length]).toBeTruthy();
    expect(MODEL_COLORS[first % MODEL_COLORS.length]).toMatch(/^bg-/);
  });

  test('pageWindow lists every page while the count is small', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('pageWindow condenses a long list around the current page', () => {
    expect(pageWindow(5, 20)).toEqual([1, '…', 4, 5, 6, '…', 20]);
    // Near the start the window widens instead of leaving a one-page gap.
    expect(pageWindow(2, 20)).toEqual([1, 2, 3, 4, '…', 20]);
    // Near the end likewise, mirrored.
    expect(pageWindow(19, 20)).toEqual([1, '…', 17, 18, 19, 20]);
  });

  test('pageWindow never emits an out-of-range page', () => {
    const window = pageWindow(1, 20);
    for (const entry of window) {
      if (entry === '…') continue;
      expect(entry).toBeGreaterThanOrEqual(1);
      expect(entry).toBeLessThanOrEqual(20);
    }
    expect(PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe('tool input readers', () => {
  test('reads path/action out of an object payload', () => {
    expect(getToolInputPath({ path: 'src/a.ts', action: 'read' })).toBe('src/a.ts');
    expect(getToolInputAction({ path: 'src/a.ts', action: 'read' })).toBe('read');
  });

  test('a JSON string payload (the MOCK path) yields undefined, not a throw', () => {
    expect(getToolInputPath('{"path":"src/a.ts"}')).toBeUndefined();
    expect(getToolInputAction('{"action":"read"}')).toBeUndefined();
  });

  test('a wrong-typed or absent field is undefined', () => {
    expect(getToolInputPath({ path: 42 })).toBeUndefined();
    expect(getToolInputPath({})).toBeUndefined();
    expect(getToolInputPath(undefined)).toBeUndefined();
    expect(getToolInputAction(null as unknown as undefined)).toBeUndefined();
  });
});

describe('truncateTailLines', () => {
  test('empty input is returned untouched with nothing skipped', () => {
    expect(truncateTailLines('')).toEqual({ text: '', skipped: 0 });
  });

  test('text at or under the limit is returned verbatim', () => {
    expect(truncateTailLines('a\nb\nc', 3)).toEqual({ text: 'a\nb\nc', skipped: 0 });
    expect(truncateTailLines('a\nb\nc', 5)).toEqual({ text: 'a\nb\nc', skipped: 0 });
  });

  test('over the limit the LAST lines survive and the drop count is reported', () => {
    expect(truncateTailLines('l1\nl2\nl3\nl4\nl5', 2)).toEqual({ text: 'l4\nl5', skipped: 3 });
  });

  test('the default limit is the module ceiling', () => {
    const lines = Array.from({ length: MAX_OUTPUT_LINES + 2 }, (_, i) => `line-${i}`);
    const result = truncateTailLines(lines.join('\n'));
    expect(result.skipped).toBe(2);
    expect(result.text.startsWith('line-2\n')).toBe(true);
    expect(result.text.endsWith(`line-${MAX_OUTPUT_LINES + 1}`)).toBe(true);
  });

  test('CRLF input is split on the CRLF boundary, not mid-line', () => {
    expect(truncateTailLines('a\r\nb\r\nc', 2)).toEqual({ text: 'b\nc', skipped: 1 });
  });
});

describe('extractLineMeta precedence', () => {
  const call = (overrides: Partial<ToolCallData>): ToolCallData =>
    ({ id: 't1', type: 'read', title: 'read', ...overrides }) as ToolCallData;

  test('an explicit lineNumbers array wins over every later rung', () => {
    const meta = extractLineMeta(
      call({ details: { displayContent: { lineNumbers: [10, 11], startLine: 10 }, startLine: 99 }, input: { start_line: 42 } }),
    );
    expect(meta).toEqual({ startLine: 10, lineNumbers: [10, 11] });
  });

  test('an empty lineNumbers array is ignored, falling through to startLine', () => {
    const meta = extractLineMeta(call({ details: { lineNumbers: [], startLine: 7 } }));
    expect(meta).toEqual({ startLine: 7 });
  });

  test('details.startLine must be positive to be used', () => {
    expect(extractLineMeta(call({ details: { startLine: 0 } }))).toEqual({});
    expect(extractLineMeta(call({ details: { startLine: -3 } }))).toEqual({});
  });

  test('start_line and offset are read from details, then from input', () => {
    expect(extractLineMeta(call({ details: { start_line: 12 } }))).toEqual({ startLine: 12 });
    expect(extractLineMeta(call({ details: { offset: 5 } }))).toEqual({ startLine: 5 });
    expect(extractLineMeta(call({ input: { start_line: 33 } }))).toEqual({ startLine: 33 });
    expect(extractLineMeta(call({ input: { from: '4' } }))).toEqual({ startLine: 4 });
  });

  test('a numeric string input line is parsed; a non-numeric one is not', () => {
    expect(extractLineMeta(call({ input: { offset: '  21 ' } }))).toEqual({ startLine: 21 });
    expect(extractLineMeta(call({ input: { offset: '3a' } }))).toEqual({});
  });

  test('the truncation shownRange start is a fallback rung', () => {
    const meta = extractLineMeta(call({ details: { meta: { truncation: { shownRange: { start: 54 } } } } }));
    expect(meta).toEqual({ startLine: 54 });
  });

  test('a `path:NN-MM` range in the title supplies the start line', () => {
    const meta = extractLineMeta(call({ title: 'app/types/chat.ts:55-100' }));
    expect(meta).toEqual({ startLine: 55 });
  });

  test('the elision notice inside the content is the last rung', () => {
    const meta = extractLineMeta(call({ title: 'read' }), undefined, 'text\n[Showing lines 54-103 of 208]\n');
    expect(meta).toEqual({ startLine: 54 });
  });

  test('nothing to go on yields an empty meta', () => {
    expect(extractLineMeta(call({ title: 'read' }))).toEqual({});
    expect(extractLineMeta(undefined)).toEqual({});
  });
});
