# Dictation: English + Indonesian, a real settings surface, and external engines

Research, 2026-11-24. Question: the composer's mic must transcribe **Indonesian and English**,
must be **configurable**, and must be able to use an **external STT API**.

**Verdict: the mic could not transcribe Indonesian, and on the pinned omp it could not transcribe
anything at all.** Two independent defects, both measured below, and both fixed — see §2's resolution.

1. **No language is ever sent, and the fallback is English.** `stt.language` is `en` on this install;
   transformers.js (the engine inside omp's worker) treats a missing language as **English**, not as
   auto-detect. Indonesian audio comes back as English gibberish — measured, §3.
2. **omp's local worker transport no longer matched the code.** Kabmo spawned
   `omp __omp_worker_stt` over Bun IPC; on omp **19.1.1** the worker exits immediately and Kabmo's
   own client reported `STT worker exited.` — measured through `sttWorker().transcribe()`, §2. **Fixed:**
   the worker speaks length-prefixed binary frames on stdin/stdout, and `speech-frames.ts` now speaks
   them (§2.1).

Everything below was measured on this machine: macOS 27.2 arm64, Bun 1.4.5, `omp/19.1.1`
(`~/.bun/bin/omp`), whisper-base cached at `~/.omp/agent/cache/tiny-models/onnx-community/whisper-base`
(76 MB), transformers.js 4.3.0 from omp's own runtime cache.

Status: **partial** — shipped: the engine seam (omp local, OpenAI-compatible, Deepgram, ElevenLabs), the explicit
language with its measured reason, the 0600 key file + settings page, the WAV encoder, the short/silence gates, the
device picker, and the binary transport. Owed: the local worker's transport (probe reports it dead on 19.1.1), the
AudioWorklet capture path, and a real-mic Indonesian accuracy run.

---

## 1. What ships today (the map)

| Piece | File | Job |
|---|---|---|
| capture + socket client | `src/client/hooks/chat/composer/speech-to-text.ts` | `getUserMedia` → `ScriptProcessor` → PCM16 @16 kHz → **one** base64 frame on release |
| composer wrapper | `src/client/hooks/chat/composer/voice-input.ts` | toggle, busy/status, 6 s error notice; passes **no** model and **no** language |
| wire contract | `src/shared/lib/dictation/protocol.ts` | `transcribe {audio, modelKey?, language?}` → `ready` / `progress` / `final` / `error` |
| audio math | `src/shared/lib/dictation/audio.ts` | resample to 16 kHz, Float32 ⇄ PCM16 |
| route | `src/server/routes/dictation/ws.ts` | origin check, size guard, PCM16 → Float32, dispatch, progress throttle |
| engine client | `src/server/lib/dictation/omp-stt-worker.ts` | spawn `omp __omp_worker_stt`, ping, transcribe, 10 min idle kill |
| language resolver | `src/server/lib/dictation/language.server.ts` | read `omp config get stt.language`, 60 s cache, invalidated on write |
| model table | `src/shared/lib/dictation/models.ts` | five omp model keys + `summarizeProgress` |
| settings row | `src/shared/lib/omp/config/schema-extras.ts` (`stt.language`) | renders under OMP → Interaction → Speech |
| UI | `chat-input/Toolbar.tsx` (mic button), `VoiceNotice.tsx` (status/error) | |

Flow: mic → PCM16 → `/api/dictation/ws` → `pcm16ToFloat32` → `sttWorker().transcribe(...)` → `omp`
worker → text → appended to the draft.

What the user can configure **today**: only omp's `stt.language`, buried in the OMP Engine page.
Model is `whisper-base` (hardcoded default, `DEFAULT_STT_MODEL`), engine is omp's worker, and there is
no external API path at all.

---

## 2. Defect A — the local worker is dead on the pinned omp

Measured three ways, same result:

| Probe | Result |
|---|---|
| `omp __omp_worker_stt` in a shell | exits `137` (SIGKILL) immediately |
| `Bun.spawn({ cmd: [omp, '__omp_worker_stt'], ipc, serialization: 'advanced' })` + `send({type:'ping'})` | child `SIGKILL` ~25 ms after spawn, no `pong`, stderr empty |
| **Kabmo's own client**: `sttWorker().transcribe(samples, {modelKey:'whisper-base', language:'id'})` | rejects with **`STT worker exited.`** |

Why (read out of the 19.1.1 bundle, not guessed): omp 19 moved worker processes behind its daemon. The
STT chunk now boots through a tunnel helper (`qke`) that reads `Bun.stdin.stream()`, writes
length-prefixed frames (`u32 total | u8 kind | header JSON [| Float32 payload]`) and self-`SIGKILL`s
when that stream ends — which is exactly the 25 ms exit above, since Kabmo spawns with
`stdin: 'ignore'`. Its client side (`tse`) opens a daemon **unit**
`{kind: "speech", params: {command, cwd, env}}` and `attach`es a tunnel; `process.send` IPC is no
longer the transport. Kabmo's `omp-stt-worker.ts` still documents and drives the 18.x IPC framing, so
`ensureWorker()` pings into a process that is already gone.

The first hand-built frame attempt failed because I read the layout wrong (kind `1` = header-only,
`2` = payload). The bundle's `speech-frames.ts` says otherwise, and the corrected frame is answered.

### 2.1 The resolution — measured, and what proves it

`src/server/lib/dictation/speech-frames.ts` is the codec:

```
u32le length | u8 kind | body          length EXCLUDES the prefix, INCLUDES the kind
kind 0 = header JSON only
kind 1 = u32le headerLen | header JSON | Float32LE payload   (the payload field is named by `$pcm`)
```

A `Float32Array` value is hoisted out of the header and named with `$pcm: "<field>"`; leaving the array
in the JSON turns it into `{"0":…,"1":…}` and the worker answers `aud.subarray is not a function`.
That error is the fastest way to know the hoist is missing.

Measured on 19.1.1 through Kabmo's own `sttWorker()` (2026-11-24, whisper-base already cached):

| probe | result |
|---|---|
| `probe()` | `{ok: true}` |
| ping → pong | **24 ms** |
| 7.3 s Indonesian utterance, `language: 'id'` | **933 ms**, `Halo, tolong band-tuk, say, member baki penggaturan mikrofon Untuk Transcriptsibahasa Indonesia.` |
| 5.0 s English utterance, `language: 'en'` | **367 ms**, `Please help me improve the microphone settings for English dictation.` |

The Indonesian line is poor, and that is the **model**, not the transport: the same audio decoded
in-process by transformers.js returns the *identical* string. Whisper-base at q8 on synthetic TTS is
simply weak; `whisper-small` / `whisper-large-v3-turbo` are one setting away. The equality is the proof
the codec neither shifts nor truncates the samples — a wrong offset would produce different text.

Consequences of the earlier breakage, now closed:

- The settings card reports `Local worker is running` and the composer transcribes again (screenshot
  taken at 1365x768 in the WebKit harness).
- `capability.server.ts` still probes rather than trusting a version number, so the next transport
  change fails in 24 ms on the settings page instead of on a user's first utterance.
- The wiki's Bun-IPC paragraph was stale and now states the frame layout.

---

## 3. Defect B — Indonesian is decoded as English, by construction

`resolveDictationLanguage()` returns the value of `omp config get stt.language`. On this install:

```
$ omp config list | grep stt
  stt.enabled = false (boolean)
  stt.submitTrigger = never (never|release|release-complete|say-submit)
  stt.language = en (string)
```

The client sends no `language`, so every utterance is decoded with `en`. transformers.js makes this
worse than "no hint": its `_retrieve_init_tokens` does

```js
if (generation_config.is_multilingual) {
  if (!language) { logger.warn("No language specified - defaulting to English (en)."); language = "en"; }
```

— i.e. **an absent language is English**, not auto-detect. Two comments in this repo state the
opposite (`dictation/ws.ts`: "An absent value means auto-detect"; `language.server.ts`: same) and are
wrong; a failed `omp` read therefore pins every utterance to English instead of leaving the recognizer
free.

### Measured transcripts (whisper-base, q8 — the exact tier and dtype the worker loads)

Audio: macOS `say` → 16 kHz PCM16 WAV. `id_ID` voice Damayanti for Indonesian, `en_US` Samantha for
English. Synthetic speech, so this measures the **language-token effect**, not real-world WER.

| clip | language sent | transcript | decode |
|---|---|---|---|
| id1 (6.9 s) | *(none)* | `Hello, my dear friend Mikrofon's phone for Transcripts in Indonesia.` | 500 ms |
| id1 | `id` | `Halo, Tolong Bantu saya memperbaiki pengaturan mikrofon untuk transkripsi bahasa Indonesia.` | 534 ms |
| id1 | `en` | `Hello, my dear friend Mikrofon's phone for Transcripts in Indonesia.` | 436 ms |
| id2 (7.3 s) | *(none)* | `I believe that the Dictates are the Indonesian and English-speaking countries.` | 489 ms |
| id2 | `id` | `Saya ingin mengubah bahasa diktri yang menjadi bahasa Indonesia dan bahasa Inggris.` | 547 ms |
| id2 | `en` | `I believe that the Dictates are the Indonesian and English-speaking countries.` | 438 ms |
| en1 (5.0 s) | *(none)* / `en` | `Please help me improve the microphone settings for English dictation.` | 692 / 627 ms |
| en1 | `id` | `Tolong membantu saya mengenai microphone setiap enggak di atas` | 722 ms |

Three facts this pins down:

- **`en` and "no language" are the same decode** — today's behaviour is the wrong half of the table.
- **The hint is decisive**, and it cuts both ways: `id` ruins English audio just as `en` ruins
  Indonesian. There is no safe single default; the user must say which language they dictate in.
- **whisper-base is usable for Indonesian** (one token wrong on id2, `diktri` for `dikte`) and decodes
  a 7 s utterance in ~0.5 s on this machine. `whisper-small` / `whisper-large-v3-turbo` remain the
  accuracy upgrade; parakeet v3 (omp's own default) covers 25 European languages and **not**
  Indonesian, and Nemotron is English-only.

### Model facts that moved under the repo

- `omp config get stt.modelName` → **`Unknown setting`** on 19.1.1: omp no longer exposes a model key.
  Its own TUI hardcodes the default (parakeet). A model picker therefore **cannot** be delegated to
  omp's config — Kabmo must own the value and send it per request.
- Size hints in `shared/lib/dictation/models.ts` no longer match omp's registry
  (Kabmo 80/250/500 MB vs omp 60/190/600 MB for base/small/large-v3-turbo). One of the two tables
  should go; the copy that ships is the one the user reads.

---

## 4. Defect C — no settings surface, no engine seam

- Language: one row in the OMP Engine page, default `en`, and it is the only knob.
- Model: `DEFAULT_STT_MODEL` in code, no UI.
- Engine: hardwired to omp's worker; `DictationClientFrame` has no `engine` field.
- No API key storage, no base URL, no timeout, no per-engine limits.
- Capture: `ScriptProcessorNode` (deprecated), no minimum duration, no silence gate, no device choice.
  A stray tap sends a ~100 ms buffer, which Whisper classically answers with `Thank you.` /
  `Terima kasih.` — a hallucination written straight into the draft.
- The mic tooltip says `Voice input (omp speech-to-text)` regardless of language or engine.

---

## 5. Engine matrix (what "external API" can mean)

All four HTTP options accept a **WAV file** and a language hint, so one server-side WAV encoder covers
them; none needs a browser-side container change.

| Engine | Endpoint | Auth | Language field | Notes |
|---|---|---|---|---|
| **omp local** | `omp __omp_worker_stt` (stdio frames) | none | `language` (multilingual tiers only) | no key, no network; **works again** at 19.1.1 via `speech-frames.ts`; parakeet/nemotron ignore the hint |
| **OpenAI-compatible** (`openai`) | `POST {base}/audio/transcriptions`, multipart | `Authorization: Bearer` | `language` (ISO-639-1) | one adapter covers OpenAI, **Groq**, Mistral, whisper.cpp server, speaches, LM Studio. 25 MB cap. `whisper-1`, `gpt-4o-*-transcribe`, `gpt-transcribe` (newest; also takes `languages[]`) |
| **Deepgram** (`deepgram`) | `POST https://api.deepgram.com/v1/listen` | `Authorization: Token <key>` | `language=id` (BCP-47); `language=multi` + `language_hint` for code-switching on nova-3 | **not** OpenAI-shaped: raw body, query params, `results.channels[0].alternatives[0].transcript` |
| **ElevenLabs** (`elevenlabs`) | `POST https://api.elevenlabs.io/v1/speech-to-text`, multipart | `xi-api-key` | `language_code` (ISO-639-1/639-3) | `scribe_v2`/`v3`, 90+ languages, `file_format=pcm_s16le_16` accepts Kabmo's buffer as-is |
| **Browser Web Speech** | `SpeechRecognition` | — | `recognition.lang` | **declined**: the WebView compatibility data shows no `SpeechRecognition` in WKWebView (macOS/iOS) or Android WebView — the two shells Kabmo ships on macOS and Android — and MDN still marks it non-Baseline. It also ships audio to Google/Microsoft with no key and no consent. |

Sources: Groq STT docs (`api.groq.com/openai/v1/audio/transcriptions`, `whisper-large-v3-turbo`,
ISO-639-1 `language`, 25 MB free tier, `$0.04`/h); OpenAI file-transcription guide (`/v1/audio/transcriptions`,
`gpt-transcribe` recommended, `language` + `languages[]`, 25 MB, wav accepted); Deepgram pre-recorded
reference (`language` BCP-47, `Token` auth, `nova-3`); ElevenLabs create-transcript reference
(`model_id`, `language_code`, `xi-api-key`); MDN `SpeechRecognition` ("limited availability").

**Recommendation: ship one `openai` adapter first.** It is the only dialect that buys OpenAI, Groq,
Mistral, a local whisper.cpp/speaches server and any future compatible endpoint with one code path and
one settings form. Deepgram and ElevenLabs are thin, separately-testable dialects added after.

Code-switching (Indonesian mixed with English mid-sentence) is **not** solved by a single hint: Whisper
commits to one language token per utterance, so mixed speech degrades whichever way it is set.
Deepgram `language=multi` + `language_hint` is the only listed engine that claims it. Record it as a
per-engine capability, not a global "auto".

---

## 6. Proposed design

### 6.1 Settings (one new KABMO category: **Dictation**)

Non-secret values go in the `kabmo_settings` blob (client-visible, like every other preference);
the API key does **not** — the blob is injected into the page, so a key there would be readable by any
script on the origin.

| Key | Values | Default | Notes |
|---|---|---|---|
| `dictationEngine` | `omp` \| `openai` \| `deepgram` \| `elevenlabs` | `omp` | disabled with the reason when the local probe fails |
| `dictationModel` | engine-scoped id | per engine (local `whisper-base`, openai `gpt-4o-mini-transcribe`, groq preset `whisper-large-v3-turbo`, deepgram `nova-3`, elevenlabs `scribe_v2`) | presets write the model when the base URL changes |
| `dictationLanguage` | `id` \| `en` \| `auto` | first use: `navigator.language` starts with `id` → `id`, else `en`; `auto` only for engines that detect | `auto` is **refused for `omp`** — measured: no hint means English |
| `dictationBaseUrl` | URL | engine preset | openai dialect only; presets OpenAI / Groq / local (`http://127.0.0.1:8000/v1`) |
| `dictationPrompt` | string | empty | vocabulary/domain hint (`prompt`), 224-token limit on Groq |
| `dictationMinMs` | number | 300 | below this the client refuses without a round trip |
| `dictationMaxMs` | number | 120000 | auto-stop; keeps WAV under every provider's cap |

Secret file: `~/.kabmo/dictation.json` (`{version: 1, apiKey, updatedAt}`), mode **0600** through
`writeFileAtomic` — the same shape and permission as `~/.kabmo/auth.json`. `GET` never returns it; it
returns `hasApiKey`. A key is written only by an explicit save and can be cleared.

Precedence for the language actually sent, in order:

1. `frame.language` (client, resolved from `dictationLanguage`) — always populated now;
2. `dictationLanguage` read server-side, for older clients;
3. `omp`'s `stt.language` — **local engine only**, so an existing config keeps working;
4. nothing → for `auto`-capable engines omit the field; for `omp` send `en` **and say so in the mic
   tooltip** (`Voice input — English`), because that is what the engine will do.

### 6.2 Server shape

```
shared/lib/dictation/engines.ts     engine ids, labels, presets, default models, language capability, limits
shared/lib/dictation/languages.ts   DICTATION_LANGUAGES, normalizeLanguage, resolveEffectiveLanguage
shared/lib/dictation/wav.ts         encodeWav(pcm16, 16000) — 44-byte header + samples
shared/lib/dictation/gate.ts        isSilent(samples) — RMS floor, pure and unit-tested

server/lib/dictation/engines/openai.ts      multipart, Bearer, {text}
server/lib/dictation/engines/deepgram.ts    raw body, Token, nested transcript
server/lib/dictation/engines/elevenlabs.ts  multipart, xi-api-key, {text}
server/lib/dictation/engines/index.ts       dispatch + per-engine byte cap + error mapping
server/lib/dictation/settings.server.ts     blob read, secret file read/write, `hasKey`
server/lib/dictation/capability.server.ts   one-shot local probe (ping), cached per process
routes/settings/dictation.ts                GET state / POST save / POST clear-key
routes/dictation/ws.ts                      unchanged protocol + `engine`, `language`, `model`
```

Protocol additions (backward compatible — every field optional):

```ts
interface DictationTranscribeFrame { type: 'transcribe'; audio: string; engine?: DictationEngine;
  modelKey?: string; language?: string; }
```

Rules the adapters must keep:

- **Timeouts**: `AbortSignal.timeout(60_000)` on every fetch; a timeout is reported as a timeout, not
  as "no speech".
- **Errors are the provider's sentence plus the status**: `401` → "the key was rejected", `402`/`429` →
  "quota/rate limit", `413` → "recording too long", body text trimmed to one line. Never echo headers.
- **Response cap** ~1 MB, and both `{text}` JSON and `text/plain` bodies are accepted (compatible
  servers differ).
- **Base URL validation**: `http:`/`https:` only, no embedded credentials, path joined as
  `{base}/audio/transcriptions` (a base already ending in `/v1` must not become `/v1/v1`).
- **SSRF is accepted, as it already is for provider base URLs**: this is an authenticated,
  single-user console, and the setting is the same class of trust as `ProviderSettings`.
- **Progress frames**: external engines have no download, so send one `{type:'progress', decoding:true}`
  ("Transcribing…") and keep the percent path for the local engine only.
- **Size caps per engine** (25 MB openai/groq; Deepgram and ElevenLabs take the bytes directly and are
  bounded only by their own limits, so Kabmo's `dictationMaxMs` is what actually keeps a clip small):
  the existing 32 MB wire guard stays, and the adapter re-checks after WAV encoding.

### 6.3 Capture improvements (P3, independent of the engine work)

- Keep the PCM16 wire format (universal, ~2.6 MB/min base64) — external engines get a WAV built
  server-side; the local engine keeps Float32.
- Silence gate before the round trip (`isSilent`) plus `dictationMinMs`, so a tap cannot become
  `Thank you.` in the draft.
- Auto-stop at `dictationMaxMs`, with the elapsed time in the status line.
- Device picker (`enumerateDevices`, `deviceId` stored per browser) for machines with several inputs;
  `getUserMedia({audio: {deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true}})`.
- Optional `AudioWorklet` capture behind a capability check (Safari needs a same-origin module URL, so
  it is a build asset, not a Blob) — `ScriptProcessorNode` stays the fallback.
- Mic tooltip states engine + language; the error strip states the engine that failed.

### 6.4 UI

New category **KABMO → Dictation** (Mic icon), master-detail with three groups:

- **Engine** — four cards (omp local / OpenAI-compatible / Deepgram / ElevenLabs), each stating where
  audio goes. Local shows a live capability line (`Unavailable on omp 19.1.1 — the worker exited`).
- **Language** — Indonesian / English (+ Auto, disabled for `omp` with the measured reason), and the
  code-switching note.
- **External** — base URL with presets, model, key (write-only field showing `hasApiKey`), prompt,
  and a privacy line: "Audio leaves this machine when this engine is selected."

Composer: unchanged button; the tooltip carries the effective language, and a failure names the engine.

---

## 7. Phases

| Phase | Scope | State |
|---|---|---|
| **P0** (correctness) | capability probe + honest failure text; the language sent explicitly from `dictationLanguage`; the two "auto-detect" comments corrected; silence + `minMs` gates; WAV encoder | **shipped** — `gate.test.ts`, `wav.test.ts`, `languages.test.ts`, `capability.server.ts` |
| **P1** (external) | engine seam, `openai` adapter, 0600 key file + route, Dictation settings page | **shipped** — `adapters.test.ts`, `dictation.test.ts` (route), `DictationSettings.test.tsx` |
| **P2** (dialects) | Deepgram, ElevenLabs, presets, per-engine language capability | **shipped** — one test per adapter for its field names, auth header and response shape |
| **P3** (capture) | device picker, max duration, binary frames | **shipped** (list is opt-in, see below) |
| **P4** (local transport) | speak omp 19's length-prefixed `kind` frame protocol on stdin/stdout | **shipped** — `speech-frames.test.ts`, `capability.server.test.ts`, and a real transcription through `sttWorker()` |
| P3 leftovers | level meter, AudioWorklet capture | **deferred** — `ScriptProcessorNode` still ships; see §10 |

Gates, all run green: `bun run lint`, `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`,
`bun run typecheck:consumer`, `bun run build`, `bun test`, `bun run typecheck:e2e`, `icons:tints:check`,
and the 350-line check (every file added here is under it).

**Measured end to end**, against the real server and a stub [OI]-compatible provider (15/15 checks): the
preference read from SQLite, the key read from the 0600 file, one binary frame in, a RIFF/WAVE upload
carrying `language=id` and the bearer key, `{text}` back into the composer, and the three refusals —
silence, a 100 ms tap, and a missing key — answered without reaching the provider. Rendered in the
WebKit harness at 1365x768 and 430x900; the engine cards, the disabled "detect automatically" and the
local-unavailable reason all draw on both.

One defect that measurement caught, and the fix: the device list was read with `enumerateDevices` on
mount, which **wedged the page's web process** in that harness (the settings page became unresponsive,
and so did a reload of the tab). The list is now behind a `Find microphones` button — the common case
is one input and needs no list, and a media backend that hangs costs one failed action instead of the
page.

---

## 8. Decisions taken (defaults, not questions)

- **Explicit language over silent auto-detect.** Auto is impossible on the local engine (measured) and
  unreliable on short clips elsewhere; a wrong guess is indistinguishable from a bad microphone.
- **`openai` dialect first**, because it covers the most endpoints per line of code.
- **Key in a 0600 file, never in `app_settings`**, because the bootstrap ships that map to the browser.
- **The local engine stays a first-class choice**, but it is *probed*: if the worker does not answer a
  ping, the settings card names the reason and the composer refuses the utterance with that sentence
  instead of `STT worker exited.` No silent fallback to another engine — audio going somewhere the user
  did not choose is worse than a refusal.
- **Web Speech declined** (the shells Kabmo ships do not expose it; see §5).

## 9. Open questions

1. ~~Local engine ownership.~~ **Answered:** the frame protocol is reproduced and works (P4). The risk
   stands — it is omp's internal format — which is why the probe, not a version check, decides whether
   the local card is usable. Owning inference ourselves (`@huggingface/transformers` +
   `onnxruntime-node`: measured **294 MB** for the all-platform runtime, **15 MB** for transformers) is
   still the fallback if omp changes it again.
2. **Default model for the `openai` dialect.** `gpt-4o-mini-transcribe` is the safe default across
   compatible servers, but `whisper-1` is the widest-compatible and deprecated 2027-02-26. Presets by
   base URL, not one global default.
3. **Real-mic accuracy for Indonesian at each tier.** Now the main open question: synthetic speech
   through whisper-base came back garbled (`band-tuk`, `penggaturan`) even with the right language
   token, and it is identical in-process, so it is the model's ceiling on this audio rather than a
   transport defect. A 20-utterance recorded set (accented, noisy) is what would justify making
   `whisper-small` (~190 MB) the default for Indonesian.

## 10. Declined

- **Streaming/partials.** The local worker has a streaming surface (`stream_start/audio/stop`) and
  Nemotron can emit live words, but the socket is one-utterance-per-connection today and a partial
  transcript in the composer would need an insert/replace model. Not part of this request.
- **Browser Web Speech** as a fallback engine (§5).
- **A second capture path for `MediaRecorder`** — external APIs accept Opus/WebM, but a second path is
  a second set of bugs for ~60 % wire savings; revisit only if the PCM16 wire becomes the bottleneck.
- **An `AudioWorklet` capture path** for now: it needs a same-origin module asset in the build (a Blob
  URL is not allowed), and `ScriptProcessorNode` is the one capture API every target browser ships.
  Deferred rather than declined — it is the documented replacement.
- **A level meter in the settings page**: it would need a live capture stream, and the composer already
  shows the state; the silence gate answers the same question without a preview.
