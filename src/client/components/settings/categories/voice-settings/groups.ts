/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Voice: two groups, one direction each.
 *
 * Dictation (STT) decides where the microphone's audio goes; Speech (TTS)
 * decides where the answer's text goes. They are one category because a reader
 * looking for one expects the other beside it, and two groups because the
 * engines, keys and failure modes are entirely different.
 */

import type { LucideIcon } from 'lucide-preact';
import { Mic, Volume2 } from 'lucide-preact';

export const VOICE_SECTION_IDS = ['dictation', 'speech'] as const;
export type VoiceSectionId = (typeof VOICE_SECTION_IDS)[number];
export type VoiceGroupId = VoiceSectionId;

export interface VoiceSettingGroup {
  id: VoiceGroupId;
  label: string;
  hint: string;
  description: string;
  icon: LucideIcon;
  sections: readonly VoiceSectionId[];
}

export const VOICE_SETTING_GROUPS: readonly VoiceSettingGroup[] = [
  {
    id: 'dictation',
    label: 'Dictation (STT)',
    hint: 'The composer mic and its recognizer',
    description: 'Which engine transcribes the microphone, in which language, and with which key and capture limits.',
    icon: Mic,
    sections: ['dictation'],
  },
  {
    id: 'speech',
    label: 'Speech (TTS)',
    hint: 'Read answers aloud, engine and autoplay',
    description: 'Which engine reads an assistant answer aloud, in which voice, and whether a finished run starts speaking by itself.',
    icon: Volume2,
    sections: ['speech'],
  },
];
