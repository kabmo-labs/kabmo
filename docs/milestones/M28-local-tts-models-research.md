# Local TTS: a model the user picks, in more than one language

Research, 2026-11-25. Question: Kabmo's local speech engine is `omp say`, which has **one model
(Phonon 31M), twelve English voices and no language parameter**. Can a user instead **choose the
model** — including a different architecture, and switching a male voice for a female one — and get
**Indonesian** as well as English, still on this machine?

Status: **partial** — the `local` engine (Supertonic 3 via `sherpa-onnx-node`), the model store and
its settings page shipped; the listening run and the non-macOS addon check are owed.

**Verdict: yes, but the choice lives in a different engine, not in omp.** omp ships exactly one local
TTS model and no language channel at all; `--model` exists but only `phonon-31m` resolves. The
candidate that meets every filter — Indonesian, CPU-only, no Python, a licence that permits shipping —
is **Supertonic 3** (31 languages, 99M params, 146 MB int8) run **in-process through
`sherpa-onnx-node` inside Kabmo's own Bun server**. Measured here: 243 ms to load, RTF **0.10** on
Indonesian, 44.1 kHz WAV, ten voices spanning **86–197 Hz** median F0 (male and female both present).
`sherpa-onnx` is also the place where *other architectures* become possible — seven slots, Kokoro
measured working — but **none of the other six speaks Indonesian**.

---

## 1. What ships today, and the exact wall it hits

| Piece | File | Job |
|---|---|---|
| local engine | `src/server/lib/tts/local.server.ts` | spawns `omp say --file … --out … [--voice] [--speed]` |
| engine table | `src/shared/lib/tts/engines.ts` | `omp` + five hosted engines, one `TtsEngineSpec` each |
| dispatch | `src/server/lib/tts/engines/index.ts` | input budget, then one adapter |
| capability | `src/shared/lib/tts/capability.ts`, `localTtsCapability()` | probes `omp say --help`, 60 s cache |
| settings | `src/client/components/settings/categories/voice-settings/speech/*` | engine cards, model, voice, rate, language, test |

Measured on this machine — macOS 27.2 arm64, Bun 1.4.5, `omp/19.1.1`:

| Probe | Result |
|---|---|
| `omp setup speech --check --json` | `"Text-to-Speech model": {"ready": true, "status": "phonon-31m"}` — one model, nothing else |
| `omp config list` | `tts.localVoice = harper` with 12 values, **all `en_US`/`en_GB`**; `tts.localSpeed`; no language key |
| `omp say --help` | `--voice`, `--speed` (0.8–1.3), `--model`, `--file`, `--out`. **No `--lang`.** |
| `omp say --model kokoro --out …` | `error: could not synthesize with local TTS model "kokoro". Run \`omp setup speech\` to install it.` |
| `omp say --model local/kokoro --out …` | same refusal; `local/kokoro` is only a migration key that becomes `local/phonon-31m` |
| `omp say --voice harper --out … "Halo, ini uji coba … bahasa Indonesia."` | exit 0, 5.2 s WAV — an English voice reading Indonesian text; no parameter exists to change that |

So the local engine cannot satisfy either half of the request: `--model` has one legal value, and the
language is whatever the phonemizer guesses from Latin letters.

The shape it already has matters for the replacement: it returns a WAV from a child process and the
route labels it `audio/wav`, so a new local engine reuses the client player, the chunker
(`src/shared/lib/tts/speakable.ts`) and the settings cards unchanged.

---

## 2. The requirement, as filters

1. **Indonesian must be a supported language**, not an English model reading Indonesian letters.
2. **The model must be selectable** — several checkpoints, or one checkpoint with a per-request
   language and a real voice list.
3. **Local** — no key, no per-word bill.
4. **Shippable licence** — Kabmo is MIT and distributed; a research-only voice corpus is a defect.

Filter 1 removes the popular models outright. **Kokoro (9 languages), Qwen3-TTS (10), Chatterbox
Multilingual V3 (23), MOSS-TTS v1.5 (31) and NVIDIA Magpie (12) do not list Indonesian at all** —
Chatterbox and MOSS have Malay, which is a different language and is not claimed otherwise.

---

## 3. The field, with the facts that decide it

| Model | Languages | Indonesian | Params / size | Licence | Runtime | Voices |
|---|---|---|---|---|---|---|
| **Supertonic 3** | 31 | ✅ `id` | 99M, 128.8 MB int8 | code MIT, **weights OpenRAIL-M** | ONNX, CPU, no GPU | 10 styles + custom style JSON |
| **Piper** | 53 | ✅ `id_ID` (1 voice) | 21–137 MB per voice | **engine GPL-3.0**; each voice separately | ONNX, CPU | 178 voices, one model per voice |
| **VoxCPM2** | 30 | ✅ | 2B, ~8 GB VRAM | **Apache-2.0** | PyTorch/CUDA, RTF 0.30 on a 4090 | voice design + cloning |
| macOS `say` | ~40 | ✅ `Damayanti` | system | OS | in-process | 186 installed voices |
| Kokoro-82M | 9 | ❌ | 82M | Apache-2.0 | ONNX | 54 voices |
| Qwen3-TTS | 10 | ❌ | 0.6B/1.7B | Apache-2.0 | GPU (vLLM-Omni, mlx-audio) | 9 speakers, cloning |
| Chatterbox ML V3 | 23 | ❌ (Malay) | 0.5B | MIT | PyTorch | cloning |
| MOSS-TTS v1.5 / Nano | 31 / 20 | ❌ (Malay) | 4B / 0.1B | Apache-2.0 | GPU / CPU | cloning |
| Magpie Multilingual | 12 | ❌ | 364M | NVIDIA Open Model | NeMo / GGUF | 5 voices |
| MMS-TTS `mms-tts-ind` | 1100+ | ✅ | ~36M | **CC-BY-NC-4.0** | PyTorch | 1 voice |
| Laras | 1 (`id`) | ✅ only | Rust + ONNX int8, 32 MB | Apache-2.0 | CPU, streaming | cloning from 15 s |
| Pocket TTS Indonesian | 1 (`id`) | ✅ only | 438 MB (6-layer) | CC-BY-4.0 | CPU, 2.23× real time | cloning |

Sources: [Supertonic](https://github.com/supertone-inc/supertonic),
[its model card](https://huggingface.co/supertone-oss-archive/supertonic-3),
[Piper voices](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md) and
[licensing](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/LICENSING.md),
[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2),
[Kokoro voices](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md),
[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [Chatterbox](https://github.com/resemble-ai/chatterbox),
[MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS), [Magpie](https://huggingface.co/nvidia/magpie_tts_multilingual_357m),
[Laras](https://laras.meowlabs.id/), [Pocket TTS Indonesian](https://huggingface.co/anak10thn/pocket-tts-indonesian),
[open-model ranking, October 2026](https://micdrop.dev/blog/top-open-source-text-to-speech-models).

### 3.1 Piper's Indonesian voice is a licensing trap, not a shortcut

Piper is the obvious answer on paper: 53 languages, 178 voices, ~390 ms to first audio on an M2, the
fastest CPU model measured. Its Indonesian voice is not safe to ship:

- `id_ID-news_tts-medium`'s `MODEL_CARD` says **"Finetuned from U.S. English lessac voice"** and its
  dataset line points at a Kaggle notebook, not a licensed corpus.
- Piper's own `docs/LICENSING.md`: the Lessac Blizzard 2013 corpus **"limits use to research and
  exploration of speech technologies"** and excludes commercial use of the resulting synthesis; a
  large share of `piper-voices` descends from it; the project holds no permission and makes no grant
  over any voice.
- The engine is **GPL-3.0-or-later** because it embeds espeak-ng.

Shipping that voice inside Kabmo is redistribution of a model derived from a research-only corpus.
It is the one candidate where the technical and the legal answers point opposite ways.

### 3.2 The Indonesian specialists, and why they answer a different question

**Laras** (Apache-2.0, Rust + ONNX int8, streaming, 0.26 s to first byte, 0.17× real time on 4 cores)
and **Pocket TTS Indonesian** (CC-BY-4.0, 438 MB, 2.23× real time) are Indonesian-only. Laras states
its own ceiling: WER 19–22%, and consonant clusters fail ("kloning" → "koning") because the tokenizer
vocabulary is 4 000 words. Good later as an Indonesian specialist; not the multilingual seam.

---

## 4. What was measured here

Environment: macOS 27.2 arm64 (Apple Silicon), Bun 1.4.5, Node 26.13.1, Python 3.12 in throwaway `uv`
venvs. Packages: `sherpa-onnx-node@2.0.3`, `supertonic==1.3.1`, `piper-tts==1.8.0`.

### 4.1 Supertonic 3 in-process under Bun — the winning shape

```
sherpa-onnx-supertonic-3-tts-int8-2026-05-11   128.8 MB download, 146 MB on disk
new sherpa.OfflineTts({ model: { supertonic: {
  durationPredictor, textEncoder, vectorEstimator, vocoder,
  ttsJson, unicodeIndexer, voiceStyle } } })
```

| Run | Audio | Wall | RTF |
|---|---|---|---|
| load, cold, 4 threads | — | **243 ms** | — |
| `id`, sid 0, 134 chars | 9.37 s | 0.94 s | **0.101** |
| `id`, sid 1, 61 chars | 4.44 s | 0.50 s | 0.113 |
| `en`, sid 0, 31 chars | 2.36 s | 0.36 s | 0.151 |
| `ja`, sid 0, 20 chars | 2.88 s | 0.35 s | 0.123 |

`tts.sampleRate` 44 100, `tts.numSpeakers` 10, API `tts.generate({ text, sid, lang, speed })` —
`lang` is the ISO code and is per request, so one loaded model covers 31 languages.

### 4.2 Male → female is a `sid`, and the voices really do differ

All ten voices rendered with the same Indonesian sentence, median F0 measured by normalized
autocorrelation (40 ms frames, 20 ms hop, 60–400 Hz, voiced frames only):

| sid | F0 | sid | F0 |
|---|---|---|---|
| 0 (F1) | 188 Hz | 5 (M1) | **130 Hz** |
| 1 (F2) | 197 Hz | 6 (M2) | **90 Hz** |
| 2 (F3) | 163 Hz | 7 (M3) | **98 Hz** |
| 3 (F4) | 195 Hz | 8 (M4) | **119 Hz** |
| 4 (F5) | 167 Hz | 9 (M5) | **86 Hz** |

For comparison, omp's own voices on the same sentence: `harper` 183 Hz, `hadley` 185 Hz,
`easton` 133 Hz, `preston` 108 Hz. So Supertonic covers the same range (86–197 Hz) with more voices —
a male/female switch is a settings value, not a model swap.

`sid` is the index in **alphabetical file-name order** of the style tensors: 0–4 = F1–F5,
5–9 = M1–M5. A Voice Builder export (`voice_styles/*.json`, `style_ttl` + `style_dp`) converts to
sherpa's `voice.bin` in about ten lines — `6 × int64` dims, `float32` TTL payload, `float32` DP
payload, 51 760 bytes for one speaker. Verified: a converted `F3.json` matched stock `sid 2`
(3.04 s, three runs) and a converted `M1.json` matched `sid 5` (2.95 s). Python's server imports the
JSON directly; the sherpa path needs the conversion because it only reads `.bin`.

### 4.3 Checkpoints: three exist, one speaks Indonesian

`AVAILABLE_MODELS = ["supertonic", "supertonic-2", "supertonic-3"]` (`supertonic/config.py`), also
`supertonic serve --model …`.

| Key | Params | Languages | sherpa bundle | Measured |
|---|---|---|---|---|
| `supertonic` (v1) | 66M | **English only** (`language: [en]`) | int8, 84.7 MB | 2.35 s audio in 0.09 s — **RTF 0.038** |
| `supertonic-2` | 66M | 5: `en ko es pt fr` — **no `id`** | none | not run |
| `supertonic-3` | 99M | 31 incl. `id` | int8, 128.8 MB | RTF 0.101 (§4.1) |

No third-party Supertonic checkpoint exists — a Hugging Face search returns only Supertone releases
and format ports (MLX, CoreML, LiteRT, MNN), no fine-tunes.

**Footgun, measured:** the English-only v1 bundle **accepts `lang: "id"` and `lang: "ja"` and returns
audio** (2.97 s and 1.37 s), because the 32-code list is validated in sherpa's engine
(`kSupertonicAvailableLangs`), not in the model. A settings page that trusts the engine will offer
Indonesian on a model that cannot speak it — the per-model language list must come from Kabmo's own
catalog.

### 4.4 Another architecture: sherpa's seven slots, Kokoro measured

`sherpa-onnx`'s `OfflineTtsModelConfig` has `vits`, `matcha`, `kokoro`, `zipvoice`, `kitten`, `pocket`
and `supertonic`. Loading a second one in the same Bun process:

| Bundle | Load | Result |
|---|---|---|
| Kokoro int8 multi-lang v1.1 (147 MB) | **625 ms** | 103 speakers, 24 kHz, English synthesized |
| Piper `id_ID` via the VITS slot | — | **Bun segfaults** (`Segmentation fault at address 0x0`); Node returns a clean error instead |

Kokoro's own speaker table is documented by index (`0 af_alloy … 3 af_heart … 11 am_adam … 20
bf_alice … 27 bm_lewis`), so male/female switching exists there too — but Kokoro has **no Indonesian**,
which is why it is a coverage option, not the answer.

### 4.5 The external-server shape, and why the `[OI]` engine cannot drive it today

`supertonic serve` (port 7788) exposes an [OI]-compatible alias, which looks like a base-URL change on
Kabmo's existing `openai` engine. Measured, it is not:

| Request | Result |
|---|---|
| Kabmo's exact body (`model`, `input`, `voice`, `response_format: "mp3"`) | **HTTP 400** `unsupported response_format 'mp3'; set response_format to one of: wav, flac, ogg` |
| same body, `response_format: "wav"` + `lang: "id"` | HTTP 200, `audio/wav`, 639 020 bytes, 1.72 s |
| native `POST /v1/tts` | HTTP 200, `audio/wav`, 0.86 s |

`src/server/lib/tts/engines/openai.ts` hardcodes `response_format: 'mp3'` and has no `lang` field, so
the alias needs an adapter change or a proxy. The same is true of Piper's server, which answers WAV
bytes with `content-type: text/html`.

A server that *would* work with the existing engine today is **mlx-audio** (Qwen3-TTS, Zonos, Higgs on
Apple Silicon): its `/v1/audio/speech` schema takes `voice`, `speed`, `response_format` (default
`mp3`) and `lang_code` — so Kabmo's `openai` engine can drive it with a base URL and a voice name
without new code. It does not help Indonesian: Qwen3-TTS's ten languages exclude `id`, and `lang_code`
defaults to `a` (American English).

### 4.6 macOS `say`: free, installed, not a model picker

`/usr/bin/say -v '?'` lists **186 voices**, including `Damayanti (Indonesian (Indonesia)) id_ID` —
10.24 s of Indonesian audio in one call, no download. It is the zero-install floor: language coverage
on macOS and nothing else — no model choice, no Windows/Linux, a system voice rather than a model.

---

## 5. Two shapes for Kabmo

**A. In-process `sherpa-onnx-node` engine (recommended).** A new `TtsEngine` whose adapter loads one
`OfflineTts` per model key, keeps it on `globalThis` (the rule the DB handle follows), and maps
Kabmo's fields onto `generate({ text, sid, lang, speed })`. The model catalog belongs in
`src/shared/lib/tts/engines.ts`, which already owns "which model is the default"; `sid` ↔ the ten
voices; `language` becomes a real input because `TtsEngineSpec.language` already has a `parameter`
mode.

- Reuses: the spec seam, the client player, the chunker, `audio/wav`, the settings cards.
- New: a download/verify path (146 MB into Kabmo's cache), a probe that reports "not downloaded"
  separately from "broken", and a native addon (`sherpa-onnx-darwin-arm64` and friends).
- Limit: the addon is safe for the Supertonic slot here and **crashes Bun** on the VITS slot.

**B. External server behind a base URL.** `supertonic serve`, `piper.http_server`, or mlx-audio run by
the user. Needs a Supertonic-shaped adapter (wav, `lang`) or a dedicated "local server" engine; the
existing `openai` engine fails as measured in §4.5, except against mlx-audio, which already fits.
Cheap, but pushes a Python install onto the user and the app can no longer say whether the model is
present.

A and B are complementary: B is the escape hatch for VoxCPM2/Qwen3-TTS-class models that want a GPU.

---

## 6. Recommendation

1. **Add Supertonic 3 as the multilingual local engine**, in-process via `sherpa-onnx-node`, bundle
   pinned by version and checksum, downloaded on demand. Only candidate that is CPU-fast (RTF 0.10),
   31 languages including Indonesian, ten voices, and runnable from the server Kabmo already has.
2. **Keep `omp` the default** for English: already installed, already works, no 146 MB download.
3. **Do not ship Piper's `id_ID` voice** without resolving the Lessac chain (§3.1). `rdh`- or
   `hifi_tts_92`-based voices (per `docs/COMMERCIAL_USE.md`) are fine.
4. **Treat VoxCPM2 as the quality tier**, not the default: Apache-2.0, 30 languages, but 2B params
   and ~8 GB VRAM — shape B only.
5. **Leave macOS `say` out of the engine table** — a system voice is not a model, and it would make
   the same page mean two things on two platforms.
6. **Do not expose Supertonic v1/v2 as "models"**: v1 is English-only (and lies about `lang`), v2 has
   no Indonesian and no sherpa bundle. One model, ten voices, 31 languages is the honest menu.

---

## 7. Risks, stated

- **Supertonic's upstream is archived** (repo says development ended; weights moved to
  `supertone-oss-archive`). Code MIT, weights OpenRAIL-M, runtime carried by `sherpa-onnx` — nobody
  will fix the model. Pin the bundle, keep the checksum, keep the engine replaceable.
- **OpenRAIL-M is not Apache.** Commercial use allowed, with use restrictions; the settings copy
  should say "weights: OpenRAIL-M" rather than implying an OSI licence.
- **A native addon in Bun.** Supertonic's slot is stable here (load, generate, WAV, repeat); the VITS
  slot segfaults. Restrict the engine to architectures measured working.
- **No streaming.** `generateAsync` with `onProgress` on a 12 s utterance returned one callback at
  1 523 ms — the whole synthesis. Kabmo's sentence chunking hides it (0.5–2.0 s per chunk); only a
  streaming engine (Laras: 0.26 s to first byte) does better.
- **146 MB download** against omp's 64 MB model — a first-use wait the settings card must state.
- **Vendor numbers are vendor numbers.** Supertonic claims Indonesian WER 1.34 on MiniMax-MLS-test;
  Laras self-measures 19–22% on its own set. Different corpora and ASR — not comparable, and neither
  is this machine's ears.

---

## 8. Shipped, and what is still owed

**Shipped:**

| Piece | File |
|---|---|
| engine id `local`, spec, speed 0.7–2, language `parameter` | `src/shared/lib/tts/engines.ts` |
| catalog + language/voice helpers + install types | `src/shared/lib/tts/local-models.ts` |
| model store: download with progress, `tar` extract, arch detect, probe, remove | `src/server/lib/tts/local-models.server.ts` |
| manifest reader (languages, voices, sample rate) | `src/server/lib/tts/model-manifest.server.ts` |
| ONNX adapter: lazy addon, engine cache, WAV encoder, refusals | `src/server/lib/tts/engines/sherpa.ts` |
| dispatch that resolves the installed model | `src/server/lib/tts/engines/local.ts` |
| `GET/POST /api/tts/models` | `src/server/routes/tts/models.ts` |
| models hook + settings section (installed, catalog, add-from-link) | `src/client/hooks/settings/local-tts-models.ts`, `…/speech/ModelsSection.tsx` |
| request rules: ISO language, refused undeclared language, refused sid | `src/server/lib/tts/local-request.ts` |
| WAV encoder | `src/server/lib/tts/wav.ts` |

One packaging defect was found and fixed by running the artifact instead of the sources: bundled into
`dist/client/index.js`, the addon's own entry `require`s a platform package by a **relative path**
(`./node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node`), which resolves against `dist/client/` and
fails with "Could not find sherpa-onnx-node". `sherpa-onnx-node` is therefore `external` in the server
build (like `*.html`), resolved from `node_modules` at run time; the built server then answered
`/api/tts/models` with `runtime.available: true` and synthesized 1.84 s of Indonesian WAV in 0.93 s.

Measured end to end through the shipped code path (temp data dir, real download): install
**31.6 s** for the 128.8 MB bundle, probe reported `voices=10 sr=44100 langs=31`, Indonesian
synthesis **1.52 s** for 654 568 bytes of WAV, a male voice (`sid 5`) produced a distinct file,
English worked on the same loaded model, `lang=th` was refused with the 31-language list, and
`removeModel` left zero installed models plus a refusal that names Settings → Local models.

**Owed:**

- A real listening run: one Kabmo answer, Indonesian and English, this engine vs `omp` Phonon vs
  macOS `say`. No accuracy claim here rests on this machine's ears yet.
- Windows/Linux addon verification: only `darwin-arm64` was exercised.
- Whether `sherpa-onnx-node` survives a `bun --hot` reload with a live `OfflineTts` handle. The
  engine cache lives on `globalThis` for that reason, but the reload itself was not run.
- A `voice_styles/*.json` → `voice.bin` converter, so a Voice Builder export drops in without
  Python. The format is proven (§4.2); the converter is not written.
- Kokoro is offered in the catalog but was only smoke-tested by loading it directly, not through an
  install + synthesis click.
- The phone layout was not opened; the section is plain stacked cards inside the existing settings
  shell, which the same page already proves at every width.
