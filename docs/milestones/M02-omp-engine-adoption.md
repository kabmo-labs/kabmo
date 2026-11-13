# omp 18.8 adoption plan

The Kabmo pinned `OMP_VERSION=18.3.0` in `.github/scripts/install-omp.sh` while
the installed binary was **18.8.3** (2026-10-07); the pin now matches (F9). This document records the audit
of everything between the two versions that Kabmo either gets wrong or
does not use, and the phased plan to close it.

Status: **done** — every phase closed; P4b–d and P5 were measured and deliberately not adopted, and the pin has since moved on to 18.20.0 (2026-11-13).

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

# omp 18.13.0 adoption (2026-10-27)

The installed pin moved **18.12.6 → 18.13.0** (`omp/18.13.0`). Nothing in this
repository declares an omp version — a session child is the globally installed
binary and the committed settings schema is GENERATED from it — so a bump is
three things: regenerate the schema, re-read what the release changed, and adopt
whatever of it reaches a Kabmo surface.

## Method

- `npm pack @oh-my-pi/pi-coding-agent@18.12.6` into a temp tree, then a
  file-by-file diff against the installed 18.13.0 (`src/modes/rpc`,
  `src/session`, `src/tools`, `src/async`, `src/config`, `src/cli`).
- `rpc-wire.schema.json` from both versions, compared for command names, event
  names and per-definition payloads (283 defs each).
- `bun run omp:schema` + `omp:schema:check`, then every merged row probed
  against `omp config list --json` (562 live keys).
- `.github/scripts/install-omp.sh` — the PIN the schema gate installs — bumped
  and re-run (`omp 18.13.0 already installed`, exit 0).
- `MODEL_ROLES`, `BUILTIN_TOOL_NAMES`, `models-config-schema-bundle.ts` read from
  both trees.
- Live: a MOCK console on a temp data dir, the demo session rendered in
  Chromium.

## Findings

### R21 — The committed schema AND the CI pin were a release behind (fixed)

18.13.0 adds one setting row — `async.printWake` (tools / Execution, "Wake Print
Mode on Job Results") — and rewrites the `power.sleepPrevention` copy to say the
machine is kept awake only while a turn runs. `bun run omp:schema` moved the file
**419 → 420 entries** (`10 tabs / 562 settings`) and the gate passes;
**0 of the 436 merged keys** (420 rows + 16 Kabmo extras) are rejected by
`omp config list --json`.

A stale schema is not cosmetic here: the panel offers what the JSON lists, so the
new row would simply not exist until the file was regenerated.

**The pin moved with it** (`.github/scripts/install-omp.sh`, `OMP_VERSION`
`18.12.6` → `18.13.0`), because the `Settings schema` job installs that pin and
regenerates from it. Bumping one without the other is the drift this repo has
already paid for twice: a schema from a newer omp than the pin is reported stale
by CI, and a pin left ahead of the schema hides rows `omp config set` then
refuses. The script's own comment block records this release's delta, next to the
18.12.6 paragraph.

### R22 — `session.warnCost` / `session.maxCost` are new and correctly have NO row (no action)

18.13.0 adds `--warn-cost` / `--max-cost` (and `session.warnCost` /
`session.maxCost`). They are registered **without a `ui` block**, so omp's own
panel does not offer them either, and the generator deliberately carries only
rows upstream renders. A run that reaches the cap answers `prompt_error` with
`code: "cost_cap"` and a self-explaining message ("Cost cap reached: this
session spent $X of its $Y cap (--max-cost / session.maxCost), so the next model
request was not sent."), and Kabmo's `prompt_error` branch already renders
`errorMessage` — so the code needs no mapping. Recorded so a later reader does
not add two rows upstream hides, or invent a `cost_cap` branch that says the same
sentence twice.

### R23 — `wait` / `proc://` gained running-task telemetry (adopted)

`snapshotJobs` now copies `requests`, `cost`, `contextTokens`, `contextWindow`
and (already present, never read here) `stage` out of a task's progress record
into the job snapshot — the numbers behind omp's own row
`… · 90 req · $18.40 · ctx 160K/1M · stage: implementing`. Kabmo's `WaitJob` and
`ProcJob` parsers dropped all of them (they were not on the wire when the panels
were written), so a `wait` or `read proc://` card showed the model and the clock
and **nothing about what a running subagent was spending**.

`src/shared/lib/omp/session/job-progress.ts` is the one formatter both cards
read. Two rules are load-bearing:

- **The fields and their order are omp's; the token rounding is Kabmo's own**
  (`formatCompactTokens` → `163.8K`/`1.0M`, not omp's `164K`/`1M`). Every other
  token label in this console — the context ring, the usage bars — reads that
  way, and a job row that disagreed with the ring beside it would look like a
  second measurement. The cost cutoff IS omp's (`<$0.01` below half a cent).
- **Gated on `status === 'running'`**, for the same reason omp gates its own
  suffix: a stored snapshot must never paint a live counter over a row that has
  already finished.

The wait row keeps its own percent chip, so its line omits the estimate; the
proc row has no chip and carries `~55%`. Verified in Chromium against the demo
session: expanding the card renders
`90 req · $18.40 · ctx 163.8K/1.0M · ~55% · stage: implementing`.

### R24 — The RPC wire is unchanged except three additive definitions (no action)

**67 commands, `ADDED: []`, `REMOVED: []`, 0 command signatures changed**; no
session event was added or removed, and `ExtensionUiRequest` keeps its variants.
Three `$defs` moved, and none of them needs code here:

- `SessionStats.editRejections` — failed edits by `errorKind`. Kabmo never reads
  session stats; the edit card already renders the refusal the tool returned.
- `PromptError.code` — the `cost_cap` code above.
- `BtwHistoryTurn` / `BtwHistoryRecord` — the records gain `images` and lose
  `title` **on the wire** (`RpcBtwHistoryRecord` is `Omit<…, 'title'>`). Kabmo
  implements `/btw` itself over its own tables with a `--resume --no-tools`
  child, never omp's RPC BTW commands, so neither half reaches it.

### R25 — Verified still correct at 18.13.0 (do not "fix")

- **`MODEL_ROLES`: identical.** 16 roles, same labels, same sections, same
  `accepts` predicates. The role table's `18.12.6` references stay as the date
  they were measured.
- **`BUILTIN_TOOL_NAMES`: identical.** Same set, byte-for-byte. The only new file
  under `src/tools` is `browser/relay/extension-files.ts`, a relay helper.
- **The result shapes Kabmo parses are unchanged or additive.** `bash.details.
  service` keeps its shape — service mode now IGNORES `async`/`timeout` with a
  notice instead of throwing, which only turns a refusal into a started service;
  `proc.details` and `wait.details` are unchanged apart from R23.
- **`omp plugin upgrade <id>` still accepts a qualified marketplace id**, and now
  also resolves a bare package-plugin name. That is a fix for this panel, which
  already passes the qualified id.
- **A user's `compat` block survives Kabmo's models.yml writes.** Update/backfill
  touch only `name`/`reasoning`/`input`/`contextWindow`/`maxTokens`/`cost`, so the
  new `compat.requiresThinkingPresence` is neither dropped nor fabricated.

### R26 — Read paths and TUI-only additions (no action)

- **`read` of HEIC/HEIF/AVIF now returns an image**, decoded through ffmpeg 8.1+
  into `image/jpeg`. Kabmo already serves and renders `image/jpeg` (blob magic
  bytes and the extension table both know it), so nothing is needed; on a machine
  without that ffmpeg omp answers "convert it to PNG or JPEG…", which the card
  renders as text.
- **`--no-context-files`, `omp -p --wait-async`, `/local` (`app.local.open`),
  `grep` path exclusions (`!vendor`), and `compat.requiresThinkingPresence`** are
  CLI/TUI/model-file surfaces. Kabmo spawns `--mode rpc-ui` without those flags,
  does not pass grep paths, and owns only the models.yml keys R25 lists.
- **A turn that ends with background jobs still running** now says so in omp's
  TUI working row. That is a TUI rendering change; the RPC frames Kabmo folds
  (`agent_end` / `session_settled`) are the same pair as before.

## 18.13.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R21 | schema + CI pin a release behind | regenerated (419 → 420 rows) and `OMP_VERSION` 18.12.6 → 18.13.0 | `omp:schema:check` passes; 0/436 merged keys rejected; script exits 0 reporting 18.13.0 |
| R22 | cost settings have no `ui` upstream | none — documented | `omp config list --json` carries both; panel mirrors upstream |
| R23 | job telemetry dropped by the panels | `job-progress.ts` + both parsers + both rows | `job-progress.test.ts` (9), parser tests, both panel tests, Chromium |
| R24 | wire unchanged, 3 additive defs | none needed | 67/67 commands, 0 event changes |
| R25 | roles/tools/models writing unaffected | none needed | role diff 0, tool-name diff 0 |
| R26 | read paths / TUI-only surfaces | none needed | HEIC decodes to `image/jpeg`; flags unused here |

# omp 18.13.1 adoption (2026-10-27)

The installed pin moved **18.13.0 → 18.13.1** (`omp/18.13.1`). The same three
things a bump is: regenerate the schema, re-read what the release changed, and
adopt whatever of it reaches a Kabmo surface.

## Method

- `npm pack @oh-my-pi/pi-coding-agent@18.13.0` and `@18.13.1` into a temp tree,
  then a file-by-file diff of both `src/` trees (36 differing paths) and of the
  shipped `dist/` artifacts.
- `rpc-wire.schema.json` from both versions, compared whole: **67 commands, 283
  definitions, byte-identical**.
- `bun run omp:schema` + `omp:schema:check`, then every merged row probed
  against `omp config list --json` (563 live keys).
- `.github/scripts/install-omp.sh` — the PIN the schema gate installs — bumped
  and re-run (`omp 18.13.1 already installed`, exit 0).
- `MODEL_ROLES`, `BUILTIN_TOOL_NAMES`, `models-config-schema-bundle.ts` read from
  both trees.
- omp's OWN approval resolver, driven directly from the installed package
  (`src/tools/approval.ts`) to measure what a restricted folder does in each
  approval mode, and what frame it produces over RPC.

## Findings

### R27 — The committed schema AND the CI pin were a release behind (fixed)

18.13.1 adds one setting row — `tools.restrictedFolders` (interaction /
Approvals, "Restricted Folders") — and nothing else. `bun run omp:schema` moved
the file **420 → 421 entries** (`10 tabs / 563 settings`) and the gate passes;
**0 of the 437 merged keys** (421 rows + 16 Kabmo extras) are rejected by
`omp config list --json`.

**The pin moved with it** (`.github/scripts/install-omp.sh`, `OMP_VERSION`
`18.13.0` → `18.13.1`), because the `Settings schema` job installs that pin and
regenerates from it.

The row's upstream condition is `restrictedFoldersNotProject` — the editor
writes the global layer, so a project-supplied list hides the row. This panel
has no provenance to test that with (`omp config list --json` carries the
effective value and no layer), so the condition degrades to VISIBLE, exactly as
`contextFiles.extra`'s already does. The row is therefore always offered, and
writing it always writes the global layer.

### R28 — `tools.restrictedFolders` asks in EVERY approval mode (adopted)

The folders on that list ask for an explicit approval whatever the mode —
`yolo` included — and no remembered grant, session approval, or ACP "Always
allow" covers it. Measured against omp's own resolver:

| mode | a call inside a restricted folder | a call outside it |
|---|---|---|
| `always-ask` | `prompt` (source `restriction`) | — |
| `write` | `prompt` (source `restriction`) | — |
| `yolo` | `prompt` (source `restriction`) | `allow` (source `mode`) |

A restricted call carries `override: true` and source `restriction`, so
`sessionApprovalScope` returns `undefined` for it: there is NO session-grant
option, and the choices are exactly `["Approve", "Deny"]`.

Three consequences reach a Kabmo surface, and each is fixed here:

- **The gate was routed to an `ask` question's card.** Over RPC the gate is a
  `select` frame — omp's RPC UI context has no `approve` member, so
  `requestApproval` falls back to its `select` branch — and its title names no
  question. The routing that claims a `select` by title therefore fell through
  to the "last ask spoke" walk and landed the gate on an unrelated QUESTION's
  card, where "Approve"/"Deny" rendered as that question's answer options and
  the answer was posted to the wrong tool call. Reproduced against the real
  frame shape: the card claimed `["f1", "g1"]` — the question AND the gate.
- **The thing being approved was invisible.** omp sends the whole prompt as
  the frame's TITLE, newline-separated (`Allow tool: read` / `Reason: …` /
  `Path: …`), and the dialog's header renders a title with `truncate` — one
  line. The reason and the path were clipped out of the only element that
  could show them, so the gate read "Allow tool: read" over a path the user
  never saw.
- **The free-text field could only deny.** The dialog's "Other — type your own
  answer" field is an `ask` question's escape hatch; on a gate omp's answer
  parser reads any string that is not one of its labels as a DENY. Measured:
  `"Approve"` → allow, `"yes please"` → deny. So the field was a way to refuse
  the call by typing near-miss text, and never a way to approve it.

### R29 — The RPC wire, the roles and the tool set are unchanged (no action)

**67 commands, 283 definitions, the whole `rpc-wire.schema.json` byte-identical
** to 18.13.0. `MODEL_ROLES`, `BUILTIN_TOOL_NAMES` and
`models-config-schema-bundle.ts` are identical too, and `omp usage --json`'s
payload is untouched (the release's usage change is in the CLI's own text
formatting, which this console does not read).

### R30 — TUI-side and in-omp changes that do not reach Kabmo (no action)

- **`/pause` now reports draining turns and running jobs** across the
  subagent tree, and fewer redraws happen during background subagent progress.
  Both are the TUI's own rendering; `/pause` is in Kabmo's TUI-only command
  list, so it is refused rather than forwarded.
- **A task subagent no longer receives `AGENTS.md`** — including from
  additional workspace roots it rediscovers. A subagent's own context file
  list is omp's, not Kabmo's.
- **An `ask` note now names the option it belongs to** (`(note on Y: …)`), and
  a note added right after picking an answer lands on that answer rather than
  the next question's. Both change omp's own rendering of an answer, not the
  answer payload Kabmo reads (`details.results[].selectedOptions`).
- **A hashline `PUT` that restates a line next to the range** is applied
  instead of refused, and an advisor now waits out a timed 429 rather than
  dropping its review. Both are fixes inside omp.

## 18.13.1 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R27 | schema + CI pin a release behind | regenerated (420 → 421 rows) and `OMP_VERSION` 18.13.0 → 18.13.1 | `omp:schema:check` passes; 0/437 merged keys rejected; script exits 0 reporting 18.13.1 |
| R28 | restricted folders ask in every mode | `approval-gate.ts` + the routing, the prompt split, and the free-text guard | `approval-gate.test.ts` (8), `ask-frames.test.ts` (10), `approval-gate.test.tsx` (5); resolver measured per mode |
| R29 | wire / roles / tool set unchanged | none needed | wire schema byte-identical; role, tool-name and model-schema diffs 0 |
| R30 | TUI-side and in-omp changes | none needed | `/pause` is TUI-only here; subagent context and answer payloads are omp's |
# omp 18.14.0 adoption (2026-10-30)

The installed pin moved **18.13.1 → 18.14.0** (`omp/18.14.0`), which carries
18.13.2 and 18.13.3 with it. Same three steps as every bump: regenerate the
schema, re-read what the release changed, adopt whatever reaches a Kabmo
surface.

## Method

- `bun add @oh-my-pi/pi-coding-agent@18.13.1` and `@18.14.0` into a temp tree,
  then `diff -rq` over both packages (490 differing paths) and a targeted read
  of each file whose subject Kabmo touches.
- `rpc-wire.schema.json` from both versions compared whole: **67 → 73 commands,
  283 → 295 definitions**, every difference ADDITIVE.
- Every setting id in `src/**/*.ts` extracted from both trees and diffed;
  `bun run omp:schema` + `omp:schema:check`, then every merged row and every
  Kabmo extra probed against the 574 live keys of `omp config list --json`.
- Real children driven over `--mode rpc-ui` for each claim: a `/compact`
  prompt, `set_model` with an exact and a near-miss selector, `dictation_start`,
  and a `get_state` handshake.
- `.github/scripts/install-omp.sh` — the PIN the schema gate installs — bumped
  and re-run.

## Findings

### R31 — The schema and the CI pin were a release behind (fixed)

`bun run omp:schema` moved the file **421 → 431 entries** (`10 tabs / 574
settings`). Ten rows are new; `gc.autoCompress` is the only new setting with no
row, and that is upstream's own decision (it registers without a `ui` block, so
omp's panel hides it too). **0 of the 431 rows and 0 of the 16 Kabmo extras**
are rejected by `omp config list --json`.

The pin moved with it (`OMP_VERSION` `18.13.1` → `18.14.0`), because the
`Settings schema` job installs that pin and regenerates from it.

### R32 — The RPC wire grew, additively (adopted where it reaches Kabmo)

Six new commands — `navigate_tree`, `set_label`, `abort_branch_summary`,
`dictation_start`, `dictation_stop`, `live_connect` — plus `secret` on
`InputUiRequest`, the `manual_compaction_*` and `dictation_*` events, and a
`LiveConnect*` pair. No existing command or payload changed shape: `get_state`,
`prompt`, `compact`, `set_model`, `set_event_filter`, `set_ask_dialog`,
`SessionState`, `PromptAck`, `ModelInfo`, `CompactionResult`, `PromptError` and
every approval frame are byte-identical.

`MessageUpdates`' description now says delta mode REPLACES the accumulated
snapshot with the block a start/end event touches. Kabmo negotiates `"full"`
and the reason for that choice (the tool call's name/id live on the seed block)
is unchanged, so nothing moves.

`navigate_tree`/`set_label`/`abort_branch_summary` are the RPC face of `/tree`
and `/branch`, which Kabmo refuses as TUI-only and answers with its own
JSONL rewind (`rewind-file.ts`). They stay unused: adopting them would be a
second branch implementation, not a bump.

`dictation_*` is draft-only speech-to-text over RPC, which would let Kabmo drop
the `__omp_worker_stt` IPC child it spawns (`omp-stt-worker.ts`). Not adopted
here — it is a feature, not a compatibility fix — and the worker protocol is
untouched in this release (`asr-protocol.ts`, `asr-client.ts`, `models.ts` and
`stt/settings.ts` are byte-identical), so the existing path still works.

### R33 — `/subagents` is a new TUI-only alias (adopted)

18.14.0 gives `hub` the alias `subagents`. The guard table in
`shared/lib/chat/composer/tui-only.ts` is keyed on NAMES, so the alias was
forwarded to the model as literal text — the exact failure that module exists
to prevent. Measured: `/subagents` is absent from `available_commands_update`
and `handleTui` is its only handler.

### R34 — A manual compaction is now announced (adopted)

`compact` (RPC), `/compact` (typed), and an extension's `ctx.compact()` now
emit `manual_compaction_start` / `manual_compaction_end`. Kabmo folded only the
`auto_*` pair. Measured on a real child: a `/compact` prompt answers
`manual_compaction_start`, then `_end`, then the `command_output` carrying
omp's own sentence — and on 18.13.1 that sequence produced NO compaction frame
at all.

Two consequences, both fixed by folding the pair into the same branch:

- `compacting` stayed false for the whole pass, so `isBusy()` reported an idle
  session while omp was rewriting the transcript. A command timeout's reset, or
  a Stop escalation, could kill a compaction the user asked for.
- `clearSessionFileCaches()` never ran on the manual path, so the scan cache
  (keyed on `(size, mtimeMs)`, which an in-place rewrite need not move) kept
  serving the pre-compaction read.

### R35 — `input` dialogs can now be secret (adopted)

`ctx.ui.input({ secret: true })` masks typed characters and forwards `secret`
on the RPC frame. Kabmo rendered every `input` as `type="text"`, so a password
would have been drawn in clear text. Both renderers now switch on it
(`extension-dialog/index.tsx`, `ask-panel/FrameControl.tsx`), and the provider
login flow — whose OAuth code field must never receive a password — now cancels
a secret prompt instead of taking it for its own.

### R36 — Provider-qualified selectors are exact now (breaking, no action)

A `provider/id` selector naming a known provider resolves exactly or not at
all; the provider-scoped fuzzy match is gone, and a near miss fails with
"Did you mean …" instead of silently running a sibling model. Measured on a
real child: `set_model aihub-brisnets-jatis/deepseek-v4` answers
`Model not found: …`, and the CLI refuses the same selector with the hint.

Nothing in Kabmo needs changing: every selector it writes is built from an
`omp models --json` row (`provider/${id}`), which is exact by construction —
`catalog.server.ts`, `resumable-model.server.ts`, `goal-auditor` and the role
editor all do this. What changes is the failure mode of a STALE stored value:
it now fails loudly rather than running the wrong model. Bare selectors
(`opus`) keep their fuzzy matching, so the free-text audit-model field is
unaffected.

### R37 — Custom tool loaders and WebMCP changed (no action)

Custom tool factories take `cwd` as their first argument instead of a `pi`
namespace, and WebMCP moved to Chrome's native support. Kabmo ships no custom
tools (its extension registers commands, not tools) and does not drive WebMCP.

### R38 — TUI-side and in-omp changes that do not reach Kabmo (no action)

`out://` replies (off by default outside the TUI), session pinning, the
`/context` viewer, prewalk model settings, HTML exports, computer-tool approval
modes, `task.file`, and the LSP/gh/browser fixes are all either TUI-only or
behind a tool Kabmo never renders. `builtin-names.ts` and `MODEL_ROLES` are
identical to 18.13.1, and `models-config-schema-bundle.ts` only gains
`discovery.advertisedReasoning` (Kabmo writes `discovery` blocks, but that key
is optional and unset).

## 18.14.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R31 | schema + CI pin a release behind | regenerated (421 → 431 rows) and `OMP_VERSION` 18.13.1 → 18.14.0 | `omp:schema:check` passes; 0/447 merged keys rejected; script exits 0 reporting 18.14.0 |
| R32 | wire grew additively | none needed for the existing surfaces | 6 commands + 12 definitions added, 0 removed; every payload Kabmo reads byte-identical |
| R33 | `/subagents` alias reaches the model as text | `tui-only.ts` + its test | guard smoke against the shipped module: refused with the notice; `/usage` and `/model opus` still pass |
| R34 | manual compaction was invisible | `frame-fold.ts` folds both pairs; 2 tests | fold smoke with the frames a real child emitted: `compacting` true → false |
| R35 | secret input drawn in clear text | both dialog renderers + the login guard; 2 tests | render smoke: `secret:true` → `type="password"`, absent → `text` |
| R36 | qualified selectors now exact | none needed | every Kabmo selector comes from an `omp models` row; near-miss measured failing |
| R37 | custom tools / WebMCP | none needed | no custom tools shipped; WebMCP unused |
| R38 | TUI-side and in-omp changes | none needed | role, tool-name and `builtin-names` diffs 0 |

# omp 18.15.0 adoption (2026-11-01)

The installed pin moved **18.14.0 → 18.15.0**. Same three steps as every bump:
regenerate the schema, re-read what the release changed, adopt whatever reaches
a Kabmo surface.

## Method

- `npm pack @oh-my-pi/pi-coding-agent@18.14.0` and `@18.15.0` into a temp tree,
  then `diff -rq` over both packages (**222 differing paths**) and a targeted
  read of each file whose subject Kabmo touches.
- `rpc-wire.schema.json` from both versions compared whole: **73 → 74 commands,
  295 → 297 definitions**, every difference ADDITIVE.
- `bun run omp:schema` + `omp:schema:check`, then every merged row probed
  against the **579** live keys of `omp config list --json`.
- The TUI-only slash-command set extracted from both trees' registries
  (`handle` vs `handleTui`): **158 names, 41 TUI-only, identical in both**.
- `bun run scripts/omp-schema.mjs --check` after installing 18.15.0 globally;
  `omp models --json --kind all` and `omp config list --json` exercised on the
  installed binary (256 model rows, 579 config keys).
- The release's own `snapshotJobs` driven with a job that carries an `intent`,
  to confirm the field survives into the `wait`/`proc://` snapshot.

## Findings

### R39 — The job snapshot gained `intent`, which Kabmo dropped (fixed)

18.15.0 records the caller's `i` intent on the background job it starts, and
omp's own `/jobs` rows, `proc://` listing and jobs sheet lead with it before the
command line. Measured with the release's `snapshotJobs`:

```js
snapshotJobs({}, [{ id: 'bg_1', type: 'bash', status: 'running', label: 'bun run dev',
                    intent: 'Start the dev server', startTime: Date.now() - 42_000 }])
// [{ id:'bg_1', type:'bash', status:'running', label:'bun run dev',
//    intent:'Start the dev server', durationMs:42000 }]
```

Kabmo's `wait` and `proc://` cards parsed `label` only, so the purpose the model
had already stated was dropped and the raw command stood in for it. Both job
views now carry `intent` (`shared/lib/omp/session/{wait,proc}.ts`), and one
resolver — `jobSubject` in `shared/lib/omp/session/job-progress.ts` — decides
the subject for every job row: the intent when present, the label beneath it,
the label alone otherwise. Two tests per surface plus four on the resolver.

`intent` is set only by the tools that start a single job (`bash`), so a
`task` row has none and keeps its label — the fallback is the common path, not
an edge case.

### R40 — The settings schema and the CI pin were a release behind (fixed)

`bun run omp:schema` moved the file **431 → 435 entries** (`10 tabs / 579
settings`). Four rows are new: `providers.openai-codex.daybreak` (providers /
Protocol), `task.perCallModel` and `task.perCallModelAllow` (tasks / Subagents),
`title.refreshAfterPrompts` (tasks / Modes). **0 of the 435 rows** are rejected
by `omp config list --json`.

One new upstream condition arrives with them, `perCallModelAllowNotProject`: it
hides the allowlist row when a PROJECT layer supplies it, and `omp config list
--json` carries no provenance, so this panel degrades it to visible — exactly
the decision `contextFilesExtraNotProject` and `restrictedFoldersNotProject`
already take (`isConditionMet`'s default arm).

The pin moved with it (`OMP_VERSION` `18.14.0` → `18.15.0`), because the
`Settings schema` job installs that pin and regenerates from it.

### R41 — The RPC wire grew by one command (adopted nowhere, by design)

74 commands and 297 definitions: `get_session_lease` plus
`GetSessionLeaseParams`/`GetSessionLeaseResult` (`{held: string[], unknown:
string[]}`). `RpcAgentEvent`, `RpcInbound`, `RpcServerFrame`, `RpcNotification`,
`SessionState`, `PromptAck`, `ModelInfo` and every approval frame are
byte-identical.

Not adopted. Kabmo already answers both halves of the lease question with the
same primitive omp uses: `lease-flock.server.ts` probes the `flock` and
`lease-holder.server.ts` names the holding pid, which RPC cannot (the report
lists ids, not owners). Replacing that with an RPC round-trip would lose the
pid, and the pid is what maps a holder to the Kabmo instance a client must be
relayed to.

### R42 — `title.refreshAfterPrompts` is unreachable under rpc-ui (no action)

The new setting retitles a generated title once the judge finds it stale. It is
gated by `#scheduleTitleRefresh`, which opens with `if ($env.PI_NO_TITLE)
return`, and `main.ts` sets `PI_NO_TITLE=1` for `--mode rpc`, `rpc-ui` and
`acp`. Kabmo's children run `--mode rpc-ui`, so the row exists in the panel and
changes nothing there. Kabmo owns titling through its own `/rename` path
(`session/auto-title.server.ts`), which is a different mechanism entirely.

### R43 — `task.perCallModel` grants a model per subagent call (no action)

`off` by default. Turning it on lets a task item or an eval `agent()`/
`workpool()` call name one exact model, approved against
`Settings.grantAuthority()` (an operator-only view that deliberately excludes
project settings) and narrowed by `task.perCallModelAllow`. Kabmo never sends a
per-call `model` on a task item — subagent work is spawned by the agent itself,
through omp's own task tool — so there is no selector here to approve. The row
is editable in the panel because it is a real omp setting; enabling it changes
what the MODEL may do, not what Kabmo sends.

### R44 — TUI-side and in-omp changes that do not reach Kabmo (no action)

Asking a dialog to close when a USER-queued message arrives, the eval kernel
restart notice, snapcompact's kept text for image-less models, job captions
written by the `widget` role, `/fast` accepting `ultrafast` from a relay's
`service_tiers`, the LSP Rust-crate rescan, and the STT preview throttle. Each
is inside omp's own TUI or its own tools. The STT worker protocol Kabmo speaks
(`asr-protocol.ts`, `asr-client.ts`, `models.ts`, `stt/settings.ts`) is
byte-identical, so `omp-stt-worker.ts` is untouched.

`builtin-names.ts`, `MODEL_ROLES` and the 41 TUI-only slash commands are
identical, so `tui-only.ts` needs no new row.

## 18.15.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R39 | job `intent` dropped from both job cards | `wait.ts`/`proc.ts` parse it; `jobSubject` picks the subject; 2 panel tests | render smoke: intent drawn ABOVE the command on both cards; a task row with no intent still reads |
| R40 | schema + CI pin a release behind | regenerated (431 → 435 rows) and `OMP_VERSION` 18.14.0 → 18.15.0 | `omp:schema:check` passes; 0/435 rows rejected by `omp config list --json` |
| R41 | `get_session_lease` added | none — Kabmo's `flock` probe also names the holder pid | wire diff: 1 command + 2 definitions added, 0 removed, every read payload byte-identical |
| R42 | title refresh is PI_NO_TITLE-gated | none needed | `main.ts` sets it for `rpc-ui`; Kabmo titles through its own `/rename` |
| R43 | per-call model grant | none needed | Kabmo sends no per-call `model` on task items |
| R44 | TUI-side / in-omp changes | none needed | STT worker modules, `builtin-names.ts`, `MODEL_ROLES` and the 41 TUI-only names all byte-identical |

# omp 18.16.0 adoption (2026-11-02)

The installed pin moved **18.15.0 → 18.16.0**. Same three steps as every bump:
regenerate the schema, re-read what the release changed, adopt whatever reaches
a Kabmo surface.

## Method

- `npm pack @oh-my-pi/pi-coding-agent@18.15.0` and `@18.16.0` into a temp tree,
  then `diff -rq` over both packages (**148 differing paths**) and a targeted
  read of each file whose subject Kabmo touches.
- `rpc-wire.schema.json` from both versions compared as a whole **and** as a
  flattened leaf map: **74 commands, 297 definitions, 0 added, 0 removed, 0
  changed**; the only leaf that moved is `BashResult.minimized` gaining
  `"type": "object"`.
- The schema generator was proved deterministic before trusting it: run against
  a temp 18.15.0 tree it reproduces the committed file **byte-for-byte**
  (435 entries), and against 18.16.0 it writes 438.
- `bun run omp:schema` + `omp:schema:check`, then every merged row probed
  against the **582** live keys of `omp config list --json` (0 rejected).
- The TUI-only slash-command set extracted from both trees: unchanged, so
  `tui-only.ts` needs no row.
- A live probe of the new `minimized` record: `omp --mode rpc-ui` in a
  60-commit temp repo, one `bash` command `git --no-pager log`, which answered
  `{filter:"git", inputBytes:10970, outputBytes:3905, artifactId:"0"}` and wrote
  `<sessionId>/0.bash-original.log`.

## Findings

### R45 — A minimized `bash` result said nothing about the rewrite (fixed)

18.16.0 returns `details.meta.minimized` when its shell minimizer compressed the
command's output, and its own TUI states it (`Minimized: git 120.4KB → 3.2KB`).
Kabmo rendered the compressed body as if the command had produced it, so a
`git log` that lost 7 KB of commits looked complete — the reader had no way to
know a rewrite had happened, let alone reach the original.

`minimizedOutputOf` / `minimizedLabel` (`shared/lib/chat/tool/minimized.ts`)
parse and format the record; the collapsed card states it as a `warn` fact
**before** the line count (the count describes the rewrite), and the Bash panel
draws a `Minimized <filter> <in> → <out>` strip above the command window.

### R46 — The lossless original had no path through the artifact chip (fixed)

`minimized.artifactId` names a file of a kind Kabmo did not know:
`bash-original`, beside the `bash` stream the truncation record points at.
`artifactRefOf` now reads the minimizer record FIRST (it holds the command's own
bytes; a truncation record only ever holds the already-rewritten stream),
returns `kind: 'bash-original'`, and derives `elidedBytes` as
`inputBytes - outputBytes`. `ARTIFACT_KINDS` already carried `bash-original`,
so the route and the reader needed no change.

Verified end to end: the chip opens the modal with
`10.7 KB · 360 lines · 6.9 KB elided inline` for the probe session, and
`GET /api/omp/artifact?…&kind=bash-original` answered `200` with the 3962-byte
original of a real Kabmo session's minimized `read`.

### R47 — The schema and the CI pin were a release behind (fixed)

`bun run omp:schema` moved the file **435 → 438 entries** (`10 tabs / 582
settings`). Three rows are new: `btw.inject` and
`composer.predictionAlternatives` (interaction / Input),
`hindsight.globalScope` (memory / Hindsight). **0 of the 438 rows** are rejected
by `omp config list --json`.

One new upstream condition arrives with the alternatives row,
`composerPredictionsEnabled` (`composer.predictions === true`).
`isConditionMet` now answers it — the default arm would have shown a modifier
row whose parent was switched off.

The pin moved with it (`OMP_VERSION` `18.15.0` → `18.16.0`), because the
`Settings schema` job installs that pin and regenerates from it.

### R48 — New rows that have no Kabmo surface (no action)

- `btw.inject` drafts an `<inject>` steering block for omp's own `Alt+I`. Kabmo's
  side panel is its own child with its own transcript; there is no inject path
  to wire, and the row stays editable because it is a real omp setting.
- `composer.predictions` / `composer.predictionAlternatives` are the TUI
  composer's ghost text. Kabmo's composer has no prediction surface.
- `hindsight.globalScope` widens what the MODEL may retain (a memory every
  project recalls). It changes what the agent may do, not what Kabmo sends —
  the same class as `task.perCallModel`.

### R49 — Changes that do not reach Kabmo (no action)

The release's remaining work is inside omp: `/resume` filling from
`history.db` (`PickerListing` is a TUI picker type; Kabmo reads the JSONL and
its own sidebar snapshot), `mountedTools` on a task entry (Kabmo never reads a
task entry's tool list), the date-cwd reminder journal (a session `custom` entry
with no content, which `noticeFromCustomMessage` already drops), the prompt-preflight
error class (it reaches RPC as a thrown prompt error, which `frame-fold` already
surfaces as `prompt_error`), `gh`'s origin correction and the browser/cmux fixes.

`builtin-names.ts`, `MODEL_ROLES`, the 41 TUI-only slash commands and the STT
worker modules are unchanged.

## 18.16.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R45 | minimized rewrite invisible on the card | `minimized.ts` + `bash-facts.ts` + Bash strip; 10 unit tests + 2 panel tests | browser smoke on a real 18.16.0 session: chip reads `git 10.7 KB → 3.8 KB`, strip reads `Minimized git 10.7 KB → 3.8 KB` |
| R46 | lossless `bash-original` unreachable | `artifactRefOf` reads `minimized` first, kind `bash-original` | chip opened the modal at `360 lines · 6.9 KB elided`; route answered the real file |
| R47 | schema + CI pin a release behind | regenerated (435 → 438) and `OMP_VERSION` 18.15.0 → 18.16.0 | `omp:schema:check` passes; 0/438 rows rejected; generator proved byte-identical at 18.15.0 first |
| R48 | three new rows, no Kabmo surface | none needed | each verified TUI-only or model-capability only |
| R49 | TUI/internal changes | none needed | wire diff 0 added/removed/changed; name and role tables byte-identical |

# omp 18.17.0 adoption (2026-11-06)

The installed pin moved **18.16.0 → 18.17.0**. Same three steps as every bump —
regenerate the schema, re-read what the release changed, adopt whatever reaches a
Kabmo surface — plus one operational fact this release exposed: the schema
generator reads the **npm package**, not the `omp` binary, so a machine whose
binary self-updated to 18.17.0 still regenerates the 18.16 schema until
`bun add -g @oh-my-pi/pi-coding-agent@18.17.0` runs.

## Method

- `npm pack @oh-my-pi/pi-coding-agent@18.16.0` and `@18.17.0` into a temp tree,
  then `diff -rq` over both packages (**431 differing paths**) and a targeted
  read of each file whose subject Kabmo touches.
- `rpc-wire.schema.json` from both versions compared as a whole and as a
  flattened leaf map: **74 commands (unchanged), 297 → 298 definitions, 0
  removed, 0 changed** beyond the additions listed under R52; all **33
  `RpcAgentEvent` variants byte-identical**. `builtin-names.ts` and
  `MODEL_ROLES` identical.
- The schema generator was proved deterministic before trusting it: run against
  a temp **18.16.0** tree it reproduces the committed file **byte-for-byte**
  (438 entries), and against 18.17.0 it writes **450** — twice, from two
  independent trees.
- `bun run omp:schema` + `omp:schema:check`, then every merged row probed
  against the **602** live keys of `omp config list --json` (0 rejected).
- The slash-command registry extracted from both trees: 88 → 89 specs, and the
  **47-name TUI-only set is unchanged**. `unpin` (the one addition) carries a
  text-mode `handle`, so it is *not* TUI-only and `tui-only.ts` needs no row.
- Live probes against a real 18.17.0 child: direct `bash` calls (truncation
  fields), full agent turns (tool-result `details`, progress-frame volume,
  protocol-v2 chunking).

## Findings

### R50 — `wait` lost its 30-minute cap, and the card kept counting down (fixed)

18.17.0 deletes `WAIT_MAX_MS` and the `"Wait limit reached…"` answer. A blocking
wait now returns when its window elapses with nothing new, and the window climbs
a ladder — **5 s, 10 s, 30 s, 60 s, 5 min** — across back-to-back idle waits,
resetting to the floor once the agent works in between. From the second rung it
appends a `<system-notice>Nothing new after … of back-to-back waits` block saying
waiting is not progress. Neither the rung nor the streak is a field: both are in
that prose.

Kabmo stated the old ceiling and counted down to it (`0:07 left of 30:00`),
which after the removal claimed a budget omp no longer has. `shared/lib/omp/
session/wait-idle.ts` now owns `WAIT_LADDER_MS` and parses the two sentences
(`waitIdleOf` / `waitIdleLabel`); the card drops the countdown and reports the
outcome (`idle 10s`, `idle 15s total`) instead of claiming "no jobs".

### R51 — `details.waited` became an array (fixed)

`messageResult(senderId, waited: IrcMessage[])`: one wake returns every message
queued by then, oldest first. Kabmo parsed the field with `isRecord`, which
refuses arrays, so `waited` came back `undefined` — the message block and the
`message received` chip vanished silently on every new wait. `WaitView.waited`
is now `WaitMessage[]`; the single-object shape is still read because the JSONL
of a session recorded on 18.16.0 keeps it, and the transcript is what a reload
reads.

### R52 — every `bash` frame carries the embedded shell's trace (fixed)

18.17.0 stamps `details.trace` (`{units, history}`) on every progress frame and
on the final result, whether or not anyone draws it: the tool wires `onTrace`
whenever it has an `onUpdate` callback, and `display.shellVisualization` only
gates omp's own rendering. `history` repeats the command's output. Measured on
this machine:

| case | 18.16.0 | 18.17.0 |
|---|---|---|
| 40 output lines over 8 s | 43 updates / 19 KB | 82 updates / **192 KB** |
| 120 lines over 73 s | — | 242 updates / **9.2 MB** (3.3/s) |
| 40 000-line result | 3 updates / 153 KB, max frame 51 KB | 5 updates / **1.15 MB**, max frame **311 KB** |
| `seq 1 30000` | — | trace **201 KB** on the result, `history` 201 KB of it |

A >1 MiB frame is legal only because Kabmo negotiates protocol v2 (measured: a
1005 KB frame arrived as **72 `rpc_chunk` records**). `stripShellTrace` drops the
field at the fan-out — the one point every subscriber is reached, including the
`session:<id>` topic that publishes to each open tab — and `withoutShellTrace`
drops it again when a transcript is read from disk, because omp writes it into
the JSONL too.

### R53 — the silent `bash` result changed wording (fixed)

`#formatResultOutput` now answers `"(no output, exit code 0)"` for a clean run
with nothing printed (it was `"(no output)"`). The Bash card matched only the
old string, so a command that printed nothing fell into the console branch with
omp's placeholder as its body. Both spellings now read as silence.

### R54 — `set_todos` moved its persistence (no action)

`rpc_mode`'s `set_todos` now calls `session.commitTodoPhases`, and the
`user_todo_edit` custom entry is appended inside that method instead of by the
RPC handler. The entry type and body are identical, so `todo/snapshot.ts` and the
reload path are unaffected — verified against both implementations.

### R55 — `update.auto`, and `omp update` refuses a concurrent install (no action)

`update.auto` (default `false`) lets omp install a release in the background;
`omp update` now refuses while another update is installing. Kabmo still drives
`omp update` explicitly from `/api/omp` and reads its exit code, so the refusal
arrives as an error rather than a silent no-op. The row stays editable: it is a
real omp setting, and the panel is the only place to reach it.

### R56 — ovnfs changes what the agent does with worktrees (no action)

When the `ovnfs` binary is found (or `ovnfs.path` is set), omp's system prompt
tells the agent to open ovnfs checkouts instead of git worktrees or copies, and
isolated subagents run in checkouts under `isolation.backend: auto`. That is
agent behaviour, not a Kabmo surface — the workspace panels still read the repo
the user opened, and a checkout is a separate path the agent reports itself.

### R57 — settings rows with no Kabmo surface (no action)

Twelve rows arrive (`display.shellVisualization`, `tui.colorfulMarkdown`,
`tui.motion`, `tui.maxFps`, `tui.spinnerInterval`, `extensionRenderers.
transcriptPresenters`, `spotlight.experiment.enabled`, `magicKeywords.chillax`,
`update.auto`, `ovnfs.path`, `task.workerThreads`, `providers.
openaiResponsesWebsockets`); all are TUI-only or a model capability, and all stay
editable because the panel is the only path to an omp setting. `textVerbosity`'s
**default moved `medium` → `low`** and `edit.mode` gained `none`, both carried by
the regenerated schema. `skills.manualSkills` exists live but has no `ui` block,
so it is absent from omp's own panel too — the generator drops it by design.

## 18.17.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R50 | wait cap gone, countdown lied | `wait-idle.ts` (ladder + prose parser); card badge and chip state the idle window | 8 unit tests on the parser/label; 3 panel tests (no `left of`, `idle 15s total`, a service wake is not idle) |
| R51 | `waited` array dropped the message | `WaitView.waited: WaitMessage[]`, both shapes parsed; panel lists every message | unit tests for array + legacy object + empty; panel test renders two messages in order |
| R52 | `details.trace` flooded frames and JSONL | `shell-trace.ts`; stripped at `EventFanout.emit` and on transcript reload | 8 strip tests (incl. a fan-out emit with a real-shaped frame) + reload test; measured the field's cost on a live child |
| R53 | silent bash rendered the placeholder | `isSilent` matches both spellings | 2 panel tests (`(no output, exit code 0)`, `(no output)`) |
| R54 | `set_todos` persistence moved | none needed | entry type and body compared in both implementations |
| R55 | `update.auto` + concurrent-install refusal | none needed | Kabmo still runs `omp update` and surfaces its exit code |
| R56 | ovnfs checkouts replace worktrees | none needed | agent behaviour, no Kabmo reader |
| R57 | schema + CI pin a release behind | regenerated (438 → 450, 582 → 602 settings) and `OMP_VERSION` 18.16.0 → 18.17.0 | `omp:schema:check` passes; 0/450 rows rejected; generator byte-identical at 18.16.0 first, 450 deterministic at 18.17.0 |

# omp 18.18.1 adoption (2026-11-08)

The installed pin moved **18.17.0 → 18.18.1**, carrying 18.18.0. This one is a
**settings-identical** release: the schema does not move by a byte, and the only
code Kabmo changes is a comment. The pin still moves, because the patch carries
crash fixes in the embedded shell that took whole sessions down.

## Method

- `npm pack @oh-my-pi/pi-coding-agent@18.17.0` and `@18.18.1` into a temp tree,
  then `diff -rq` over both packages (**120 differing paths**, 74 under `src/`).
- `rpc-wire.schema.json` compared whole and as a flattened leaf map: **74
  commands, 298 definitions, 0 removed, 3 added leaves, 1 changed leaf (a doc
  string)**; all **33 `RpcAgentEvent` variants byte-identical**.
- The schema generator run against 18.18.1 produces a file **byte-identical to
  the committed 18.17.0 one** (`10 tabs / 602 settings`, 450 rows), from a clean
  temp tree as well as in place. `omp config list --json` still answers **602**
  keys and **0 of 450 rows is rejected**.
- Slash registry extracted from both trees: **89 specs, 47 TUI-only names**,
  identical row for row. `builtin-names.ts` and `MODEL_ROLES` identical.
- Live child probe: the `ready` frame now advertises
  `supportsBashExcludeFromContext: true`; a real `bash` tool call carries
  `details.cwd`, `details.trace` and the rest of the 18.17.0 shape.

## Findings

### R58 — the settings surface did not move (no action)

Nothing to regenerate beyond proving it: `textVerbosity`, `edit.mode` and the
twelve rows 18.17.0 added are unchanged. `spotlight.experiment.holdout`'s
default moves `0.15 → 0.05` upstream, but that setting carries no `ui` block, so
neither omp's own panel nor this schema offers it — the generator's rule, not a
gap.

### R59 — the shell trace is now gated by `display.shellVisualization` (doc only)

18.17.0 emitted `details.trace` regardless of the setting; 18.18.0 omits it —
from progress frames, results and saved sessions, ACP included — when the row is
off. The default is still `true`, so the field arrives unless an operator turns
it off, and Kabmo keeps dropping it at the fan-out and on reload. The module doc
in `shared/lib/omp/session/shell-trace.ts` said the setting "only gates omp's own
drawing"; that sentence is now false and was corrected.

### R60 — `cd <dir>; …` is hoisted, and `details.cwd` names where it ran (adopted by the field)

A leading `cd <dir>;` used to run the remainder in the session cwd. It now
hoists into `<dir>` when that path exists (and is not an internal-scheme URL),
and the result carries `details.cwd` plus `details.cdSeparator: ';'` for
renderers that redraw the command. Kabmo's Bash card already read `details.cwd`,
so the directory now appears beside the command; the command itself is still
rendered as the model wrote it, so the `cd` is not lost. A panel test pins that
the new field reaches the line.

### R61 — `bash.excludeFromContext` and its `ready` capability (no action)

The RPC `bash` command accepts `excludeFromContext: true` to keep a run out of
the model's context like terminal `!!`, and the `ready` frame advertises
`supportsBashExcludeFromContext`. Kabmo has no first-party caller of that
command — the terminal panel and the Command Runner spawn their own children —
so there is nothing to exclude and no capability gate to add. It is recorded
here so the next reader does not mistake the missing option for an oversight.

### R62 — upstream fixes and internals (no action)

The release's reason to take it: the embedded shell no longer crashes on a bare
`[` mid-stream, on bytes that are not valid UTF-8, or on a long multi-byte
assignment, and `grep -e`/`rg -e` accept dash-leading patterns. Also upstream and
invisible here: the compound-command approval matcher and `file-approval` (they
change WHEN omp asks; Kabmo renders whatever dialog arrives), the `LANG`/
`LC_ALL=C.UTF-8` pin for agent commands (it makes tool messages and sort order
machine-independent), the title path for a prompt with no titleable text (gated
by `PI_NO_TITLE`, which `rpc-ui` still forces, and Kabmo titles itself),
`ShellTraceBytes` (no trace reader), prewalk/subagent/MCP/hindsight/browser/LSP
fixes, and the Rust SDK's `exclude_from_context` fields.

## 18.18.1 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R58 | schema identical | none — regenerated to prove it | 450 rows both, byte-identical file; 0/450 rejected; 602 live keys |
| R59 | trace gated by a setting | module doc corrected; strip unchanged | generator diff + the gating read in `tools/bash.ts` |
| R60 | hoisted `cd`, `details.cwd` | panel test pins the new field | 5 Bash panel tests pass; the field and the hoist read in `tools/bash.ts`, whose `stamp()` attaches it to the result and every progress frame |
| R61 | `excludeFromContext` capability | none needed | no non-mock caller of RPC `bash` in `src/` or the plugins |
| R62 | fixes and internals | none needed | wire 0 removed / 3 additive leaves; name, role and slash tables identical |

# omp 18.18.3 adoption (2026-11-09)

The installed pin moved **18.18.1 → 18.18.3**, carrying 18.18.2. The settings
panel moves by three description strings, but the `ask` tool changes SHAPE, and
that is the reason this bump is not a comment.

## Method

- `npm pack @oh-my-pi/pi-coding-agent@18.18.1` and `@18.18.3` (plus
  `@oh-my-pi/pi-tui@18.18.3` for the form helpers) into temp trees, then `diff -r`
  over `src/`.
- `rpc-wire.schema.json` compared whole: **74 commands, 299 definitions**
  (298 before), **0 removed, 1 added definition** (`ParentIrc`) and **1 added
  leaf** (`parentIrc` on the steer envelope); all 33 `RpcAgentEvent` variants
  byte-identical.
- The schema generator run against 18.18.3 produces **10 tabs / 604 settings /
  450 rows** (602 settings before), from a clean temp tree and in place.
  `omp config list --json` answers **604 keys**, and **0 of 450 rows** is
  rejected.
- Slash registry diffed file by file: **89 specs, 47 TUI-only names**, identical.
  `builtin-names.ts` and `MODEL_ROLES` identical.
- The `ask` reshape read in `src/tools/ask.ts`, `src/modes/rpc/rpc-mode.ts`
  (`RpcExtensionUIContext` has no `formDialog`; `askDialog` is only reached by
  extensions and the ratchet) and `pi-tui/src/html-form/{parse,data}.ts`.

## Findings

### R63 — two settings rows arrive without a `ui` block (regenerate only)

`gc.strip` and `gc.stripAfterDays` (18.18.2's `omp gc --strip`) carry no `ui`
block, so neither omp's panel nor this schema offers them and the row count stays
450. Three descriptions do change — `tui.mouse` (wheel capture), `mnemopi.dbPath`
(`~` resolves to home), `task.eager` ("subagents keep the model's own policy") —
which is what the regenerated file carries.

### R64 — the `ask` tool takes an HTML form, and answers a different way (adopted)

18.18.3 replaces `{ questions: [...] }` with `{ html }`. The RPC host has no
`formDialog`, so `AskTool` walks the form's NAMED controls one dialog at a time
(`select`/`input`/`editor`, titled with `fieldQuestions`' derivation), and the
result carries `details.answers[] = { name, question, answer }[]` plus
`timedOut`; the text is `User answers:\n{json}`. `set_ask_dialog` no longer
reaches the tool at all.

Kabmo read `questions[]`, so a live 18.18.3 ask produced no questions, no
grouping and a raw-output card. What ships with this bump:

- `src/shared/lib/chat/ask-form/` — a small parser mirroring
  `parseHtmlForm`/`fieldQuestions` for labels, captions, legends, lone options,
  selects, checkbox groups and the appended `Other` row. Cross-checked field by
  field against omp's own derivation on seven form shapes; the one mismatch it
  found is load-bearing: a top-level `<fieldset>` starts a NEW section, so the
  paragraph above it does not caption its fields (the legend does). Deriving
  `Sessions live in memory…` where omp titles the dialog `Session store` left
  the live `select` unclaimed, and `splitAskFrames` handed it to the modal —
  which has no ask body. The parser resets the caption at a top-level
  fieldset.
- `parseAskQuestions` prefers `html`, and still reads the pre-18.18.3
  `questions[]` that persisted sessions carry.
- `parseAskResult` reads `details.answers`, then the JSON in the result text,
  then the older `results`/`selectedOptions` shapes.
- `askQuestionForTitle` matches decorated titles — `(2 selected) `, ` (2/3)`,
  and the ` (Enter a number)` suffix of a re-asked text field.

The fallback also got STRICTER: a `select` response must be a label omp offered
(`labels.indexOf`; a typed answer matches nothing and `cancelAsk` abandons the
tool call). Kabmo hid `Other (type your own)` and sent typed text in its place,
which 18.18.3 refuses; the card now sends the row, and the follow-up `input`
titled with the same question carries the text.

### R65 — `ParentIrc` on a steer (no action)

A steer from a parent agent now carries `parentIrc: { from, body }`, so a host
can render the message the parent wrote instead of the model-facing envelope.
Kabmo runs top-level sessions and renders the envelope it sends itself, so the
field is unused. It is additive and typed, so nothing else moves.

### R66 — upstream internals (no action)

`omp gc --strip` and its two settings, overlapping-`bash` calls running in a copy
of the session shell, `logoutCredential()`/`SessionStorage.scanLines()` host API
changes, the `sloppy` edit's partial apply, and the shell's Windows/`zsh`
fixes. None has an RPC surface Kabmo reads.

## 18.18.3 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R63 | 604 settings, 450 rows, 3 descriptions | schema regenerated; pin bumped | `omp:schema:check` passes against 18.18.3; 604 live keys; 0/450 rejected |
| R64 | `ask` form shape + answers + strict labels | `ask-form/`, new result paths, title matcher, Other row sends itself | 8 parser tests, 20 ask tests, 307 ask-adjacent tests; shapes read from `tools/ask.ts` and `rpc-mode.ts` |
| R65 | `ParentIrc` additive | none needed | wire diff: 0 removed, 1 added definition, 1 added leaf |
| R66 | host-side internals | none needed | slash, names and role tables identical; no RPC command added |

# omp 18.18.6 adoption (2026-11-10)

The pin moved **18.18.3 → 18.18.6**, carrying 18.18.4 and 18.18.5. 18.18.5 is a
catalog-only release (Claude Fable 5.2 / Mythos 5.2, the Otari gateway, Google
Antigravity paused by an auth rule), which Kabmo reads through `omp models
--json` and therefore needs no code for. The settings surface and the RPC wire
are effectively unchanged; the reachable change is the prose a timed-out `wait`
returns.

## Method

- `bun add @oh-my-pi/pi-coding-agent@18.18.3` and `@18.18.6` (plus the matching
  `pi-tui`) into temp trees, then `diff -r` over `src/` — 57 files differ.
- `rpc-wire.schema.json` compared whole: **74 commands, 299 definitions**,
  byte-identical in both trees (0 added, 0 removed, 0 changed), as are the 15
  notifications, 13 session-event variants and 14 server-frame variants.
- The schema generator run against 18.18.6 produces **10 tabs / 604 settings /
  450 rows**, from a clean temp tree and in place. The only byte difference is
  `lsp.enabled`'s description, which now names diagnostics and format-on-write.
- `builtin-names.ts`, `config/model-roles.ts` and the 89-spec slash registry
  (47 TUI-only names) are byte-identical.

## Findings

### R67 — a timed-out `wait` names the next rung (adopted)

18.18.4/18.18.6 changed the sentence Kabmo's idle parser reads:

- 18.18.3: `No reply within 5.0s.` / `No service finished within 5.0s. Read
  proc:// for status.`
- 18.18.6: `No reply within 5.0s; a back-to-back wait allows up to 10s.` /
  `No service finished within 5.0s; a back-to-back wait allows up to 10s. Read
  proc:// for status.`
- a wait that watched jobs now prepends its snapshot and appends `No job
  finished within 30s; a back-to-back wait allows up to 60s.`

`waitIdleOf` required the trailing period, so the card's `idle 5.0s` chip and
the summary's `idle 5s` fact both disappeared after the bump. The regex now
accepts `;` after the window and the `job finished` subject, and the old period
stays valid because persisted sessions carry the 18.18.3 sentence. The job
subject is new coverage: a job-timeout wait previously carried no idle prose at
all.

### R68 — delivery lines and `settledAtMs` (no action)

A settled job's model-facing result now says how it reached the caller —
"delivered by this wait", "handed over by this snapshot … superseded its queued
completion push", or "not auto-delivered … it had already finished 2m before
this call" — and `JobSnapshot` gains `settledAtMs`. The lines are prose in the
tool text and the field is additive; the card draws status, span and intent from
the same snapshot, so nothing Kabmo parses changed. Showing the delivery line
verbatim would duplicate `wait-parts`' own status chip.

### R69 — `todo append` without a phase succeeds (no action)

18.18.3 rejected an `append` with no `phase` ("Missing phase name"). 18.18.6
targets the in-progress task's phase, then the first pending task's phase, then
the last phase, then a new `Tasks` phase. Kabmo parses the resulting checklist
from the tool text (`shared/lib/chat/todo/parser.ts`), so the successful shape
needs no code; the old error is no longer produced.

### R70 — catalog, SDK and host internals (no action)

18.18.4 adds `PromptOptions.followUps` / `DroppedPrompt.followUps` and usage
reporters (`onUsage`, title spend) to the SDK, stops advertising `task`'s
per-call `model` unless `task.perCallModel` is on, and fixes retry fallback
chains, abort budgets, compaction looping and LSP indent detection. 18.18.6
gates write/edit writethrough on `lsp.enabled`, fixes ask notes, MCP
command-backed headers, session-file id re-indexing, `gc --strip` retention and
the Tern/browser rendering paths. None of these changes an RPC command, an
event payload, a settings row or a tool-result field Kabmo reads.

## 18.18.6 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R67 | wait timeout sentence gains `; a back-to-back …` and `No job finished` | `wait-idle.ts` regex accepts both forms; card and summary tests added | 8 idle tests, summary-wait tests; shapes read in `tools/wait.ts` and `prompts/tools/wait-idle.md` |
| R68 | delivery lines + `settledAtMs` additive | none needed | wire unchanged; field read in upstream `async/job-control.ts`, absent from any Kabmo parser |
| R69 | `todo append` defaults its phase | none needed | parser reads tool text only; upstream `tools/todo.ts` |
| R70 | catalog/SDK/host fixes | none needed | 74 commands / 299 definitions byte-identical; names, roles and slash registry identical; 604 settings / 450 rows |

# omp 18.18.9 adoption (2026-11-11)

The pin moved **18.18.6 → 18.18.9**, carrying 18.18.7 and 18.18.8. The RPC
wire is unchanged; the reachable change is how a message that ends a `wait` is
delivered, plus a settings split for saved-reset auto-redeem.

## Method

- `bun add @oh-my-pi/pi-coding-agent@18.18.6` and `@18.18.9` (plus the matching
  `pi-tui`) into temp trees, then `diff -rq` over `src/` — 128 files differ.
- `rpc-wire.schema.json` compared whole: **74 commands, 299 definitions**, and
  every notification/event variant byte-identical in both trees.
- The schema generator run against 18.18.9 produces **10 tabs / 608 settings /
  453 rows**, from a clean temp tree and in place. The diff is only the reset
  keys below plus `source`.
- `builtin-names.ts`, `MODEL_ROLES` and the slash registry are byte-identical.
  The three `smithery-*` MCP subcommands removed upstream had no Kabmo copy and
  no guard row (they are `/mcp` subcommands, not slash names).

## Findings

### R71 — saved-reset auto-redeem is per window (schema only)

`codexResets.autoRedeem` becomes `codexResets.autoRedeem5h` +
`codexResets.autoRedeemWeekly`; `claudeResets.autoRedeem` becomes
`claudeResets.autoRedeem5h` + `autoRedeemWeekly` + a new `autoRedeemFable`.
omp's settings migration folds the legacy boolean/tri-state into both window
keys on read, so no stored Kabmo value needs rewriting. The panel is
schema-driven and carries the new rows; nothing outside the committed schema
names the old key.

### R72 — a message that ends a `wait` is its own turn (adopted)

18.18.9 deletes `messageResult` / `drainPendingInbox` and `waited` from
`CoordinationDetails`. `handOffMail` gives the message to the recipient
session, which injects a `customType: "irc:incoming"` turn and runs it as a
user turn; the wait answers `Wait interrupted by message.` with
`{ op: "wait", jobs: [], interrupted: true }`.

Kabmo's wait card read `details.waited`, so after the bump every message that
ended a wait disappeared from it. The wait card now shows `interrupted`, and
the injected turn is mapped from `details.from` / `details.message` (the row's
content is omp's `<irc>` prompt envelope, which must never be shown). Both
transcript paths get the same row: live (`mapper.ts`) and JSONL reload
(`noticeFromCustomMessage`). The timeline draws it with the new `IrcNotice`
card; the wait card's message block stays for sessions recorded on 18.17.0
through 18.18.6, whose JSONL still carries `waited`.

Measured on a real persisted entry: the JSONL `details` is
`{ id, from, message }`, and `content` is the full `<irc>` envelope with the
reply instructions.

### R73 — `ask` option notes (no action)

18.18.8 lets a TUI form attach a note to a selected option and returns
`details.notes[]` (`{ name, question, option, value, text }`). The RPC host has
no `formDialog` and answers the form field by field through
`select`/`input`/`editor`, so it cannot produce a note. Kabmo's ask card reads
`details.answers`, whose shape is unchanged.

### R74 — context split, shell, browser, catalog (no action)

18.18.7–9 add instruction-file and skill categories to `/context` and
`instructionFilesTokens` to session statistics (TUI/overlay and an additive
stats field Kabmo does not read), make the shell's built-in `jq` behave like
jq 1.8.2, add Hacker News/Sofya search engines and the Smithery removal
(catalog, read through `omp models --json`), persist launch services for
non-interactive sessions, and fix browser relay/`tab.*` handling, `/tan`
completion wording, async-job delivery text and AppContainer/Windows shell
paths. None changes an RPC verb, event payload or tool-result field Kabmo
parses.

## 18.18.9 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R71 | auto-redeem split per window | schema regenerated; no code names the old key | 608 settings / 453 rows; five new keys, two removed (net +3 rows); panel tests pass |
| R72 | wait no longer carries received messages | `irc-notice.ts` maps `details` in both paths; `IrcNotice` card; wait docs note the old shape | mapper + messages-map + IrcNotice tests; existing wait-card `waited` tests still pin pre-18.18.9 sessions |
| R73 | ask option notes | none needed | RPC host has no `formDialog`; `AskToolDetails.answers` unchanged |
| R74 | host/catalog/shell fixes | none needed | 74 commands / 299 definitions byte-identical; names, roles and slash registry identical |

# omp 18.19.0 adoption (2026-11-12)

The pin moved **18.18.9 → 18.19.0**. The RPC wire keeps its 74 commands and
299 definitions; the reachable change is the removal of the `blocked` todo
status, plus four new settings rows and one removed.

## Method

- `bun add @oh-my-pi/pi-coding-agent@18.18.9` and `@18.19.0` (plus the matching
  `pi-tui`) into temp trees, then `diff -rq` over `src/` — 151 entries differ.
- `rpc-wire.schema.json` compared whole: **74 commands, 299 definitions**, 0
  added, 0 removed, 5 changed (`TodoStatus`, `TodoItem`, and the doc comments of
  `AskUiRequest` / `AskAnswer` / `CancelUiResponse`). Every notification, event
  and frame variant is byte-identical.
- The schema generator run against 18.19.0 produces **10 tabs / 612 settings /
  456 rows**, from a clean temp tree and in place. The diff is the four added
  keys, the removed `task.file`, and six description-only updates.
- `MODEL_ROLES` is byte-identical and the slash registry differs only in
  `builtin-collaboration.ts`'s browser-mode implementation (no name, alias or
  handler moved). `builtin-names.ts` gains only a `toolWireName` helper.

## Findings

### R75 — the `blocked` todo status is removed (adopted)

18.19.0 deletes `blocked` from `TodoStatus`, the `blocker` field from
`TodoItem`, the `block` / `unblock` ops from `TodoOp`, the `[!]` marker and the
`, N blocked` sentence from the summary, and the blocked-only goal and
auto-complete paths in the RPC host. A snapshot saved before the removal reads
back with those tasks `pending` (`withoutBlocked`).

Kabmo's parser reads the tool text, so it keeps the status: sessions recorded
on 18.17.0–18.18.9 still carry `(blocked: …)` / `[!]` lines and the summary
sentence, and the panel must keep drawing them. New sessions cannot produce
the status, so nothing else changes. No Kabmo code sends `block` / `unblock`.

### R76 — four settings rows added, `task.file` removed (schema only)

`browser.webkit` and `browser.webkitPath` (tools / Grep & Browser) select
omp's own headless WebKit engine; `task.autoParallel` (off / suggest / on) and
`task.steps` (tasks / Subagents) let a judge split a top-level prompt and let a
spawn take ordered steps. `task.file` and the `taskFile` argument it gated are
gone. None carries a `ui.condition`, so `isConditionMet` needs no arm, and the
panel is schema-driven. Six descriptions change (`ask.timeout`, `browser.cdpUrl`,
`browser.enabled`, `browser.freezeOnTurnEnd`, `browser.headless`,
`browser.tern`).

### R77 — browser `app` grammar, doc topics, host fixes (no action)

The browser tool's `app` argument becomes a keyword (`relay`, `tern`, `webkit`,
`chromium`, `own`, `auto`), a CDP URL or an executable path, and WebKit tabs
gain a viewer on macOS. `read` gains `xd://read/sources` / `xd://read/urls` doc
topics and internal-URL schemes gain `promptReference`; `write` and `eval`
inline those topics when `read` is inactive. `gh-run-watch` normalizes GitHub
timestamps and adds step snapshots, `bash` advertises `builtins` instead of
`hasShellBuiltins`, and model modifiers now run only for a provider holding
OAuth credentials. None changes an RPC verb, event payload or tool-result field
Kabmo parses.

## 18.19.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R75 | `blocked` todo status removed | parser and types keep the status for pre-18.19.0 sessions; comments record why | parser/progress tests still pin blocked; wire diff shows the enum narrowed |
| R76 | four rows added, `task.file` removed | schema regenerated; no code names the old key | 612 settings / 456 rows; `omp:schema:check` passes |
| R77 | browser/doc-topic/host changes | none needed | 74 commands / 299 definitions, 0 added/removed; roles and slash names identical |

# omp 18.20.0 adoption (2026-11-13)

The pin moved **18.19.0 → 18.20.0**. The RPC wire keeps its 74 commands and
299 definitions; the reachable change is two new schema rows (one under a new
`Find` group) and four additive fields on the `select` UI request.

## Method

- `bun add @oh-my-pi/pi-coding-agent@18.19.0` and `@18.20.0` into temp trees,
  then `diff -rq` over `src/` — 129 entries differ.
- `rpc-wire.schema.json` compared whole: **74 commands, 299 definitions**, 0
  added, 0 removed, 1 changed (`SelectUiRequest`). Every notification, event
  and frame variant is byte-identical.
- The schema generator run against 18.20.0 produces **10 tabs / 615 settings /
  458 entries** (was 612 / 456). The diff is two added rows, one new tab group,
  and one description-only update; a third new setting, `find.hitThreshold`, is
  registered with no `ui` and therefore has no row, exactly as the generator
  treats every no-UI setting.
- `MODEL_ROLES` and the slash registry are byte-identical; `BUILTIN_TOOL_NAMES`
  is the same 30 names (`builtin-names.ts` gains a `BUILTIN_TOOL_HELP` table).

## Findings

### R78 — `select` requests carry marker hints (no action)

`SelectUiRequest` gains `initialIndex`, `selectionMarker` (`radio` / `checkbox`),
`checkedIndices` and `markableCount`. They are presentation hints: the answer
is still the single `{ value }` label (`parseValueDialogResponse` is unchanged),
and a checkbox dialog is a loop of `select` calls where the host returns the
toggled row. The fields are emitted by `requestRpcSelect` whenever its caller
passes them — the interactive TUI, a collab guest's ask fallback, and any
extension that calls `ui.select` with a marker. Kabmo's own `ask` opts into the
grouped form dialog (`set_ask_dialog`), so it never takes the field-by-field
fallback that supplies `initialIndex`; the dialog keeps answering correctly
without them. Rendering the markers would be new UI for a path the product does
not run.

### R79 — two rows added, one new group (schema only)

`encourageEdits` (boolean, default on, model / Prompt) makes omp's system prompt
carry a critical rule requiring `edit` for file edits. `find.verifyModel`
(string, tools / new `Find` group) names a model tried first for `find`'s
passage verification. Neither carries a `ui.condition`, so `isConditionMet`
needs no arm, and the panel is schema-driven; the description update is
`model.toolCallLoopGuard.exemptTools` widening its wording to `xd://` write
devices.

### R80 — read/grep/write/proc/host changes (no action)

- `read` re-shapes a `;`/`,` path list as blocks of one call. `ReadToolDetails`
  keeps every field Kabmo reads (`displayContent`, `contentType`, `notes`,
  `displayReadTargets`), the list notice and part text are unchanged, and the
  card reads text plus images the same way.
- `grep` adds `binaryMatches` to its details and a corresponding note, and
  sanitizes control characters in matched lines. The card draws
  `details.files`/`count` and the result text; an extra warning line is prose it
  already renders.
- `write` sets a shebang file's execute bits before LSP diagnostics run;
  `proc` device results gain `touchesNoFiles`. Neither is drawn.
- Host-side and additive: the `ssh-config` discovery provider and `ssh://`
  reads, LSP `workspace/didChangeWatchedFiles` forwarding, the computer
  secure-input prompt and its option errors, `--allow-escape-sequences` with an
  old-`gh` fallback in `gh-run-watch`, and `resolveToolWireName` extraction.

## 18.20.0 outcomes

| # | Finding | Action | Verification |
|---|---|---|---|
| R78 | `select` request gains marker hints | none needed | 74 commands / 299 definitions, 0 added/removed; answer still one `{value}` label |
| R79 | two rows added, one no-UI setting | schema regenerated; no code names a new key | 615 settings / 458 entries; `omp:schema:check` passes |
| R80 | read/grep/write/proc/host changes | none needed | `ReadToolDetails` identical; `bun test` 11465 pass; `bun run lint` clean |
