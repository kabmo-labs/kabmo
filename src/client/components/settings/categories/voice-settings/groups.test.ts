/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  VOICE_SECTION_IDS,
  VOICE_SETTING_GROUPS,
} from '@/client/components/settings/categories/voice-settings/groups';

describe('voice settings groups', () => {
  test('every section belongs to exactly one group', () => {
    const assigned = VOICE_SETTING_GROUPS.flatMap((group) => group.sections);
    expect([...assigned].sort()).toEqual([...VOICE_SECTION_IDS].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  test('STT and TTS are separate groups', () => {
    expect(VOICE_SETTING_GROUPS.map((group) => group.id)).toEqual(['dictation', 'speech']);
    expect(VOICE_SETTING_GROUPS.every((group) => group.description.length > 0)).toBe(true);
  });
});
