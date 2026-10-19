/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The popup's command pool has two sources with different owners: omp's
 * `get_available_commands` and Kabmo's own commands. `/btw` exists only
 * in the second — omp's registry entry for it is TUI-only, so RPC never
 * advertises it — and the composer intercepts the token on send. If the entry
 * ever disappears, the popup offers every command except the one being typed,
 * and the user is left guessing why `/btw` matches nothing but `browser` by
 * description.
 */

import { describe, expect, test } from 'bun:test';

import type { CommandItem } from '@/shared/types';
import { mergeCommandAndSkillItems } from '@/shared/lib/chat/composer/client';

function command(over: Partial<CommandItem> & { name: string }): CommandItem {
  return {
    id: `cmd-${over.name}`,
    description: '',
    scope: 'system',
    template: '',
    ...over,
  };
}

describe('mergeCommandAndSkillItems', () => {
  test('offers the chamber-owned /btw with omp metadata', () => {
    const items = mergeCommandAndSkillItems([command({ name: 'model', description: 'Show current model selection' })], []);

    const btw = items.find((item) => item.name === 'btw');
    expect(btw).toBeDefined();
    expect(btw?.token).toBe('/btw');
    expect(btw?.kind).toBe('command');
    // The hint is folded into the description exactly as the popup renders it.
    expect(btw?.description).toBe("[question] - Ask a side question, or browse this session's BTW history");
  });

  test('keeps Kabmo entry when omp advertises the same name', () => {
    const items = mergeCommandAndSkillItems([command({ name: 'btw', description: 'something else entirely' })], []);

    const matching = items.filter((item) => item.name === 'btw');
    expect(matching.length).toBe(1);
    expect(matching[0].description).toContain('Ask a side question');
  });
});
