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

/**
 * Deepgram's model id is its voice, so this doubles as the model list.
 *
 * Two generations, told apart by the id's prefix and served on different
 * endpoints: `aura-2-*` on `/v1/speak` (seven languages), `flux-*` on
 * `/v2/speak` (41, Indonesian included). Aura is listed first because it is
 * the engine's default; every Flux entry names its language in the label, and
 * a typed id follows the same `flux-{voice}-{language}` shape.
 */
const AURA_VOICES: readonly TtsModelOption[] = [
  { id: 'aura-2-thalia-en', label: 'Thalia — English (American, female)', hint: 'Default; clear and neutral.' },
  { id: 'aura-2-andromeda-en', label: 'Andromeda — English (American, female)', hint: 'Warm and conversational.' },
  { id: 'aura-2-helena-en', label: 'Helena — English (American, female)', hint: 'Bright and friendly.' },
  { id: 'aura-2-apollo-en', label: 'Apollo — English (American, male)', hint: 'Confident, news-like.' },
  { id: 'aura-2-arcas-en', label: 'Arcas — English (American, male)', hint: 'Calm and steady.' },
  { id: 'aura-2-orion-en', label: 'Orion — English (American, male)', hint: 'Deep and measured.' },
  { id: 'aura-2-zeus-en', label: 'Zeus — English (American, male)', hint: 'Authoritative.' },
  { id: 'aura-2-agustina-es', label: 'Agustina — Spanish (female)', hint: 'Spanish; codeswitches with English.' },
  { id: 'aura-2-alvaro-es', label: 'Alvaro — Spanish (male)', hint: 'Spanish.' },
  { id: 'aura-2-agathe-fr', label: 'Agathe — French (female)', hint: 'French.' },
  { id: 'aura-2-hector-fr', label: 'Hector — French (male)', hint: 'French.' },
  { id: 'aura-2-aurelia-de', label: 'Aurelia — German (female)', hint: 'German.' },
  { id: 'aura-2-julius-de', label: 'Julius — German (male)', hint: 'German.' },
  { id: 'aura-2-cesare-it', label: 'Cesare — Italian (male)', hint: 'Italian.' },
  { id: 'aura-2-livia-it', label: 'Livia — Italian (female)', hint: 'Italian.' },
  { id: 'aura-2-ama-ja', label: 'Ama — Japanese (female)', hint: 'Japanese.' },
  { id: 'aura-2-ebisu-ja', label: 'Ebisu — Japanese (male)', hint: 'Japanese.' },
];

/** Flux TTS: the language is the id's last segment, and no `language` field exists. */
const FLUX_VOICES: readonly TtsModelOption[] = [
  { id: 'flux-haley-en', label: 'Haley — English (American, female)', hint: 'Flux · English.' },
  { id: 'flux-hannah-en', label: 'Hannah — English (American, female)', hint: 'Flux · English.' },
  { id: 'flux-brooke-en', label: 'Brooke — English (American, female)', hint: 'Flux · English.' },
  { id: 'flux-sienna-en', label: 'Sienna — English (American, female)', hint: 'Flux · English.' },
  { id: 'flux-heather-en', label: 'Heather — English (American, female)', hint: 'Flux · English.' },
  { id: 'flux-kit-en', label: 'Kit — English (British, male)', hint: 'Flux · English.' },
  { id: 'flux-colin-en', label: 'Colin — English (British, male)', hint: 'Flux · English.' },
  { id: 'flux-sean-en', label: 'Sean — English (British, male)', hint: 'Flux · English.' },
  { id: 'flux-gemma-en', label: 'Gemma — English (British, female)', hint: 'Flux · English.' },
  { id: 'flux-cole-en', label: 'Cole — English (American, male)', hint: 'Flux · English.' },
  { id: 'flux-cliff-en', label: 'Cliff — English (American, male)', hint: 'Flux · English.' },
  { id: 'flux-miles-en', label: 'Miles — English (American, male)', hint: 'Flux · English.' },
  { id: 'flux-alexis-en', label: 'Alexis — English (American, female)', hint: 'Flux · English.' },
  { id: 'flux-afsana-bn', label: 'Afsana — Bengali (female)', hint: 'Flux · Bengali, early access.' },
  { id: 'flux-mamun-bn', label: 'Mamun — Bengali (male)', hint: 'Flux · Bengali, early access.' },
  { id: 'flux-desislava-bg', label: 'Desislava — Bulgarian (female)', hint: 'Flux · Bulgarian, early access.' },
  { id: 'flux-judit-ca', label: 'Judit — Catalan (female)', hint: 'Flux · Catalan, early access.' },
  { id: 'flux-jordi-ca', label: 'Jordi — Catalan (male)', hint: 'Flux · Catalan, early access.' },
  { id: 'flux-lijuan-zh', label: 'Lijuan — Chinese (female)', hint: 'Flux · Chinese, early access.' },
  { id: 'flux-bo-zh', label: 'Bo — Chinese (male)', hint: 'Flux · Chinese, early access.' },
  { id: 'flux-danijela-hr', label: 'Danijela — Croatian (female)', hint: 'Flux · Croatian, early access.' },
  { id: 'flux-dalibor-hr', label: 'Dalibor — Croatian (male)', hint: 'Flux · Croatian, early access.' },
  { id: 'flux-jakub-cs', label: 'Jakub — Czech (male)', hint: 'Flux · Czech, early access.' },
  { id: 'flux-pernille-da', label: 'Pernille — Danish (female)', hint: 'Flux · Danish, early access.' },
  { id: 'flux-rasmus-da', label: 'Rasmus — Danish (male)', hint: 'Flux · Danish, early access.' },
  { id: 'flux-anouk-nl', label: 'Anouk — Dutch (female)', hint: 'Flux · Dutch.' },
  { id: 'flux-bram-nl', label: 'Bram — Dutch (male)', hint: 'Flux · Dutch.' },
  { id: 'flux-triin-et', label: 'Triin — Estonian (female)', hint: 'Flux · Estonian, early access.' },
  { id: 'flux-kirsi-fi', label: 'Kirsi — Finnish (female)', hint: 'Flux · Finnish, early access.' },
  { id: 'flux-teemu-fi', label: 'Teemu — Finnish (male)', hint: 'Flux · Finnish, early access.' },
  { id: 'flux-brigitte-fr', label: 'Brigitte — French (female)', hint: 'Flux · French.' },
  { id: 'flux-arnaud-fr', label: 'Arnaud — French (male)', hint: 'Flux · French.' },
  { id: 'flux-janine-de', label: 'Janine — German (female)', hint: 'Flux · German.' },
  { id: 'flux-benjamin-de', label: 'Benjamin — German (male)', hint: 'Flux · German.' },
  { id: 'flux-kostas-el', label: 'Kostas — Greek (male)', hint: 'Flux · Greek, early access.' },
  { id: 'flux-bhavna-gu', label: 'Bhavna — Gujarati (female)', hint: 'Flux · Gujarati, early access.' },
  { id: 'flux-jignesh-gu', label: 'Jignesh — Gujarati (male)', hint: 'Flux · Gujarati, early access.' },
  { id: 'flux-anjali-hi', label: 'Anjali — Hindi (female)', hint: 'Flux · Hindi.' },
  { id: 'flux-ajay-hi', label: 'Ajay — Hindi (male)', hint: 'Flux · Hindi.' },
  { id: 'flux-eszter-hu', label: 'Eszter — Hungarian (female)', hint: 'Flux · Hungarian, early access.' },
  { id: 'flux-bence-hu', label: 'Bence — Hungarian (male)', hint: 'Flux · Hungarian, early access.' },
  { id: 'flux-dewi-id', label: 'Dewi — Indonesian (female)', hint: 'Flux · Indonesian; recommended for Bahasa.' },
  { id: 'flux-fajar-id', label: 'Fajar — Indonesian (male)', hint: 'Flux · Indonesian.' },
  { id: 'flux-fitri-id', label: 'Fitri — Indonesian (female)', hint: 'Flux · Indonesian.' },
  { id: 'flux-rizky-id', label: 'Rizky — Indonesian (male)', hint: 'Flux · Indonesian.' },
  { id: 'flux-teguh-id', label: 'Teguh — Indonesian (male)', hint: 'Flux · Indonesian.' },
  { id: 'flux-angela-it', label: 'Angela — Italian (female)', hint: 'Flux · Italian.' },
  { id: 'flux-federico-it', label: 'Federico — Italian (male)', hint: 'Flux · Italian.' },
  { id: 'flux-ayumi-ja', label: 'Ayumi — Japanese (female)', hint: 'Flux · Japanese.' },
  { id: 'flux-hayato-ja', label: 'Hayato — Japanese (male)', hint: 'Flux · Japanese.' },
  { id: 'flux-manjunath-kn', label: 'Manjunath — Kannada (male)', hint: 'Flux · Kannada, early access.' },
  { id: 'flux-eunji-ko', label: 'Eunji — Korean (female)', hint: 'Flux · Korean, early access.' },
  { id: 'flux-hyunwoo-ko', label: 'Hyunwoo — Korean (male)', hint: 'Flux · Korean, early access.' },
  { id: 'flux-agnese-lv', label: 'Agnese — Latvian (female)', hint: 'Flux · Latvian, early access.' },
  { id: 'flux-edgars-lv', label: 'Edgars — Latvian (male)', hint: 'Flux · Latvian, early access.' },
  { id: 'flux-goda-lt', label: 'Goda — Lithuanian (female)', hint: 'Flux · Lithuanian, early access.' },
  { id: 'flux-izzah-ms', label: 'Izzah — Malay (female)', hint: 'Flux · Malay, early access.' },
  { id: 'flux-haziq-ms', label: 'Haziq — Malay (male)', hint: 'Flux · Malay, early access.' },
  { id: 'flux-pooja-mr', label: 'Pooja — Marathi (female)', hint: 'Flux · Marathi, early access.' },
  { id: 'flux-pratik-mr', label: 'Pratik — Marathi (male)', hint: 'Flux · Marathi, early access.' },
  { id: 'flux-ida-no', label: 'Ida — Norwegian (female)', hint: 'Flux · Norwegian, early access.' },
  { id: 'flux-erlend-no', label: 'Erlend — Norwegian (male)', hint: 'Flux · Norwegian, early access.' },
  { id: 'flux-ewa-pl', label: 'Ewa — Polish (female)', hint: 'Flux · Polish, early access.' },
  { id: 'flux-bartosz-pl', label: 'Bartosz — Polish (male)', hint: 'Flux · Polish, early access.' },
  { id: 'flux-bianca-pt', label: 'Bianca — Portuguese (female)', hint: 'Flux · Portuguese.' },
  { id: 'flux-bruno-pt', label: 'Bruno — Portuguese (male)', hint: 'Flux · Portuguese.' },
  { id: 'flux-ioana-ro', label: 'Ioana — Romanian (female)', hint: 'Flux · Romanian, early access.' },
  { id: 'flux-cosmin-ro', label: 'Cosmin — Romanian (male)', hint: 'Flux · Romanian, early access.' },
  { id: 'flux-natalia-ru', label: 'Natalia — Russian (female)', hint: 'Flux · Russian.' },
  { id: 'flux-andrei-ru', label: 'Andrei — Russian (male)', hint: 'Flux · Russian.' },
  { id: 'flux-dominika-sk', label: 'Dominika — Slovak (female)', hint: 'Flux · Slovak, early access.' },
  { id: 'flux-juraj-sk', label: 'Juraj — Slovak (male)', hint: 'Flux · Slovak, early access.' },
  { id: 'flux-katja-sl', label: 'Katja — Slovenian (female)', hint: 'Flux · Slovenian, early access.' },
  { id: 'flux-gregor-sl', label: 'Gregor — Slovenian (male)', hint: 'Flux · Slovenian, early access.' },
  { id: 'flux-aina-es', label: 'Aina — Spanish (female)', hint: 'Flux · Spanish.' },
  { id: 'flux-alfredo-es', label: 'Alfredo — Spanish (male)', hint: 'Flux · Spanish.' },
  { id: 'flux-charlotta-sv', label: 'Charlotta — Swedish (female)', hint: 'Flux · Swedish, early access.' },
  { id: 'flux-axel-sv', label: 'Axel — Swedish (male)', hint: 'Flux · Swedish, early access.' },
  { id: 'flux-liezel-tl', label: 'Liezel — Tagalog (female)', hint: 'Flux · Tagalog, early access.' },
  { id: 'flux-jerome-tl', label: 'Jerome — Tagalog (male)', hint: 'Flux · Tagalog, early access.' },
  { id: 'flux-kavya-ta', label: 'Kavya — Tamil (female)', hint: 'Flux · Tamil, early access.' },
  { id: 'flux-gokul-ta', label: 'Gokul — Tamil (male)', hint: 'Flux · Tamil, early access.' },
  { id: 'flux-sravani-te', label: 'Sravani — Telugu (female)', hint: 'Flux · Telugu, early access.' },
  { id: 'flux-pavan-te', label: 'Pavan — Telugu (male)', hint: 'Flux · Telugu, early access.' },
  { id: 'flux-dilek-tr', label: 'Dilek — Turkish (female)', hint: 'Flux · Turkish, early access.' },
  { id: 'flux-emre-tr', label: 'Emre — Turkish (male)', hint: 'Flux · Turkish, early access.' },
  { id: 'flux-solomiya-uk', label: 'Solomiya — Ukrainian (female)', hint: 'Flux · Ukrainian, early access.' },
  { id: 'flux-denys-uk', label: 'Denys — Ukrainian (male)', hint: 'Flux · Ukrainian, early access.' },
  { id: 'flux-ambreen-ur', label: 'Ambreen — Urdu (female)', hint: 'Flux · Urdu, early access.' },
  { id: 'flux-usman-ur', label: 'Usman — Urdu (male)', hint: 'Flux · Urdu, early access.' },
  { id: 'flux-hoa-vi', label: 'Hoa — Vietnamese (female)', hint: 'Flux · Vietnamese, early access.' },
  { id: 'flux-minh-vi', label: 'Minh — Vietnamese (male)', hint: 'Flux · Vietnamese, early access.' },
];

export const DEEPGRAM_VOICES: readonly TtsModelOption[] = [...AURA_VOICES, ...FLUX_VOICES];

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
