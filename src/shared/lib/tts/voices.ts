/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The voice catalogs each speech engine offers.
 *
 * Split out of `engines.ts` when the Gemini list pushed that file past the
 * 350-line ceiling. The type-only import keeps this a leaf at runtime: the
 * engine table imports these arrays, and these arrays import nothing but
 * types.
 */

import type { TtsModelOption, TtsVoiceOption } from '@/shared/lib/tts/engines';

export const OPENAI_VOICES: readonly TtsVoiceOption[] = [
  { id: 'marin', label: 'Marin (recommended)' },
  { id: 'cedar', label: 'Cedar (recommended)' },
  { id: 'alloy', label: 'Alloy' },
  { id: 'ash', label: 'Ash' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'coral', label: 'Coral' },
  { id: 'echo', label: 'Echo' },
  { id: 'fable', label: 'Fable' },
  { id: 'nova', label: 'Nova' },
  { id: 'onyx', label: 'Onyx' },
  { id: 'sage', label: 'Sage' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'verse', label: 'Verse' },
];

export const ELEVENLABS_VOICES: readonly TtsVoiceOption[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (public)' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (public)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (public)' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George (public)' },
];

/** Deepgram's model id is its voice, so this doubles as the model list. */
export const DEEPGRAM_VOICES: readonly TtsModelOption[] = [
  { id: 'aura-2-thalia-en', label: 'Thalia (American female)', hint: 'Default; clear and neutral.' },
  { id: 'aura-2-andromeda-en', label: 'Andromeda (American female)', hint: 'Warm and conversational.' },
  { id: 'aura-2-helena-en', label: 'Helena (American female)', hint: 'Bright and friendly.' },
  { id: 'aura-2-apollo-en', label: 'Apollo (American male)', hint: 'Confident, news-like.' },
  { id: 'aura-2-arcas-en', label: 'Arcas (American male)', hint: 'Calm and steady.' },
  { id: 'aura-2-orion-en', label: 'Orion (American male)', hint: 'Deep and measured.' },
  { id: 'aura-2-zeus-en', label: 'Zeus (American male)', hint: 'Authoritative.' },
  { id: 'aura-2-agustina-es', label: 'Agustina (Spanish female)', hint: 'Spanish.' },
  { id: 'aura-2-alvaro-es', label: 'Alvaro (Spanish male)', hint: 'Spanish.' },
  { id: 'aura-2-agathe-fr', label: 'Agathe (French female)', hint: 'French.' },
  { id: 'aura-2-hector-fr', label: 'Hector (French male)', hint: 'French.' },
  { id: 'aura-2-aurelia-de', label: 'Aurelia (German female)', hint: 'German.' },
  { id: 'aura-2-julius-de', label: 'Julius (German male)', hint: 'German.' },
  { id: 'aura-2-cesare-it', label: 'Cesare (Italian male)', hint: 'Italian.' },
  { id: 'aura-2-livia-it', label: 'Livia (Italian female)', hint: 'Italian.' },
  { id: 'aura-2-ama-ja', label: 'Ama (Japanese female)', hint: 'Japanese.' },
  { id: 'aura-2-ebisu-ja', label: 'Ebisu (Japanese male)', hint: 'Japanese.' },
];

export const XAI_VOICES: readonly TtsVoiceOption[] = [
  { id: 'eve', label: 'Eve (default)' },
  { id: 'ara', label: 'Ara' },
];

/** Gemini's 30 prebuilt studio voices; a typed `voice_...` id also works. */
export const GEMINI_VOICES: readonly TtsVoiceOption[] = [
  { id: 'Kore', label: 'Kore (firm)' },
  { id: 'Puck', label: 'Puck (upbeat)' },
  { id: 'Charon', label: 'Charon (informative)' },
  { id: 'Zephyr', label: 'Zephyr (bright)' },
  { id: 'Fenrir', label: 'Fenrir (excitable)' },
  { id: 'Leda', label: 'Leda (youthful)' },
  { id: 'Orus', label: 'Orus (firm)' },
  { id: 'Aoede', label: 'Aoede (breezy)' },
  { id: 'Callirrhoe', label: 'Callirrhoe (easy-going)' },
  { id: 'Autonoe', label: 'Autonoe (bright)' },
  { id: 'Enceladus', label: 'Enceladus (breathy)' },
  { id: 'Iapetus', label: 'Iapetus (clear)' },
  { id: 'Umbriel', label: 'Umbriel (easy-going)' },
  { id: 'Algieba', label: 'Algieba (smooth)' },
  { id: 'Despina', label: 'Despina (smooth)' },
  { id: 'Erinome', label: 'Erinome (clear)' },
  { id: 'Algenib', label: 'Algenib (gravelly)' },
  { id: 'Rasalgethi', label: 'Rasalgethi (informative)' },
  { id: 'Laomedeia', label: 'Laomedeia (upbeat)' },
  { id: 'Achernar', label: 'Achernar (soft)' },
  { id: 'Alnilam', label: 'Alnilam (firm)' },
  { id: 'Schedar', label: 'Schedar (even)' },
  { id: 'Gacrux', label: 'Gacrux (mature)' },
  { id: 'Pulcherrima', label: 'Pulcherrima (forward)' },
  { id: 'Achird', label: 'Achird (friendly)' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi (casual)' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix (gentle)' },
  { id: 'Sadachbia', label: 'Sadachbia (lively)' },
  { id: 'Sadaltager', label: 'Sadaltager (knowledgeable)' },
  { id: 'Sulafat', label: 'Sulafat (warm)' },
];
