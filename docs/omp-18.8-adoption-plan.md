# omp 18.8 adoption plan

The Kabmo pinned `OMP_VERSION=18.3.0` in `.github/scripts/install-omp.sh` while
the installed binary was **18.8.3** (2026-10-07); the pin now matches (F9). This document records the audit
of everything between the two versions that Kabmo either gets wrong or
does not use, and the phased plan to close it.

Status: **complete**. Phase table and per-phase outcomes below; P4b–d and P5 were
measured and deliberately NOT adopted (see the outcomes).

**Re-audited at 18.9.2 (2026-10-12)** — the pin moved on again and the schema had
drifted 9 rows; see [the re-audit section](#omp-1892-re-audit-2026-10-12) at the
end of this file. The 18.8 phases above are unchanged.

**Adopted 18.10.0 the same day** — both the RPC and the settings surface were
unchanged, but session identity was not: a session marked moved away now forks on
resume, which the registry was not prepared for. See
[the 18.10.0 section](#omp-18100-adoption-2026-10-12).

## How this audit was produced

Every claim below was measured, not read off a changelog:

- Release notes for v18.1.22 → v18.8.3 (`api.github.com/repos/can1357/oh-my-pi/releases`).
- The machine-readable wire schema shipped in the installed package
  (`@oh-my-pi/pi-coding-agent/src/modes/rpc/wire/rpc-wire.schema.json`): **67
  commands**, 31 session events, 20 notifications, 4 inbound frames.
- The settings registry in the installed bundle
  (`@oh-my-pi/pi-coding-agent/dist/cli.js`, `SETTING_TABS` from `pi-tui`):
  **537 live config keys**.
- Live RPC probes against `omp --mode rpc-ui` 18.8.3 (and, for the partial-result
  question, against a freshly installed 18.3.0 to prove it is not a regression).

## Findings

### F1 — Tool output is double-appended (bug, shipped)

`tool_execution_update.partialResult` is a **full snapshot** of the tool's output
so far, never a delta. The Kabmo appends:

```ts
// src/shared/lib/chat/omp/agent-events.ts:143-146
const prev = deps.toolResultsRef.current?.get(callId)?.output ?? '';
putToolResult(deps, callId, { output: prev + partial });   // WRONG
```

Measured on omp 18.8.3, a `bash` loop echoing `L1…L4` one line per second:

```
update 0: "L1\n"
update 1: "L1\nL2\n"     ← full snapshot
update 2: "L1\nL2\nL3\n"
```

The same probe against **18.3.0** produced identical output, so this is not a
regression introduced by the upgrade — it has always been wrong.

Consequence: a tool card that is **still running** renders interleaved text
(`"L1\nL1\nL2\nL1\nL2\nL3\n"`). `tool_execution_end` overwrites the record with
the real result, so the corruption self-heals the moment the call returns — but
every long-running command (a build, a test run, a `sleep`) is wrong for its
whole duration.

Fix: assign the snapshot instead of appending.

### F2 — Settings schema is frozen at 2026-09-18

`src/client/data/settings/omp-schema.json` was last touched by the Remix→Elysia
migration commit `77d9199` and has never been regenerated. Consequences:

- **157 live omp settings cannot be rendered at all**, including every
  `title.*`, `tui.renderSvg`, `tui.autoGraph`, `task.completionProbe`,
  `skills.*`, `ida.*`, `searxng.*`, `gc.*`, `memories.*`,
  `compaction.v2RetainedMessageBudget`, `browser.tern`, `stream.serverUrl`,
  `telemetry.otlpExportEnabled` and `auth.broker.*`.
- **12 keys Kabmo still offers are rejected by omp** — verified one by one
  with `omp config get <key>` → `Unknown setting: <key>`:

  `irc.timeoutMs`, `providers.autoThinkingModel`, `providers.imageOrder`,
  `providers.memoryModel`, `providers.tinyModel`, `providers.tts`,
  `providers.unexpectedStopModel`, `providers.webSearchExclude`,
  `providers.webSearchGeminiModel`, `providers.webSearchOrder`,
  `stt.modelName`, `tts.localModel`.

  These render an editor whose write is guaranteed to fail — a settings row that
  cannot work.
- `task.completionProbeMs` was **replaced** by the on/off `task.completionProbe`
  in 18.5.0.

Fix: generate the JSON from the installed bundle with a committed script, so the
next upgrade is one command.

### F3 — 100× avoidable transport cost

`set_event_filter` with `messageUpdates: "delta"` makes omp send
`message_update` frames carrying only the new fragment
(`assistantMessageEvent.delta`) instead of the accumulated `message` +
`assistantMessageEvent.partial` snapshot on every token.

Measured on one prompt (`Write a 300 word essay about rain.`):

| mode | bytes | frames |
|---|---|---|
| default (accumulated) | 10,908,455 | 2,217 |
| `messageUpdates: "delta"` | 107,943 | 486 |

~101× fewer bytes. The Kabmo never calls `set_event_filter` and reads the
accumulated `partial`, so it pays the full cost.

Terminal frames stay whole in delta mode (verified): `message_end`, `turn_end`
and `agent_end` still carry the complete message, so the fix is confined to the
in-flight rendering path.

### F4 — omp now implements, natively, three things Kabmo reimplemented

| Area | omp RPC | Chamber today |
|---|---|---|
| Side questions | `btw` / `btw_cancel` / `get_btw_history`, streamed as `btw_delta` + `btw_record`, works mid-turn | own child: `--resume <snapshot> --no-tools` |
| Follow-up queue | `get_state.queuedMessages`, `queue_update`, `remove_queued_message`, `promote_queued_message`, `abort_and_restore_queue` | own SQLite `queued_messages` + drain on `agent_end` |
| Steering | `steer` (interrupt the turn with a message) | `abort_and_prompt` — **cancels the turn** |

Measured: `steer` mid-turn answers `success: true`, emits
`queue_update {steering:[…]}` then `{steering:[]}` when consumed, and the model
responds to the steer inside the same run (one `agent_start`, one `agent_end`).

The Kabmo's queue row labelled **"Send Now (Steering)"** actually posts
`abort_and_prompt`, which discards the running turn. omp has had real steering
since 18.3.x.

### F5 — Unused surface (no Kabmo code path)

Verified zero references in `src/`:

`set_event_filter`, `queue_update`, `queuedMessages`, `abort_and_restore_queue`,
`remove_queued_message`, `promote_queued_message`,
`get_available_thinking_levels`, `get_session_stats`, `export_html`,
`cancel_subagent`, `steer_subagent`, `set_slow_mode`, `set_cache_warming`,
`set_ask_dialog`, `get_logout_accounts`, `predict_word`, `session_settled`,
`tool_stream_update`, `cache_warming_*`, `retry_fallback_*`,
`config_warnings_changed`, `rpc_frame_error`, `extension_error`.

Frames that arrive today fall through `default: break` in both folds.

### F6 — Provider "disconnect" does not remove the credential

`POST /api/settings/providers` `{enabled:false}` writes
`disabledProviders` in `config.yml`. The OAuth token / API key stays in the auth
store. omp exposes `get_logout_accounts` + `logout` for the real operation, and
Kabmo never calls them.

### F7 — Grouped ask dialog available

`set_ask_dialog {enabled:true}` makes omp send **one** `extension_ui_request`
with `method:"ask"` carrying every question of a call (with `multi` and
`recommended`), answered by a single `AnswersUiResponse`. Verified live: two
questions including a `multi:true` one arrived in one request.

Today Kabmo renders one dialog per question because omp's default mode
asks one at a time.

### F8 — Verified NOT broken (do not "fix")

- **TUI-only guard is correct.** All 42 names in
  `src/shared/lib/chat/composer/tui-only.ts` are still `handleTui`-only in
  18.8.3. `plan`/`goal` are deliberately absent (Kabmo's own extension
  answers them). The extracted list from 18.8.3 is exactly those 42 plus
  `goal`/`plan` — no drift.
- **`get_state.isSettled` is already used** (`run-settle.server.ts`).
- **STT audio type is correct.** The worker takes `Float32Array` at 16 kHz and
  rejects everything else; `src/server/routes/dictation/ws.ts` converts PCM16 →
  `Float32Array` before `transcribe`. The comment in `omp-stt-worker.ts` saying
  "base64" is **doc drift** in Kabmo, not a code bug.
- **`turn_end` is deliberately unhandled** — it fires for every turn of a
  multi-turn run, and `terminal-settle.ts` reads the badge from it. Not a gap.
- **`tool_stream_update` never fires** in practice on 18.8.3 for `bash` or
  `write` (measured: 0 frames on both). It is an extension-tool channel
  (`updateStreamPreview` in the TUI), not something Kabmo is missing.

### F9 — Pinned version was stale

`.github/scripts/install-omp.sh` pinned `18.3.0` while the audited version is
`18.8.3`, so the CI bot ran a build predating every RPC feature this document is
about (`steer`, `set_event_filter`, `get_state.isSettled`). **Fixed**: the pin is
now `18.8.3`.

## Phases

Each phase is independently shippable. Verification is named per phase; a phase
is done only when its verification has been run.

| # | Phase | Deliverable | Verification |
|---|---|---|---|
| P1 | Tool partial snapshot | assign, not append | unit test + live tool card |
| P2 | Settings schema | regenerated JSON + committed generator | every key accepted by `omp config get` |
| P3 | Delta transport | `set_event_filter` at attach + delta fold | byte/frame comparison, rendered answer identical |
| P4 | Native queue & steer | Send Now steers; queue read from `queue_update` | steer mid-turn observed; queue ops round-trip |
| P5 | Native /btw | RPC `btw` path | side question answered mid-turn; parent file unchanged |
| P6 | Subagent + session ops | cancel/steer subagent, session stats, live thinking levels | live subagent cancelled from the roster |
| P7 | Provider logout | credential removal beside disable | account list → logout → account gone |
| P8 | Grouped ask | one request, multi-select | two-question ask answered in one submit |
| P9 | Frames & hygiene | unknown-frame handling, version pin, AGENTS.md | typecheck + full suite + live boot |

## Phase outcomes

### P1 — tool output snapshot (shipped)

`agent-events.ts` assigned the snapshot instead of appending. Regression test in
`agent-events.test.ts`, and a replay of a real 114-frame capture confirmed the
running card never doubles.

### P2 — settings schema (shipped)

`scripts/omp-schema.mjs` + `bun run omp:schema` / `omp:schema:check`. The JSON
went from 377 entries (12 of them rejected by omp) to **404 entries, 0 rejected**,
and every key was checked against `omp config get`. `omp:schema:check` is the CI
gate.

### P3 — delta transport (shipped)

`configureChild` sends `set_event_filter {messageUpdates:"delta"}` and
`delta-accumulator.ts` rebuilds the accumulated message. Measured on one
500-word prompt: **8.4 MB / 1268 frames → 165 KB / 824 frames (51×)**. Verified
end to end through the real server path: the streamed text matched the persisted
transcript byte for byte, one row, no duplication.

### P4a — real steering (shipped)

Send Now posts `steer`, not `abort_and_prompt`. Measured: `steer` keeps one
`agent_start`/`agent_end` pair for the run; `abort_and_prompt` produced two of
each. The now-dead `interruptPendingRef` guard was removed.

### P4b–d — native queue: NOT ADOPTED (measured)

**omp's follow-up queue is in-memory and belongs to the child process.** Measured:
a `follow_up` item present in `get_state.queuedMessages` before the child was
killed was **gone after a respawn** on the same session file. The Kabmo's queue
is SQLite-backed (`queued_messages`) and therefore survives an idle reclaim, a
server restart and a second Kabmo instances — three things that happen routinely
and would silently drop a user's queued message under omp's queue. The Kabmo
also never populates omp's queue (zero `follow_up` sends), so the two are
disjoint rather than duplicated.

Adopting `remove_queued_message` / `promote_queued_message` /
`abort_and_restore_queue` would mean routing the panel's queue through a store
that loses its contents on the next child restart. The Kabmo's own per-item
queue endpoints already provide the equivalent operations durably.

What IS taken from this area is P4a: real `steer` for "Send Now".

### P5 — native /btw: NOT ADOPTED (measured)

Same finding, same reason. Measured: `get_btw_history` returned a record before
the child was killed and **`{records:[]}` after a respawn**. The Kabmo's BTW
topics live in SQLite (`btw_topics`/`btw_turns`) and survive restarts; omp's
history is per-process. The Kabmo's side child additionally resumes a
transcript COPY (`--no-tools`), which is what keeps the parent session file
untouched and lets a topic outlive any single child.

Adopting RPC `btw` would trade durable, restorable topics for ones that vanish
when the idle reaper reclaims the child.

### P6 — subagent control (shipped), session ops (not adopted)

`cancel_subagent` / `steer_subagent` are wired end to end: routes
(`sessions/subagent-control.ts`), the passthrough set, a client module, a control
strip on the subagent transcript, and a stop button on the roster row. Verified
against omp 18.8.3: `get_subagents` reports the roster id (`Sleeper`), and both
commands answered `success: true` for it.

Not adopted, with the evidence:

- **`get_session_stats`** duplicates what Kabmo already has. Measured side
  by side: `get_session_stats.tokens` = `{input: 8843, output: 25, total: 8868}`
  and `cost: 0.001482…`, while the `message_end` frame the timeline already folds
  carried `usage.totalTokens: 8868` and `usage.cost.total: 0.001482…` — the same
  numbers. Adding a second source for the footer would only create a way for the
  two to disagree.
- **`get_available_thinking_levels`** duplicates `get_state.model.thinking.efforts`
  (measured: `["low","high","max"]`), which `thinkingLevelsForMeta` already turns
  into the same ladder the command returns (`["off","low","high","max"]`). The
  Kabmo reads the live ladder from `get_state`, so the command adds a round
  trip for an identical list.

### P7 — provider logout (shipped)

`POST /api/settings/providers/logout` drives omp's `get_logout_accounts` and
`logout`; `LogoutProviderModal` lists the removable credentials and removes one;
a `sign out` button sits beside `disable`/`connect` in the auth section. The two
operations are now visibly different: `disable`/`disconnect` hide a provider and
leave the credential, `sign out` deletes it. The dialog says what survives (a
`models.yml` entry, Kabmo overlay) so the distinction is not implied.

### P8 — grouped ask (shipped)

`configureChild` sends `set_ask_dialog {enabled:true}`; the frame's `questions`
are typed on `ExtensionUiDialogRequest`; `splitAskFrames` claims the grouped
frame by question id (it carries no `title`) and places it on every question it
names; `GroupedAsk` renders all questions with one `Submit answers` and replies
with a single `{answers:[…]}`. Tests: `ask-frames-grouped.test.ts`.

### P9 — frames & hygiene (shipped)

`transport-frames.ts` folds `rpc_frame_error`, `extension_error` and
`session_settled`, and names the frames deliberately ignored. `OMP_VERSION` was
pinned to `18.8.3` by this phase (now `18.9.2` — see the re-audit section).
AGENTS.md carries the delta transport, the transport frames,
the steering rule and the generated settings schema; the STT audio doc drift
(base64 → `Float32Array`) is corrected.

## Non-goals

- No `--mode json`, ACP, or live-voice (`live_start`) support.
- No `predict_word` ghost text (Kabmo's composer has no completion surface).
- No `export_html`.
- `get_entries` / `get_tree` / `get_branch_messages` are read-only tree views the
  Kabmo has no UI for; noted, not adopted.

---

# omp 18.9.2 re-audit (2026-10-12)

The 18.8 work above was measured against **18.8.3**. The installed binary is now
**18.9.2** (published 2026-10-11T19:17Z), so the same questions were re-asked:
what moved under Kabmo, and what does the panel still not offer. Every
claim below is measured against the installed package, not read off a changelog.

## Method

- `src/modes/rpc/wire/rpc-wire.schema.json` from the installed package, diffed
  against the `v18.8.3` tag — the machine-readable contract, not prose.
- `omp config list --json` (548 keys) against Kabmo's merged schema table.
- The slash-command registry: `BUILTIN_SLASH_COMMAND_RESERVED_NAMES` +
  `lookupBuiltinSlashCommand`, classified by whether the spec carries a text-mode
  `handle`.
- `bun run omp:schema:check`, live `omp config get` per key, a live STT worker
  ping, and the upstream changelog/tags for what is still unreleased.

## Findings

### R1 — The RPC surface is UNCHANGED (nothing to adopt, nothing broken)

18.8.3 → 18.9.2 carries **the same 67 commands**: `ADDED: []`, `REMOVED: []`, and
no command's params/result/timeout changed. Every verb Kabmo depends on
(`steer`, `set_event_filter`, `set_ask_dialog`, `cancel_subagent`,
`steer_subagent`, `get_logout_accounts`, `logout`, `get_subagents`) is present
with an identical signature.

Two shape changes exist and both are additive:

- `SessionState.queuedMessages` gained `liveSteered: number` (default `0`) — the
  count of leading `steering` entries already sent into the streaming response,
  which `remove_queued_message` cannot reach. The Kabmo never reads omp's queue
  (P4b–d, below), so it is inert here.
- `QueueUpdateEvent` gained the same field, for the same reason.

The frame names Kabmo folds (`session_settled`, `rpc_frame_error`,
`extension_error`) all still exist.

### R2 — The settings schema had drifted 9 rows (fixed)

`src/client/data/settings/omp-schema.json` was generated against 18.8.3 and had
gone stale. Regenerated: **404 → 413 entries**, header `10 tabs / 537 settings` →
`10 tabs / 548 settings`, 0 removed. The 9 additions:

`bash.gitGuard`, `composer.predictions`, `contextFiles.extra`,
`retry.fallbackOn`, `speech.speed`, `terminal.programStatus`, `tts.localSpeed`,
`worktree.onStart`, `worktree.onExit`.

Seven existing entries changed **description text only** (`ask.timeout`,
`claudeResets.autoRedeem`, `codexResets.autoRedeem`, `title.icons`, `tools.xdev`,
`tui.autoGraph`, `tui.vimModeDisplay`) — no type, default or enum value moved.

Verified against the live binary rather than the file: `omp config list --json`
reports 548 keys, and of Kabmo's 435 merged entries **0 are rejected**. The
12 keys that used to be rejected (`stt.modelName`, `providers.tts`, …) are still
absent from omp's registry, so the generator does not pull them back.

### R3 — The schema gate was documented but not wired (fixed)

AGENTS.md described `bun run omp:schema:check` as "a CI failure rather than a
shipped panel", but no workflow called it — it existed only as a `package.json`
script, which is why R2 could sit stale. It is now a `schema` job in
`ci.yml`, separate from `gates` because the generator imports the INSTALLED
`@oh-my-pi/pi-coding-agent`, which this repo does not depend on and a cold Bun
global install would otherwise put in front of every other gate.

### R4 — The version pin had drifted a second time (fixed)

`install-omp.sh` pinned `18.8.3` — the F9 failure repeating one minor later: the
CI bot ran a build two versions behind the audited one. Bumped to `18.9.2`, and
the schema job deliberately reads that one pin rather than restating a version,
so the two cannot disagree about which omp generated the table.

### R5 — Verified still correct at 18.9.2 (do not "fix")

- **TUI-only command guard.** The Kabmo's 42-name list is an exact match for
  18.9.2's TUI-only set (44 names; `plan`/`goal` are Kabmo-owned and
  deliberately absent). 0 unguarded, 0 stale.
- **STT worker transport.** `omp __omp_worker_stt` still answers on the Bun IPC
  channel with `serialization: "advanced"` and `stdin`/`stdout` ignored — ping →
  `{"type":"pong"}` verified live. The 18.9.x IPC work is a Rust transport for
  omp's OWN internal endpoints (daemon broker, LSP mux, IDA, predict, stream,
  collab, local model workers); it does not replace the STT worker channel.
- **STT model keys.** Still exactly `whisper-base`, `whisper-small`,
  `whisper-large-v3-turbo`, `parakeet-tdt-0.6b-v3`; omp's own default is still
  the English-European-only Parakeet, so Kabmo's `whisper-base` default
  remains the right call.
- **`omp usage --json` / `omp plugin list --json` / `omp skill list --json`.**
  Same shapes; `usage` gained only a `reset` subcommand.
- **Session title slot.** Still 256 bytes, same entry type, on both sides.
- **Schema extras.** All 15 Kabmo-documented keys still answer `omp config get`.
- **`PI_NO_TITLE` gate.** Still set by `--mode rpc-ui` and still gates only the
  two automatic title paths, so Kabmo's own `/rename` remains the way a
  session gets named.

### R6 — `title.icons` changes what a generated title looks like (not a bug)

18.9.0 added **title cards**: `title.icons` (default `nf+emoji`) heads a
generated or `/rename`d title with an icon and a short code — `formatCardTitle`
emits `🧪 FLAKY: Fix flaky park tests`. This reaches Kabmo, because the
Kabmo names sessions by sending `/rename` to the child and then reads the
resulting name back.

It is **not** handled specially and does not need to be: `sessionTitleFor`
returns `session.name` verbatim (first character upper-cased), so a card title
renders as the card title — which is what omp's own TUI shows. There is nothing
to strip; the prefix is part of the name omp persisted. Worth knowing rather
than fixing: a user who prefers plain names sets `title.icons: boring` in
Settings → Appearance, and the row is now present in the panel because of R2.

### R7 — 18.10.0 is tagged but NOT published (do not pin yet)

`v18.10.0` was tagged 2026-10-12 and its changelog is written, but npm `latest`
is still `18.9.2` and there is no `18.10.0` on the registry. It brings
`omp session pack|unpack|moved`, `omp auth export|import`, and the native local
IPC transport — whose Windows note is the one operational caveat ("daemons
started by an older omp are not reused"). Its RPC wire schema is **identical to
18.9.2's** (67 commands, 0 added, 0 removed, 0 defs changed), so Kabmo
needs no code change for it. Re-audit when it lands on npm; do not pin a
tag-only release.

## Re-audit outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R1 | RPC surface unchanged | none needed | wire-schema diff, 67/67 |
| R2 | schema 9 rows stale | regenerated + committed | `omp:schema:check`, 0 keys rejected of 435 |
| R3 | gate documented, not wired | `schema` job in `ci.yml` | fails on a perturbed file, passes restored |
| R4 | pin 2 minors behind | `OMP_VERSION=18.9.2` | 3 stub-omp scenarios (match / stale / override) |
| R5 | six surfaces still correct | none needed | live ping, key sets, slot size, `config list` |
| R6 | title cards reach the UI | documented, no code | `title.icons` row present; name passes through |
| R7 | 18.10.0 tagged, unpublished | wait | npm `latest` = 18.9.2 |

---

# omp 18.10.0 adoption (2026-10-12)

18.10.0 landed on npm the same day it was tagged (published
2026-10-12T01:25Z, `latest`), so the wait R7 prescribed ended within hours and
the install was moved to it. Everything below is measured against the installed
18.10.0.

## Method

- `rpc-wire.schema.json` from the installed package, diffed against the `v18.9.2`
  tag — the machine-readable contract, not prose.
- `orderedSettings()` from the installed package, generated into a temp file and
  compared entry by entry with the committed schema.
- A real `--mode rpc-ui` child: `ready` → `get_state`, then the attach sequence.
- The slash-command registry, classified by whether a spec carries a text-mode
  `handle`.
- Live CLI probes: `omp usage|plugin|skill|config … --json`, `omp --help`,
  `omp session|auth --help`.
- The real spawn path, twice, against one session file — the measurement that
  found R10.

## Findings

### R8 — Both surfaces are UNCHANGED (nothing to adopt, nothing broken)

- **RPC wire schema: identical.** 67 commands, 283 definitions, `ADDED: []`,
  `REMOVED: []`, 0 command signatures changed, 0 definitions changed.
- **Settings registry: identical.** `orderedSettings()` at 18.10.0 produces the
  same `10 tabs / 548 settings` and the same 413 panel entries; a regeneration
  diff shows 0 added, 0 removed, 0 changed and identical tabs. `omp:schema:check`
  therefore passed against the 18.9.2-generated file with no regeneration —
  which is the strongest form of "the schema did not move".

The frames Kabmo folds (`session_settled`, `rpc_frame_error`,
`extension_error`) and the RPC verbs it drives (`steer`, `set_event_filter`,
`set_ask_dialog`, `cancel_subagent`, `steer_subagent`, `get_logout_accounts`,
`logout`) are all unchanged.

### R9 — Verified still correct at 18.10.0 (do not "fix")

- **STT worker transport.** `omp __omp_worker_stt` still answers `pong` on the
  Bun IPC channel with `serialization: "advanced"` and `stdin`/`stdout` ignored.
  The 18.10.0 native-IPC work replaced omp's OWN internal endpoints (daemon
  broker, LSP mux, IDA hosts, predict, `omp stream`, Collab discovery, local model
  workers) — it did not touch this channel, which is spawned by the parent with
  an inherited IPC handle.
- **STT model keys.** Still exactly `whisper-base`, `whisper-small`,
  `whisper-large-v3-turbo`, `parakeet-tdt-0.6b-v3`; omp's default is still the
  European-only Parakeet, so Kabmo's `whisper-base` default stands.
- **TUI-only command guard.** 44 TUI-only names at 18.10.0, and Kabmo's
  42-name list is an exact match (`plan`/`goal` are Kabmo-owned). 0 unguarded,
  0 stale.
- **Every CLI surface Kabmo shells out to.** `omp usage --json`,
  `omp plugin list --json`, `omp skill list . --json` and `omp config list --json`
  all exit 0 with the same shapes (548 config keys, 413 with a `ui` block).
- **Every flag Kabmo passes to a child.** `--mode --cwd --resume
  --no-session --no-lsp --no-title --no-tools --approval-mode --model --thinking`
  are all still accepted.
- **Session title slot.** Still 256 bytes, same entry type.
- **The new CLI verbs are additive.** `omp session pack|unpack|moved` and
  `omp auth export|import` exist and change nothing Kabmo calls.

### R10 — A forked resume was re-spawned (bug, fixed)

**This is the one real finding, and it is new in 18.10.0.**

`omp session moved` (and any `departed` transfer marker) makes omp FORK a session
on resume instead of continuing it: the child answers a fresh `sessionId` and
writes the conversation to a fresh file under a fresh id. Verified against a real
18.10.0 child — resuming a departed file answered
`01a12dc0-8f6b-…` and a file under `--private-tmp-ompfork--/`, in a different
directory from the one resumed.

The Kabmo's registry was keyed on the id the CALLER holds (the URL's session
id), and `startRpcSession`'s lookup therefore MISSED on the very next message:
the send re-resolved the ORIGINAL file and spawned a second child, which forked
again. Measured on the real spawn path (`startRpcSession` twice, and again
through the route-level lookup): **two sends on one session file produced two
children with two different ids**, each with its own fork file — a chain of
forks, a sidebar row each, and nothing on screen to explain the duplication. The
split is silent in a second way too: the client keeps posting to the id in its
URL, so the frames of the second child never reach the tab that started it.

Fix: `registerSpawnedSession` (`src/server/lib/omp/rpc/session-registration.ts`)
registers the wrapper under the reported id AND, when they differ, under the id
the caller asked for — and removes both on destroy, so a dead child cannot answer
for the requested id. The spawn path also emits `session-attached` for the
requested id, so a subscribed tab re-snapshots instead of holding the pre-spawn
`running:false`. `realSessionId` now reports the child's OWN id on a registry
hit (it reported the requested id, which is the alias, not the session).

Pinned by `forked-resume.test.ts`, which drives the REAL spawn path against a
scripted child (`test-support/fake-omp-fork.ts`) that answers a forked identity —
the only way the two ids can differ. Verified both directions: with the fix, two
sends produce ONE child; with the pre-fix bookkeeping restored, the same test
fails with 2.

### R11 — `session-transfer` transcript entries render as a notice (no action)

18.10.0 writes a visible, model-facing `custom_message` with
`customType: "session-transfer"` when a session arrives, departs or is forked.
The Kabmo's notice mapper carries any unrecognised `customType` through as a
`notice` row with its `noticeSource` — verified by loading a session file built
to 18.10.0's exact shape: the marker rendered as a notice row with
`source: session-transfer`, and the surrounding turns were unaffected. No branch
is needed; the generic path is correct here because the entry IS a notice.

## 18.10.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R8 | RPC + settings identical | none needed | wire diff 67/67, schema diff 0/0 |
| R9 | eight surfaces still correct | none needed | live ping, key sets, flags, slot size, CLI probes |
| R10 | forked resume re-spawned | `registerSpawnedSession` + alias signal | `forked-resume.test.ts` 1 child; fails with 2 pre-fix |
| R11 | transfer markers | none needed | real reader: notice + `noticeSource` |

---

# omp 18.11.0 adoption (2026-10-15)

The pin sat at **18.10.3** while **18.11.0** was installed and published
(2026-10-14T22:10Z, npm `latest`). That is the F9/R4 failure repeating a third
time, and this round it had a live consequence: two rows the committed schema
still offered had been **removed upstream in 18.10.4**, so `omp config set` on
them exited 1 with `Unknown setting` — and the CI schema gate could not see it,
because the gate installs the PIN and the pin was behind.

## Method

- `rpc-wire.schema.json` from the installed 18.11.0, diffed against the
  `v18.10.3`, `v18.10.0` and `v18.8.3` tags (downloaded from the registry).
- `orderedSettings()` from the installed package, generated into a temp file and
  compared entry by entry with the committed schema.
- `omp config list --json` (550 keys) against Kabmo's merged table.
- `STT_MODELS` / `MODEL_ROLE_IDS` / `session-entries.ts` from the installed
  package.
- Live probes: `omp config set/get/reset`, `omp usage reset [--json]`,
  `omp --mode rpc-ui --restore`, `omp __omp_worker_stt` frames.

## Findings

### R12 — Two settings the panel offered no longer exist (fixed)

`providers.openai-codex.codeMode` and `.codeModeDirectTools` were **removed in
18.10.4** ("Removed Codex Code Mode…"). The committed schema was generated from
18.10.3 and still carried both, so the Providers → Services group rendered two
editors whose every write was guaranteed to fail.

Measured:

```
$ omp config set providers.openai-codex.codeMode off
Unknown setting: providers.openai-codex.codeMode

Run 'omp config list' to see available keys
(exit 1)
```

`omp config get` and `omp config reset` fail the same way. Regenerated:
**414 → 412 entries**, 0 added, plus three description-only updates
(`contextPromotion.enabled`, `retry.modelFallback`, `task.structured`).

Of the 550 live keys, 138 have no `ui` block and are therefore deliberately not
carried (matching upstream's own panel); **0** ui-bearing settings were missing.
So the drift was exactly these two zombie rows.

### R13 — The failure sentence was thrown away (fixed)

`config-cli.ts` captured `stderr: 'pipe'` and never read it, throwing
`omp config failed: exited with code 1`. omp writes the reason to **stderr**, so
a stale key, a bad value and a timeout all arrived as the same string — and the
panel rendered all three as a bare `save failed` badge, because
`applyWriteResult` kept only a boolean.

`plugin-cli.ts` already did this right (both streams, `pluginCliError` prefers
stderr); the config bridge is now the same shape, with one deliberate
difference: it reads the **FIRST** non-empty line, not the last, because omp
puts the reason first and a generic hint after it.

```
$ omp config set stt.enabled notabool
Error: Invalid boolean value: notabool. Use true/false, yes/no, on/off, or 1/0
```

That sentence now reaches the row (the badge plus the message under it).
Pinned by `config-cli.test.ts` against a stub `omp`.

### R14 — `nemotron-streaming-en-0.6b` was unreachable (fixed)

18.11.0 added a fifth STT model. The Kabmo's `SttModelKey` union held four, and
`isSttModelKey` gates the worker call — so the key could not be selected at all
(the worker would have answered `Unknown stt model` anyway). Added.

It is the one key omp decodes through an ONLINE recognizer, but that is omp's
own streaming path (`stream_start`/`stream_audio`/`stream_stop`), which the
Kabmo does not drive — its socket sends one utterance per `transcribe` call.
`decodeSegment` handles the online model on the batch path too (feeds the
utterance plus a terminal padding frame), so no transport change was needed; the
label says "live in omp TUI" so the difference is stated rather than implied.

### R15 — `stt.language` was unreachable AND unused (fixed)

Upstream declares `stt.language` (default `"en"`) with **no `ui` block**, so its
own panel hides it — while its own dictation reads it. The Kabmo drove the
same worker and passed **no language at all**, leaving every decode
auto-detecting: the setting that decides whether a non-English utterance
transcribes correctly was reachable from neither surface.

Two halves: a Kabmo-documented row in `schema-extras.ts`, and
`language.server.ts` resolving the value (60 s cache, dropped by the config
write route) which the dictation socket uses when the client sends none. The
worker applies `language` only for a non-`englishOnly` model, which is exactly
the multilingual tiers Kabmo defaults to.

### R16 — Six of omp's fifteen model roles were unreachable (fixed)

`MODEL_ROLE_IDS` is `default smol slow vision plan commit tiny memory task
advisor image web speech dictation judge`; `RoleEditor` offered 9. `memory`,
`image`, `web`, `speech`, `dictation` and `judge` could not be set from the
console even though `omp config set`/`modelRoles` accept them. `dictation` is
the one with a feature behind it (it is how a local STT model is chosen).

The editor now lists all 15, split by omp's own sections — the first ten accept
a chat model, the last five a model of that kind only, which is information the
user needs (a chat model in `judge` is silently unusable). Pinned by
`RoleEditor.test.ts`, which asserts the full role set against omp's list.

### R17 — Saved rate-limit resets had no surface (feature)

18.9.0 added `omp usage reset` (list stored Codex/Claude reset credits, spend
one) plus expiry warnings. The Kabmo's Usage surfaces showed quota windows and
balances only, so a saved reset could be seen nowhere and spent nowhere.

New: `reset.server.ts` (both halves are omp's own command), route
`/api/settings/usage/reset` (GET list, POST spend), and `SavedResetsSection`
rendered in **both** Usage surfaces. Three rules carried from omp's own
behaviour: a row without a `credentialId` is dropped (the target grammar is
`<provider>/<credential id>`, so its button could never work); a failed LIST is
reported rather than answered as an empty list (omp exits 1 for "no accounts"
AND for a real failure, and the two look identical on screen); and a spend
refusal keeps omp's sentence, because `already_redeemed` and `nothing_to_reset`
are outcomes the user acts on differently.

Verified end to end against a booted server with a stub `omp`: the list parsed,
a spend returned omp's sentence, a malformed target answered 400, a wrong verb
405, and a failing stub reported its own message in `error` rather than an empty
list.

### R18 — `--restore` is interactive-only (no action possible)

18.10.0 added `omp --restore <session>`: resume, then continue what the last
process left unfinished (the interrupted turn and its subagents). It is **not
reachable from Kabmo** — measured:

```
$ omp --mode rpc-ui --restore /tmp/s/t.jsonl
Error: --restore requires an interactive terminal (not --print or --mode).
```

`main.ts` wires `restoreSession` only inside the `isInteractive` branch; both
RPC modes are excluded. The Kabmo spawns `--mode rpc-ui`, so this is not a gap
that can be closed from here — recorded so it is not "fixed" later.

### R19 — The approval flow now diverges from omp (documented, not changed)

18.10.4 changed the approval prompt to replace the composer; 18.11.0 went
further — **sending a message while an approval is pending DENIES the call and
steers the turn with that message**, so the agent learns why. (`denyingSteering`
exists in 18.11.0 and in neither 18.10.3 nor 18.8.3.)

The Kabmo does the opposite, deliberately and for a measured reason: a pending
dialog parks omp's whole RPC command loop, so `abort`/`abort_and_prompt` are
refused up front (`refuseWhenBlockedOnDialog`, 409 `session_blocked_on_dialog`)
instead of hanging the request, and the dialog is a modal that covers the
composer. Both are correct for their transport; the divergence is recorded so a
future reader does not "align" them by removing the refusal and reintroducing the
hang.

### R20 — Verified still correct at 18.11.0 (do not "fix")

- **RPC wire schema: UNCHANGED since 18.8.3.** 67 commands, `ADDED: []`,
  `REMOVED: []`, 0 command signatures changed. Event unions identical: 31 agent
  events, 20 notifications, 4 inbound frames. `ExtensionUiRequest` still has its
  12 variants. Four defs changed across the whole range and all are inert here:
  `CompactionResult.providerReplayThroughEntryId` (Kabmo reads only
  `summary`/`tokensBefore`), `QueueUpdateEvent`/`QueuedMessagesState.liveSteered`
  and `SessionState.queuedMessages` (Kabmo does not adopt omp's queue —
  P4b–d).
- **TUI-only guard: still exact.** omp has 44 TUI-only names; Kabmo lists
  42, and the two absent are `plan`/`goal`, which Kabmo owns through its
  extension.
- **Builtin tools: identical.** 30 + 3 hidden, unchanged 18.8.3 → 18.11.0.
  `tern-media.ts` is new but is a `read.ts` helper, not a tool.
- **The `runtime` session-entry field is new and harmless.** 18.11.0 stamps
  every entry with the writing build (`{version, commit?, branch?, diff?,
  label?}`); Kabmo's parser ignores unknown fields, and no surface displays
  it.
- **Chamber schema extras: 0 rejected.** All 15 documented keys answer
  `omp config get`; the merged table's only rejections were the two R12 rows.
- **STT worker transport.** `omp __omp_worker_stt` still exists
  (`src/cli.ts`); `transcribe`/`download`/`ping` unchanged. The streaming frames
  are new and unused.

## 18.11.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R12 | 2 rows removed upstream, still offered | regenerated schema (414 → 412) | `omp:schema:check` passes; live `config set` refuses them |
| R13 | stderr dropped, reason lost | `config-cli.ts` reads both streams; first line wins | `config-cli.test.ts` (stub omp), 9 tests |
| R14 | 5th STT key unreachable | added to `STT_MODELS` | `models.test.ts` asserts the key set against omp's |
| R15 | `stt.language` hidden AND unused | schema row + `language.server.ts` + socket default | `language.server.test.ts` (stub omp), 5 tests |
| R16 | 9 of 15 roles editable | `RoleEditor` lists all 15, sectioned | `RoleEditor.test.ts`, 4 tests |
| R17 | saved resets had no surface | `reset.server.ts` + route + section in both panels | `reset.server.test.ts` (11) + live HTTP smoke |
| R18 | `--restore` unreachable | none possible — interactive-only | `omp --mode rpc-ui --restore` exits 1 |
| R19 | approval flow diverges | documented, not changed | 18.11.0 `denyingSteering`; Kabmo 409 by design |
| R20 | wire/tools/guard unchanged | none needed | wire diff 67/67, role diff 0, tool diff 0 |
