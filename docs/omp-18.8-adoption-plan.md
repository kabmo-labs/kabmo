# omp 18.8 adoption plan

The chamber pinned `OMP_VERSION=18.3.0` in `.github/scripts/install-omp.sh` while
the installed binary was **18.8.3** (2026-10-07); the pin now matches (F9). This document records the audit
of everything between the two versions that the chamber either gets wrong or
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
so far, never a delta. The chamber appends:

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
- **12 keys the chamber still offers are rejected by omp** — verified one by one
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

~101× fewer bytes. The chamber never calls `set_event_filter` and reads the
accumulated `partial`, so it pays the full cost.

Terminal frames stay whole in delta mode (verified): `message_end`, `turn_end`
and `agent_end` still carry the complete message, so the fix is confined to the
in-flight rendering path.

### F4 — omp now implements, natively, three things the chamber reimplemented

| Area | omp RPC | Chamber today |
|---|---|---|
| Side questions | `btw` / `btw_cancel` / `get_btw_history`, streamed as `btw_delta` + `btw_record`, works mid-turn | own child: `--resume <snapshot> --no-tools` |
| Follow-up queue | `get_state.queuedMessages`, `queue_update`, `remove_queued_message`, `promote_queued_message`, `abort_and_restore_queue` | own SQLite `queued_messages` + drain on `agent_end` |
| Steering | `steer` (interrupt the turn with a message) | `abort_and_prompt` — **cancels the turn** |

Measured: `steer` mid-turn answers `success: true`, emits
`queue_update {steering:[…]}` then `{steering:[]}` when consumed, and the model
responds to the steer inside the same run (one `agent_start`, one `agent_end`).

The chamber's queue row labelled **"Send Now (Steering)"** actually posts
`abort_and_prompt`, which discards the running turn. omp has had real steering
since 18.3.x.

### F5 — Unused surface (no chamber code path)

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
the chamber never calls them.

### F7 — Grouped ask dialog available

`set_ask_dialog {enabled:true}` makes omp send **one** `extension_ui_request`
with `method:"ask"` carrying every question of a call (with `multi` and
`recommended`), answered by a single `AnswersUiResponse`. Verified live: two
questions including a `multi:true` one arrived in one request.

Today the chamber renders one dialog per question because omp's default mode
asks one at a time.

### F8 — Verified NOT broken (do not "fix")

- **TUI-only guard is correct.** All 42 names in
  `src/shared/lib/chat/composer/tui-only.ts` are still `handleTui`-only in
  18.8.3. `plan`/`goal` are deliberately absent (the chamber's own extension
  answers them). The extracted list from 18.8.3 is exactly those 42 plus
  `goal`/`plan` — no drift.
- **`get_state.isSettled` is already used** (`run-settle.server.ts`).
- **STT audio type is correct.** The worker takes `Float32Array` at 16 kHz and
  rejects everything else; `src/server/routes/dictation/ws.ts` converts PCM16 →
  `Float32Array` before `transcribe`. The comment in `omp-stt-worker.ts` saying
  "base64" is **doc drift** in the chamber, not a code bug.
- **`turn_end` is deliberately unhandled** — it fires for every turn of a
  multi-turn run, and `terminal-settle.ts` reads the badge from it. Not a gap.
- **`tool_stream_update` never fires** in practice on 18.8.3 for `bash` or
  `write` (measured: 0 frames on both). It is an extension-tool channel
  (`updateStreamPreview` in the TUI), not something the chamber is missing.

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
killed was **gone after a respawn** on the same session file. The chamber's queue
is SQLite-backed (`queued_messages`) and therefore survives an idle reclaim, a
server restart and a second chamber instance — three things that happen routinely
and would silently drop a user's queued message under omp's queue. The chamber
also never populates omp's queue (zero `follow_up` sends), so the two are
disjoint rather than duplicated.

Adopting `remove_queued_message` / `promote_queued_message` /
`abort_and_restore_queue` would mean routing the panel's queue through a store
that loses its contents on the next child restart. The chamber's own per-item
queue endpoints already provide the equivalent operations durably.

What IS taken from this area is P4a: real `steer` for "Send Now".

### P5 — native /btw: NOT ADOPTED (measured)

Same finding, same reason. Measured: `get_btw_history` returned a record before
the child was killed and **`{records:[]}` after a respawn**. The chamber's BTW
topics live in SQLite (`btw_topics`/`btw_turns`) and survive restarts; omp's
history is per-process. The chamber's side child additionally resumes a
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

- **`get_session_stats`** duplicates what the chamber already has. Measured side
  by side: `get_session_stats.tokens` = `{input: 8843, output: 25, total: 8868}`
  and `cost: 0.001482…`, while the `message_end` frame the timeline already folds
  carried `usage.totalTokens: 8868` and `usage.cost.total: 0.001482…` — the same
  numbers. Adding a second source for the footer would only create a way for the
  two to disagree.
- **`get_available_thinking_levels`** duplicates `get_state.model.thinking.efforts`
  (measured: `["low","high","max"]`), which `thinkingLevelsForMeta` already turns
  into the same ladder the command returns (`["off","low","high","max"]`). The
  chamber reads the live ladder from `get_state`, so the command adds a round
  trip for an identical list.

### P7 — provider logout (shipped)

`POST /api/settings/providers/logout` drives omp's `get_logout_accounts` and
`logout`; `LogoutProviderModal` lists the removable credentials and removes one;
a `sign out` button sits beside `disable`/`connect` in the auth section. The two
operations are now visibly different: `disable`/`disconnect` hide a provider and
leave the credential, `sign out` deletes it. The dialog says what survives (a
`models.yml` entry, the chamber overlay) so the distinction is not implied.

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
- No `predict_word` ghost text (the chamber's composer has no completion surface).
- No `export_html`.
- `get_entries` / `get_tree` / `get_branch_messages` are read-only tree views the
  chamber has no UI for; noted, not adopted.

---

# omp 18.9.2 re-audit (2026-10-12)

The 18.8 work above was measured against **18.8.3**. The installed binary is now
**18.9.2** (published 2026-10-11T19:17Z), so the same questions were re-asked:
what moved under the chamber, and what does the panel still not offer. Every
claim below is measured against the installed package, not read off a changelog.

## Method

- `src/modes/rpc/wire/rpc-wire.schema.json` from the installed package, diffed
  against the `v18.8.3` tag — the machine-readable contract, not prose.
- `omp config list --json` (548 keys) against the chamber's merged schema table.
- The slash-command registry: `BUILTIN_SLASH_COMMAND_RESERVED_NAMES` +
  `lookupBuiltinSlashCommand`, classified by whether the spec carries a text-mode
  `handle`.
- `bun run omp:schema:check`, live `omp config get` per key, a live STT worker
  ping, and the upstream changelog/tags for what is still unreleased.

## Findings

### R1 — The RPC surface is UNCHANGED (nothing to adopt, nothing broken)

18.8.3 → 18.9.2 carries **the same 67 commands**: `ADDED: []`, `REMOVED: []`, and
no command's params/result/timeout changed. Every verb the chamber depends on
(`steer`, `set_event_filter`, `set_ask_dialog`, `cancel_subagent`,
`steer_subagent`, `get_logout_accounts`, `logout`, `get_subagents`) is present
with an identical signature.

Two shape changes exist and both are additive:

- `SessionState.queuedMessages` gained `liveSteered: number` (default `0`) — the
  count of leading `steering` entries already sent into the streaming response,
  which `remove_queued_message` cannot reach. The chamber never reads omp's queue
  (P4b–d, below), so it is inert here.
- `QueueUpdateEvent` gained the same field, for the same reason.

The frame names the chamber folds (`session_settled`, `rpc_frame_error`,
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
reports 548 keys, and of the chamber's 435 merged entries **0 are rejected**. The
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

- **TUI-only command guard.** The chamber's 42-name list is an exact match for
  18.9.2's TUI-only set (44 names; `plan`/`goal` are chamber-owned and
  deliberately absent). 0 unguarded, 0 stale.
- **STT worker transport.** `omp __omp_worker_stt` still answers on the Bun IPC
  channel with `serialization: "advanced"` and `stdin`/`stdout` ignored — ping →
  `{"type":"pong"}` verified live. The 18.9.x IPC work is a Rust transport for
  omp's OWN internal endpoints (daemon broker, LSP mux, IDA, predict, stream,
  collab, local model workers); it does not replace the STT worker channel.
- **STT model keys.** Still exactly `whisper-base`, `whisper-small`,
  `whisper-large-v3-turbo`, `parakeet-tdt-0.6b-v3`; omp's own default is still
  the English-European-only Parakeet, so the chamber's `whisper-base` default
  remains the right call.
- **`omp usage --json` / `omp plugin list --json` / `omp skill list --json`.**
  Same shapes; `usage` gained only a `reset` subcommand.
- **Session title slot.** Still 256 bytes, same entry type, on both sides.
- **Schema extras.** All 15 chamber-documented keys still answer `omp config get`.
- **`PI_NO_TITLE` gate.** Still set by `--mode rpc-ui` and still gates only the
  two automatic title paths, so the chamber's own `/rename` remains the way a
  session gets named.

### R6 — `title.icons` changes what a generated title looks like (not a bug)

18.9.0 added **title cards**: `title.icons` (default `nf+emoji`) heads a
generated or `/rename`d title with an icon and a short code — `formatCardTitle`
emits `🧪 FLAKY: Fix flaky park tests`. This reaches the chamber, because the
chamber names sessions by sending `/rename` to the child and then reads the
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
18.9.2's** (67 commands, 0 added, 0 removed, 0 defs changed), so the chamber
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

The frames the chamber folds (`session_settled`, `rpc_frame_error`,
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
  European-only Parakeet, so the chamber's `whisper-base` default stands.
- **TUI-only command guard.** 44 TUI-only names at 18.10.0, and the chamber's
  42-name list is an exact match (`plan`/`goal` are chamber-owned). 0 unguarded,
  0 stale.
- **Every CLI surface the chamber shells out to.** `omp usage --json`,
  `omp plugin list --json`, `omp skill list . --json` and `omp config list --json`
  all exit 0 with the same shapes (548 config keys, 413 with a `ui` block).
- **Every flag the chamber passes to a child.** `--mode --cwd --resume
  --no-session --no-lsp --no-title --no-tools --approval-mode --model --thinking`
  are all still accepted.
- **Session title slot.** Still 256 bytes, same entry type.
- **The new CLI verbs are additive.** `omp session pack|unpack|moved` and
  `omp auth export|import` exist and change nothing the chamber calls.

### R10 — A forked resume was re-spawned (bug, fixed)

**This is the one real finding, and it is new in 18.10.0.**

`omp session moved` (and any `departed` transfer marker) makes omp FORK a session
on resume instead of continuing it: the child answers a fresh `sessionId` and
writes the conversation to a fresh file under a fresh id. Verified against a real
18.10.0 child — resuming a departed file answered
`01a12dc0-8f6b-…` and a file under `--private-tmp-ompfork--/`, in a different
directory from the one resumed.

The chamber's registry was keyed on the id the CALLER holds (the URL's session
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
The chamber's notice mapper carries any unrecognised `customType` through as a
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
