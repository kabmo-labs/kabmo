#!/usr/bin/env bash
# Installs the pinned oh-my-pi (`omp`) CLI that every AI-backed bot workflow runs.
#
# The version is pinned on purpose: the bot's verdict is a contract (marker shape,
# label mapping) that is verified by these scripts, but its *judgement* comes from
# omp, and a newer omp can change how it reads a diff. A run must be reproducible
# from the repository alone, so the pin lives here rather than in a floating major.
#
# The install itself is three attempts of one global Bun install — GitHub's npm
# mirror and the platform-native package (`@oh-my-pi/pi-natives-linux-x64`) both
# flake under load, and a flake is not a review failure.
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "::error::bun is not on PATH; the job must run oven-sh/setup-bun before this script" >&2
  exit 1
fi

# Pinned to the version Kabmo's RPC surface was measured against — the
# audit in docs/milestones/M02-omp-engine-adoption.md names which features each phase
# depends on, and the RPC verbs they use (steer, set_event_filter, isSettled)
# do not exist on the 18.3.0 this used to pin.
#
# 18.10.0 (2026-10-12) is a surface-identical step up from the 18.9.2 this pinned
# before, in both directions Kabmo reads: the RPC wire schema carries the
# SAME 67 commands and 283 definitions with nothing added, removed or changed,
# and `orderedSettings()` produces a byte-identical schema (548 settings, 413
# panel entries). What it does change is session IDENTITY — a session marked
# moved away now forks on resume, answering a new id and file — which is why
# `registerSpawnedSession` exists; see the audit for the measurement.
#
# 18.12.0 is what the committed schema was generated from, and the two MUST
# agree: the schema gate regenerates from the version this script installs, so a
# pin left behind reports a stale schema that is actually current. Measured at
# 18.10.0: `task.structured` is absent and `snapcompact.toolResults` /
# `task.softRequestBudget` differ, so the gate fails on a file that is in fact
# current — exactly what `948f9e4` left behind when it refreshed the schema from
# a local 18.10.3 without bumping this pin. The same drift repeated one version
# later in reverse: the pin stayed at 18.10.3 while 18.11.0 was installed, so CI
# (which installs the pin) stayed green over two rows — `providers.openai-codex.
# codeMode` and `.codeModeDirectTools`, removed upstream in 18.10.4 — that
# `omp config set` refuses with `Unknown setting`. A pin that disagrees with the
# schema's source of truth is the failure mode this comment exists to prevent.
#
# 18.12.0 (2026-10-18): the schema's `source` line moves to 554 settings. Its
# one RPC-wire addition is `narration` on a thinking block — which Kabmo
# already presents as answer text (`parseMessageBlocks`), so no RPC change was
# needed for it.
#
# 18.12.4 (2026-10-21): the schema's `source` line moves to 559 settings and the
# panel gains four rows (`advisor.continueSeverity`, `async.widgets`,
# `computer.backgroundFallback`, `tui.completeScrollback`), plus three
# description-only updates and one enum widening — `tools.approvalMode` gains
# `always-ask-cached` (18.12.3's "Ask and remember"). The composer's
# `APPROVAL_MODES` is deliberately still the three older values: that mode's
# distinguishing feature is `prompt.grants` (remember a file or a folder), which
# Kabmo's confirm dialog does not render — offering it would spawn a session
# whose prompts cannot do the thing the mode is named for. The settings row does
# carry it, because there the value goes straight to `omp config set`. Verified
# against `omp config list --json` (559 keys, every added or changed row
# present) and a wire-schema diff against 18.12.0 (283 definitions, 0 added, 0
# removed, 0 changed; `builtin-names.ts` identical).
#
# 18.12.6 (2026-10-22): the schema's `source` line stays at 559 settings and no
# row is added or removed; the only generated change is `providers.
# cacheRetention`'s `long` option, relabelled `Long (1h+)` with the wider TTL
# (18.12.5: OpenAI GPT-5.6+ Responses caches 12h). The RPC wire is unchanged
# again — 67 commands and 283 definitions, 0 added/removed/changed against
# 18.12.4 — and `builtin-names.ts` is byte-identical, so nothing Kabmo reads
# moved; the release is ACP-side (steering extension, `/mcp reauth`) and
# TUI-side (deferred extension loading), neither of which this bridge speaks.
#
# 18.13.0 (2026-10-27): the schema's `source` line moves to 562 settings and the
# panel gains ONE row, `async.printWake` (tools / Execution), plus the
# `power.sleepPrevention` description. `session.warnCost` / `session.maxCost`
# are new and carry NO `ui` block, so neither omp's own panel nor this schema
# offers them — and that is deliberate; a run that reaches the cap answers
# `prompt_error` with `code: "cost_cap"` and a self-explaining message, which
# Kabmo renders as-is. The RPC wire is unchanged for the fourth release running
# (67 commands, 283 definitions, 0 added, 0 removed) apart from three ADDITIVE
# definitions: `SessionStats.editRejections` (never read here), `PromptError.code`
# (above) and the BTW records' `images` — whose `title` also leaves the wire,
# which does not reach Kabmo because `/btw` is implemented on Kabmo's own tables.
# `builtin-names.ts` is byte-identical again. What this release DOES add is
# `wait` / `proc://` telemetry (`requests`, `cost`, `contextTokens`,
# `contextWindow`, `stage`), which Kabmo's job rows now draw — see R23 in
# docs/milestones/M02-omp-engine-adoption.md.
# 18.13.1 (2026-10-27): the schema's `source` line moves to 563 settings and the
# panel gains ONE row, `tools.restrictedFolders` (interaction / Approvals) — the
# folders where every read, write, edit, search or command asks in EVERY
# approval mode, `yolo` included, with no remembered grant and no session
# approval covering it. Its upstream condition (`restrictedFoldersNotProject`)
# hides the row when a PROJECT layer supplies the list, and `omp config list
# --json` carries no provenance — so this panel degrades to visible, exactly
# like `contextFiles.extra`'s row already does. The RPC wire is unchanged for
# the fifth release running (67 commands, 283 definitions, 0 added, 0 removed)
# and `builtin-names.ts` and `MODEL_ROLES` are byte-identical again. The
# release's other changes are TUI-side (`/pause` now reports draining turns and
# running jobs, fewer redraws during background subagent progress) or inside
# omp's own tools (a task subagent no longer receives AGENTS.md; an `ask` note
# names the option it belongs to) — none of which reaches a Kabmo surface.
# 18.14.0 (2026-10-29), carrying 18.13.2 and 18.13.3 with it: the schema's
# `source` line moves to 574 settings and the panel gains TEN rows —
# `display.advisorCollapsedLines`, `extensionHandlers.modeControl`,
# `extensionRenderers.assistantText`, `out.enabled`, `prewalk.from`,
# `prewalk.into`, `retry.rateLimitWalksChain`, `session.worktreeScope`,
# `task.file`, `tools.xdevNotices` — while `gc.autoCompress` stays out because
# upstream gives it no `ui` block. The RPC wire moves for the first time in six
# releases: 67 → 73 commands and 283 → 295 definitions, every one ADDITIVE
# (`navigate_tree`, `set_label`, `abort_branch_summary`, `dictation_start`,
# `dictation_stop`, `live_connect`; the `manual_compaction_*` and `dictation_*`
# events; `secret` on an `input` dialog). No existing command or payload Kabmo
# reads changed shape — `get_state`, `prompt`, `compact`, `set_model`,
# `set_event_filter`, `SessionState`, `PromptAck`, `ModelInfo`,
# `CompactionResult` and the approval frames are byte-identical.
# `builtin-names.ts` and `MODEL_ROLES` are identical again.
#
# Three upstream changes DO reach a Kabmo surface, each fixed with the bump:
#   - `/subagents` is a NEW alias of the TUI-only `/hub`. Kabmo's guard list is
#     keyed on names, so without the row the alias was forwarded to the model
#     as literal text (`tui-only.ts`).
#   - `manual_compaction_start`/`_end` are new frames. Kabmo folded only the
#     `auto_*` pair, so a `/compact` typed into the composer left `compacting`
#     false for the whole pass — a reset could kill it, and the session-file
#     caches were never dropped (`frame-fold.ts`).
#   - `input` dialogs can now carry `secret: true`. Kabmo rendered every input
#     as `type="text"`, which would print a password on screen
#     (`ExtensionUiDialogRequest` + both dialog renderers).
#
# Breaking upstream (measured, none reach Kabmo): provider-qualified model
# selectors must now be EXACT — `aihub-brisnets-jatis/deepseek-v4` fails with
# "Did you mean …" where 18.13.1 fuzzy-matched a sibling. Kabmo builds every
# selector it writes from `omp models --json` rows, so its own selectors are
# exact by construction; a stale stored value now fails loudly instead of
# silently running the wrong model. Custom tool loaders take `cwd` first (Kabmo
# ships none), and WebMCP moved to Chrome's native support (not used here).
#
# 18.15.0 (2026-11-01): the schema's `source` line moves to 579 settings and the
# panel gains FOUR rows — `providers.openai-codex.daybreak` (providers /
# Protocol), `task.perCallModel` and `task.perCallModelAllow` (tasks /
# Subagents), `title.refreshAfterPrompts` (tasks / Modes) — plus one new
# upstream condition, `perCallModelAllowNotProject`. That condition hides the
# allowlist row when a PROJECT layer supplies it, which `omp config list
# --json` cannot express (no provenance), so this panel degrades to visible
# exactly like `contextFiles.extra` and `tools.restrictedFolders` already do.
# The RPC wire grows by ONE command and TWO definitions, both ADDITIVE:
# `get_session_lease` + `GetSessionLeaseParams`/`GetSessionLeaseResult`.
# `RpcAgentEvent`, `RpcInbound`, `RpcServerFrame`, `RpcNotification`,
# `SessionState`, every approval frame and `builtin-names.ts`/`MODEL_ROLES` are
# byte-identical, and the TUI-only slash-command set is unchanged (41 names in
# both releases), so nothing Kabmo folds or guards moved.
#
# One upstream change DOES reach a Kabmo surface, adopted here: a background
# job's snapshot now carries `intent`, the model's own one-line purpose for the
# call that started it (omp 18.15.0 leads its own `/jobs` rows with it). Kabmo
# drew only `label` in the `wait` and `proc://` cards, so the purpose was
# dropped while the raw command stood in for it. Both cards now lead with the
# intent and keep the label beneath — see R39 in
# docs/milestones/M02-omp-engine-adoption.md.
#
# 18.16.0 (2026-11-02): the schema's `source` line moves to 582 settings and the
# panel gains THREE rows — `btw.inject` and `composer.predictionAlternatives`
# (interaction / Input), `hindsight.globalScope` (memory / Hindsight; upstream
# gates it on `hindsightActive`, which this panel already resolves). One new
# upstream condition arrives with the alternatives row, `composerPredictionsEnabled`
# (`composer.predictions === true`), and `isConditionMet` now answers it — the
# default arm would have shown a modifier row whose parent was off.
# The RPC wire is byte-identical: 74 commands and 297 definitions, 0 added, 0
# removed, 0 changed; `builtin-names.ts`, `MODEL_ROLES` and the 41 TUI-only
# slash commands are unchanged, so `tui-only.ts` needs no row.
#
# One upstream change DOES reach a Kabmo surface, adopted here: a `bash` result
# now carries `details.meta.minimized` when omp's shell minimizer rewrote the
# output, naming the filter, both byte sizes and the artifact holding the
# LOSSLESS original (a new `bash-original` kind). Kabmo rendered the compressed
# body as if the command had produced it — measured on a real child running
# `git --no-pager log` in a 60-commit repo: `inputBytes: 10970`,
# `outputBytes: 3905`, `artifactId: "0"`, and `[raw output: artifact://0]` at the
# end of the inline text. The card now states the rewrite and the artifact chip
# opens the original — see R45/R46 in docs/milestones/M02-omp-engine-adoption.md.
#
# Not adopted, deliberately: `btw.inject` (it drafts an `<inject>` steering block
# for omp's own Alt+I, a TUI keybinding; Kabmo's side panel has no inject path and
# the row stays editable because it is a real omp setting); `composer.predictions`
# and its alternatives row (ghost text is the TUI composer's, and Kabmo has no
# prediction surface); `hindsight.globalScope` (it widens what the MODEL may
# retain for Hindsight's backend — the same class as `task.perCallModel`).
#
# Not adopted, deliberately (18.15.0): `get_session_lease` (Kabmo already probes
# the lease with its own `flock` and resolves the holder pid, which RPC cannot
# name); `title.refreshAfterPrompts` (gated by `PI_NO_TITLE`, which rpc-ui sets,
# and Kabmo owns titling through its own `/rename` path); `task.perCallModel`
# (it grants a MODEL per subagent call, a capability Kabmo never requests).
#
# 18.17.0 (2026-11-06): the schema's `source` line moves to 602 settings and the
# panel gains TWELVE rows — `display.shellVisualization`, `tui.colorfulMarkdown`,
# `tui.motion`, `tui.maxFps`, `tui.spinnerInterval` (appearance / Display),
# `extensionRenderers.transcriptPresenters` and `spotlight.experiment.enabled`
# (tools), `magicKeywords.chillax` (interaction / Magic Keywords), `update.auto`
# (interaction / Startup & Updates), `ovnfs.path` and `task.workerThreads`
# (tasks), `providers.openaiResponsesWebsockets` (providers / Protocol).
# `textVerbosity` also moves its DEFAULT (medium → low) and `edit.mode` gains
# `none`, which removes the `edit` tool and keeps `bash`. No new `ui.condition`
# arrives this time, so `isConditionMet` needs no arm.
#
# The RPC wire keeps its 74 commands and gains one ADDITIVE definition
# (`LineRange`, referenced by the new `BashResult` fields) — 297 → 298, 0
# removed, 0 changed — and all 33 `RpcAgentEvent` variants, `builtin-names.ts`
# and `MODEL_ROLES` are byte-identical. The slash registry grows by `unpin`,
# which carries a text-mode `handle` (not `handleTui`), so it is NOT a TUI-only
# name and `tui-only.ts` needs no row; the 47-name TUI-only set is unchanged.
#
# Three upstream changes DO reach a Kabmo surface, each fixed with the bump:
#   - `wait` LOSES its 30-minute cap: `WAIT_MAX_MS` and the "Wait limit
#     reached" sentence are gone. A blocking wait now returns after a window
#     from a ladder — 5 s, 10 s, 30 s, 60 s, 5 min — that climbs across
#     back-to-back idle waits, and from the second rung on it appends a
#     `wait-idle.md` notice telling the model that waiting is not progress.
#     Kabmo's card stated the old ceiling and counted down to it (`0:07 left of
#     30:00`), so after the removal it claimed a budget omp no longer has
#     (`shared/lib/omp/session/wait.ts`, `panels/Wait.tsx`).
#   - `details.waited` is now an ARRAY: one wake returns every message queued by
#     then (`messageResult(senderId, waited: IrcMessage[])`). Kabmo parsed it
#     with `isRecord`, which refuses arrays, so both the message block and the
#     `message received` chip silently disappeared.
#   - every `bash` progress frame and its final result now carry
#     `details.trace`, the embedded shell's `ShellTrace`, emitted regardless of
#     `display.shellVisualization` (that setting only gates omp's own drawing).
#     Measured here: 40 output lines → 192 KB of frames against 19 KB on
#     18.16.0; a 40k-line result → 311 KB frames and 1.15 MB in total;
#     `seq 1 30000` → a 201 KB trace on the result alone, its `history` carrying
#     the output a second time. Kabmo has no shell visualization, so the field
#     is dropped before it reaches the transcript (`tool-results.ts`).
#
# Not adopted, deliberately (no Kabmo surface): the twelve rows are TUI-only
# (shell visualization, motion/fps/spinner, colourful markdown, transcript
# presenters, spotlight) or a MODEL capability (`ovnfs.path` changes what the
# agent does with separate checkouts, `task.workerThreads` how it schedules its
# own subagents). `update.auto` is omp's own updater running beside Kabmo's
# explicit `omp update`; both stay because neither can see the other's intent,
# and omp now refuses to update while another update is installing.
#
# 18.18.1 (2026-11-08), carrying 18.18.0: a release with NO settings move — the
# generator writes a file BYTE-IDENTICAL to the committed one (10 tabs / 602
# settings, 450 rows), and `omp config list --json` answers the same 602 keys.
# `spotlight.experiment.holdout`'s default moves 0.15 → 0.05 upstream, but it
# carries no `ui` block, so neither omp's panel nor this schema offers it. The
# RPC wire keeps its 74 commands and 298 definitions and gains three ADDITIVE
# leaves: `BashParams.excludeFromContext` and `ReadyEvent.
# supportsBashExcludeFromContext` (a `bash` run can be kept out of model
# context, like terminal `!!`). `builtin-names.ts`, `MODEL_ROLES` and the
# 89-spec slash registry (47 TUI-only names) are byte-identical, and every
# `RpcAgentEvent` variant is unchanged.
#
# Two behaviour changes DO reach a Kabmo surface, both adopted here:
#   - `display.shellVisualization` now GATES the shell trace: with it off, no
#     `details.trace` is produced or saved, where 18.17.0 emitted it regardless.
#     The default is still `true`, so the field arrives unless the operator turns
#     the row off; Kabmo has no visualization and drops it either way
#     (`shared/lib/omp/session/shell-trace.ts`).
#   - a leading `cd <dir>; …` is now hoisted into the working directory when
#     `<dir>` exists, and `details.cwd` NAMES the directory the command actually
#     ran in. Kabmo's Bash card already reads `details.cwd`, so the hoisted
#     directory now shows beside the command instead of nothing.
#
# Not adopted, deliberately: `excludeFromContext` (Kabmo has no first-party
# caller of the RPC `bash` command — the terminal panel and the Command Runner
# spawn their own children — so there is nothing to keep out of the model's
# context); the reworked compound-command approval matcher and `file-approval`
# (they change WHEN omp asks, and Kabmo renders whatever dialog arrives); the
# locale pin (`LANG`/`LC_ALL=C.UTF-8` for agent commands, which makes tool
# messages and sort order machine-independent); and the embedded-shell crash
# fixes (`grep -e`, a bare `[`, bytes that are not UTF-8) — those are the reason
# to take the release, not code to write.
#
# 18.18.3 (2026-11-09), carrying 18.18.2: the schema's `source` line moves to
# 604 settings while the panel stays at 450 rows — the two additions
# (`gc.strip`, `gc.stripAfterDays`) carry no `ui` block, so neither omp's panel
# nor this schema offers them, and only three descriptions change
# (`tui.mouse`, `mnemopi.dbPath`, `task.eager`). The RPC wire keeps its 74
# commands and gains ONE ADDITIVE definition (298 → 299), `ParentIrc`, carried by
# a steer from a parent agent. `builtin-names.ts`, `MODEL_ROLES` and the 89-spec
# slash registry (47 TUI-only names) are byte-identical.
#
# One upstream change DOES reach a Kabmo surface, adopted here: the `ask` tool
# takes one HTML `<form>` (`{ html }`) instead of `questions[]`, and answers with
# `details.answers[]` — `{ name, question, answer }` — plus `timedOut`. Measured
# on 18.18.3: the RPC host has no `formDialog`, so it walks the form's named
# controls one `select`/`input`/`editor` at a time, and `set_ask_dialog` no
# longer reaches the tool at all. Kabmo read `questions[]`, so every card would
# have gone blank and fallen back to raw text; `shared/lib/chat/ask-form/` now
# derives the questions omp does (own label, caption, legend, lone option, name)
# and `parseAskResult` reads the new details. The same data is echoed as
# `User answers:\n{json}` in the tool text, which is the fallback when the live
# `tool_execution_end` frame drops details.
#
# The fallback also became STRICTER: a `select` response must be a label omp
# OFFERED (`labels.indexOf`; a typed answer matches no index and cancels the
# whole ask). Kabmo hid the "Other (type your own)" row and sent typed text in
# its place, which 18.18.3 refuses; the card now sends the row itself and omp's
# follow-up `input`, titled with the same question, carries the text.
#
# Not adopted, deliberately: `ParentIrc` (a parent agent's IRC message on a
# steer — Kabmo runs top-level sessions and renders the model-facing envelope);
# `omp gc --strip` (omp's own storage maintenance, a CLI command Kabmo never
# invokes); overlapping-`bash` isolation (a second overlapping call now runs in
# a copy of the session shell; Kabmo reads the output, not the shell); the
# `sloppy` edit partial-apply and `logoutCredential`/`SessionStorage` API churn
# (host-side changes behind no RPC surface).
#
# 18.18.6 (2026-11-10), carrying 18.18.4 and 18.18.5: 18.18.5 is a catalog-only
# release (Claude Fable 5.2 / Mythos 5.2, Otari, the paused Google Antigravity
# provider) that Kabmo reads through `omp models --json`, so no code is coupled
# to it. The schema's `source` line stays at 604 settings and the panel at 450
# rows; ONE description changes (`lsp.enabled`, which now names the diagnostics
# and format-on-write it also gates). The RPC wire is byte-identical — 74
# commands, 299 definitions, 0 added/removed/changed — and `builtin-names.ts`,
# `MODEL_ROLES` and the 89-spec slash registry (47 TUI-only names) are
# identical, so nothing the bridge reads moved.
#
# Three upstream changes reach a Kabmo surface:
#   - a timed-out `wait` ends its sentence with the ladder's next rung —
#     `No reply within 5.0s; a back-to-back wait allows up to 10s.` — and a
#     job timeout is worded `No job finished within …`. Kabmo's idle parser
#     required the old trailing period, so both the card and the facts chip
#     would have lost the window (`shared/lib/omp/session/wait-idle.ts`).
#   - a settled job's result names HOW it was delivered ("delivered by this
#     wait", "handed over by this snapshot — this snapshot superseded its
#     queued completion push", "not auto-delivered … it had already finished
#     2m before this call"), and `JobSnapshot` gains `settledAtMs`. The lines
#     are model-facing and the field additive; the card already draws status,
#     span and intent from the same snapshot and ignores the rest.
#   - `todo append` without a phase now targets the in-progress task's phase,
#     then the first pending one, then the last phase, then a new `Tasks`
#     phase; 18.18.3 answered "Missing phase name". Kabmo parses the resulting
#     checklist from the tool text, so the successful shape needs no code.
#
# Not adopted, deliberately: the SDK's `PromptOptions.followUps` /
# `DroppedPrompt.followUps` and the usage reporters are host API with no RPC
# verb; `task` stops advertising a per-call `model` unless `task.perCallModel`
# is on (Kabmo never sets it, and a sent model is still refused);
# `lsp.enabled` now also gating write/edit diagnostics (Kabmo renders the
# result, not the server); and the session-file id repairs, `gc --strip`
# retention, MCP command-backed headers and the Tern/browser fixes are
# host-side with no RPC surface Kabmo reads.
#
# 18.18.9 (2026-11-11), carrying 18.18.7 and 18.18.8: the schema's `source`
# line moves to 608 settings and the panel gains FIVE keys while losing TWO
# (net +3 rows): the saved-reset auto-redeem switch is split per window.
# `codexResets.autoRedeem` becomes
# `autoRedeem5h` + `autoRedeemWeekly`, and `claudeResets.autoRedeem` becomes
# `autoRedeem5h` + `autoRedeemWeekly` + a new `autoRedeemFable`; omp migrates
# the legacy key into the two window keys on read, so no Kabmo code is coupled
# to either name. The RPC wire is byte-identical — 74 commands, 299
# definitions, 0 added/removed/changed — and `builtin-names.ts`, `MODEL_ROLES`
# and the slash registry are identical too (`/mcp smithery-*` was removed
# upstream but Kabmo never carried or forwarded those subcommands).
#
# One upstream change DOES reach a Kabmo surface, adopted here: a message that
# ends a `wait` no longer rides in the result. omp hands it to the recipient
# session, which injects it as its own `customType: "irc:incoming"` turn, and
# the wait answers `Wait interrupted by message.` with `interrupted: true` and
# no `details.waited`. Kabmo's wait card therefore loses the message block on
# new sessions (the old shape stays readable for sessions recorded before this
# pin), and the injected turn is drawn by `IrcNotice` from `details.from` /
# `details.message` instead of rendering the `<irc>` prompt envelope as a
# system notice.
#
# Not adopted, deliberately: `ask` notes (18.18.8) are typed into omp's own
# form dialog; the RPC host has no `formDialog` and walks the form field by
# field, so `details.notes` can never arrive here. The `/context` category
# split, `omp gc --strip` retention, the jq 1.8.2 shell, Hacker News/Sofya
# search engines, launch-service persistence and the browser/relay fixes are
# host-side or settings-neutral.
#
# 18.19.0 (2026-11-12): the schema's `source` line moves to 612 settings and the
# panel gains FOUR rows while losing ONE (net +3): `browser.webkit` and
# `browser.webkitPath` (tools / Grep & Browser) add omp's own headless WebKit
# engine, and `task.autoParallel` plus `task.steps` (tasks / Subagents) add
# judge-split top-level prompts and sequential subagent steps. `task.file` is
# removed with the `taskFile` argument it gated. No new `ui.condition` arrives,
# so `isConditionMet` needs no arm, and the six description-only updates
# (`ask.timeout`, `browser.cdpUrl`, `browser.enabled`, `browser.freezeOnTurnEnd`,
# `browser.headless`, `browser.tern`) reach the panel through the committed
# schema. The RPC wire keeps its 74 commands and 299 definitions — 0 added, 0
# removed, 5 changed — and `builtin-names.ts` gains only a `toolWireName`
# helper, while `MODEL_ROLES` and the slash registry (names, aliases and
# handlers) are unchanged.
#
# One upstream change DOES reach a Kabmo surface, adopted here: the `blocked`
# todo status is gone. omp deletes the `block`/`unblock` ops, the `blocker`
# note, the `[!]` marker and the `, N blocked` sentence, and reads a snapshot
# saved with blocked tasks back as `pending`. Kabmo's parser keeps the status
# because it reads tool text, and sessions recorded before this pin still carry
# it; new sessions simply cannot produce it.
#
# Not adopted, deliberately: `browser.webkit` / `browser.webkitPath` (engine
# choice for a tool Kabmo never calls), `task.autoParallel` (a judge-driven
# split of the model's own turns), `task.steps` (the card never drew a single
# spawn's instructions, and the default is off), the browser `app` keyword
# grammar and WebKit viewer, the `xd://read/sources` / `xd://read/urls` doc
# topics, `promptReference` on internal-URL schemes, the gh-run-watch step
# snapshots, and the OAuth-gated model modifiers — host-side or model-facing.
#
# 18.20.0 (2026-11-13): the schema's `source` line moves to 615 settings and the
# panel gains TWO rows (`encourageEdits` under model / Prompt, and
# `find.verifyModel` under tools / a new `Find` group), net +2; `find.hitThreshold`
# is registered with no `ui`, so omp's own panel has no row for it and the
# generator skips it the same way. One description changes
# (`model.toolCallLoopGuard.exemptTools` now also names `xd://` write devices).
# The RPC wire keeps its 74 commands and 299 definitions — 0 added, 0 removed,
# 1 changed: `SelectUiRequest` gains `initialIndex`, `selectionMarker`,
# `checkedIndices` and `markableCount`. `MODEL_ROLES`, the slash registry and
# the 30 `BUILTIN_TOOL_NAMES` are identical (`builtin-names.ts` gains a help
# table only).
#
# Not adopted, deliberately: the four `select` hint fields. They tell a host
# which row to focus and which rows are checked — the answer is still the one
# `{ value }` label (`parseValueDialogResponse` is unchanged), so Kabmo's
# dialog submits the same request and a valid label. They are supplied only by
# `ui.select` callers that want a marker (the TUI itself, and collab guests);
# Kabmo's own `ask` takes grouped form dialogs, so the fallback select path that
# would carry them is not the one it runs. Also not adopted: the read tool's
# list re-shaping (same `ReadToolDetails` fields and the same note text), grep's
# new `binaryMatches` detail plus its note and control-character sanitizing
# (the card draws `details.files` and the text), write's shebang executable bit
# moving before diagnostics, `touchesNoFiles` on `proc` device results, the
# `ssh-config` discovery provider and `ssh://` reads, LSP watched-file
# forwarding, the computer secure-input prompt and the `--allow-escape-sequences`
# fallback in gh-run-watch — host-side or additive fields Kabmo does not read.
#
# 18.20.2 (2026-11-14): the schema's `source` line moves to 622 settings and the
# panel gains FOUR rows, net +4: `auth.unpausedProviders` (providers / Services),
# `bash.allowedEnvVars` (shell / Bash), `commit.enabled` (tools / Available
# Tools) and `todo.midRunNudges` (tools / Todos). Three new settings are
# registered with no `ui` and therefore have no row, exactly as the generator
# treats every no-UI setting: `models.noJudge`, `models.noSpotlight` and
# `models.offline`. Two defaults change: `grep.contextBefore` 1 → 0 and
# `grep.contextAfter` 3 → 0, so a default grep shows only matching lines. The
# RPC wire is byte-identical — 74 commands, 299 definitions, 0 added, 0 removed,
# 0 changed — so the todo multi-target ops and the `session_clear` hook reach no
# Kabmo surface. `MODEL_ROLES`, the slash registry and the 30
# `BUILTIN_TOOL_NAMES` are identical.
#
# `auth.unpausedProviders` is the first new row to carry a `ui.condition`
# (`unpausedProvidersNotProject`). `isConditionMet` has no arm for it and its
# default shows the row, which is the right answer: the panel edits the global
# layer, and `omp config list --json` carries no provenance, so Kabmo cannot
# tell a project layer's disregarded list from an unset one.
#
# Not adopted, deliberately: `/commit` and the eval `commit` namespace (a
# host-side workflow; Kabmo's own commit path is unchanged), the `session_clear`
# extension event (not on the RPC wire), the `antigravity-cli` ACP provider
# (host-side), the `--no-judge` / `--no-spotlight` / `--offline` CLI flags
# (their `models.*` settings carry no `ui`, so the panel has no row for them),
# path-scoped bash allow rules and
# per-rule `env` (host-side approval), TTSR `repeatMode` (per-rule config, no
# panel row), composer paste formatting, `/fork` aborting an active response,
# and the model-discovery retry — host-side or model-facing.
#
# 18.20.3 (2026-11-16): the schema's `source` line moves to 625 settings and the
# panel gains THREE rows, net +3, all under memory / Mnemopi and all gated by
# the `mnemopiActive` condition `isConditionMet` already answers:
# `mnemopi.recallRelevance` (enum auto/on/off, default off),
# `mnemopi.embeddingQueryPrefix` and `mnemopi.embeddingInputType` (boolean,
# default off). The RPC wire is byte-identical — 74 commands, 299 definitions, 0
# added, 0 removed, 0 changed — and `MODEL_ROLES`, the 30
# `BUILTIN_TOOL_NAMES` and `settings-ui.ts` are identical too.
#
# Two upstream changes reach Kabmo's data, neither needing code:
#   - the bundled `seance` consult agent is removed with its slash command, task
#     policy, prompts and the `seanceSource` artifact plumbing. Kabmo never
#     named it.
#   - a stepped `task` spawn now delivers each earlier stage's result to the
#     spawning agent as an IRC message carrying `progress: true`. Kabmo keeps
#     that field and its notice card already draws the badge.
#
# Not adopted, deliberately: the browser's pointer-space/screenshot limits and
# `tab.route`/`requests`/`waitForUrl` grammar (Kabmo never drives that tool),
# the abort signal on an approval prompt (the RPC host passes none, so the
# dialog Kabmo shows cannot be cancelled from here), the session-delete
# ordering, `/commit`'s BOM/C-quoted paths, the find tool's `lexicalFallback`,
# clipboard stderr capture, Perplexity's sign-out wall, IDA 9.5 SDK calls and
# `xd://` device URLs refusing a line selector — host-side or additive fields
# Kabmo does not read.
#
# 18.21.0 (2026-11-17): the schema's `source` line moves to 627 settings and the
# panel gains ONE row, `tui.renderEmbeds` (appearance / Display), net +1;
# `task.agentPrewalkAuto` is registered with no `ui`, so omp's own panel has no
# row for it and the generator skips it the same way. The local TTS backend
# moves from Kokoro-82M to Phonon 31M: `tts.localVoice` and `speech.voice` swap
# their twelve voice ids (default `af_heart` → `harper`), and `tts.localSpeed` /
# `speech.speed` narrow their ladder from 0.5–2.5 to 0.8–1.3. omp migrates a
# stored Kokoro voice and a `local/kokoro` speech role on read, so no Kabmo code
# is coupled to either name. The RPC wire keeps its 74 commands and gains ONE
# ADDITIVE definition (299 → 300), `ShellForkOutcome`, carried by the new
# `BashResult.fork`; one description changes (`hasPendingAsyncWork` now also
# names child agents and queued peer messages). `MODEL_ROLES`, the 30
# `BUILTIN_TOOL_NAMES` and the slash registry are identical.
#
# The run lifecycle is reworked internally: a run opens at its first
# `agent_start` and closes at exactly one `agent_end`, and every model loop that
# stops while the run goes on emits `agent_pause` instead. The RPC, JSON print
# and collab wires keep their per-loop `agent_end` shape (`loop-end-wire.ts`):
# a pause is `agent_end {isTerminal:false, yielded, awaitingAsyncWork?}`, which
# is exactly what Kabmo already folds, so no frame handling changes. Two
# consequences DO reach Kabmo's state machine, both already correct:
#   - `prompt_result` now reports at a yielded pause, not only at the run's end.
#     Kabmo's fold only acts on `agentInvoked:false` (a prompt that opened no
#     turn), so a real run's frame still changes nothing.
#   - `get_state.isSettled` no longer reads `hasPendingAsyncWork` directly; the
#     run stays open while a job, child agent or peer message can wake it, so
#     the verdict is unchanged. `session_settled` therefore still implies no
#     wake source.
#
# Two upstream changes reach a Kabmo surface, neither needing code:
#   - a `bash` call that overlapped another on the session's shell now reports
#     `details.fork {carried, jobs}` and appends a notice naming what was lost
#     (state, or background jobs left in the copy). Kabmo renders the result
#     text, so the notice shows as-is; the field is additive.
#   - a bash redirect into a handler-written URL (`> proc://<id>/kill`,
#     `> xd://<tool>`) now performs the write and reports the handler's answer
#     as a result notice. Kabmo's extension writes `xd://propose` through the
#     `write` tool, whose path is unchanged.
#
# Not adopted, deliberately: `tui.renderEmbeds` (it only reaches the system
# prompt when `tuiTranscript` is on, which is the interactive TUI; RPC, print,
# ACP and subagents pass false, so Kabmo's agent is never invited to emit
# `<img>`/`<iframe>`), `task.agentPrewalkAuto` (a per-agent prewalk policy with
# no panel row), the `ask` tool's image answers (`formDialog` only; the RPC host
# walks the form field by field and never carries images), the `Model.reasoning`
# field becoming optional (Kabmo already treats `undefined` as "not reported"),
# and the TTS/Phonon, browser scratch-page, MCP reconnect, `/move` rescope,
# pinned-Hub download and selective-commit index-retry work — host-side or
# model-facing.
#
# 18.22.0 (2026-11-17): the schema's `source` line moves to 629 settings and the
# panel gains FIVE rows while losing THREE (net +2). The `ida` TOOL is gone from
# `BUILTIN_TOOL_NAMES` (30 → 29 tools) and binary analysis moved behind `read`
# selectors and eval's `dsm` namespace, so the `ida.enabled` row is deleted
# while `ida.python`/`ida.installDir` stay. In its place:
# `disassembler.backend` (auto/ghidra/ida/none), `disassembler.maxOpen` and
# `disassembler.idleCloseSec` (tools / Disassembler), plus `ghidra.installDir`
# and `ghidra.python` (tools / Ghidra). `worktree.onExit` gains `force`, which
# removes every worktree without asking, uncommitted work included. The RPC wire
# is byte-identical — 74 commands, 300 definitions, 0 added, 0 removed, 0
# changed — and `MODEL_ROLES`, the slash registry and `modes/settings.ts` are
# identical, so nothing Kabmo folds or guards moved.
#
# One upstream change reaches Kabmo's read surface, and needs no code: reading
# an executable (ELF/PE/Mach-O, extensionless included) now answers on-disk
# metadata only and never starts a backend or a download; the analysis views
# (`:overview`, `:imports`, …) are an explicit opt-in, and IDA databases require
# `disassembler.backend=ida`. Kabmo renders the result text as-is.
#
# Not adopted, deliberately: the `dsm` eval namespace and its `xd://eval/dsm`
# doc topic (advertised only when a backend resolves, which needs IDA or a
# Ghidra provisioning pass; Kabmo never scripts it), the Ghidra/PyGhidra
# runtime and its managed venv, `read`'s universal-Mach-O metadata slices, the
# plan review's save-stays-open change (TUI overlay; Kabmo's review is its own
# `xd://propose` flow), the `worktree.onExit=force` execution path (Kabmo offers
# the setting from the schema but does not act on it), and the session-view
# copy elision, ctime-based selective-commit windows, deleted-file call
# matching, LSP `PathMap`, mlx venv and CLI worker-selector renames — host-side.
# 18.22.2 (2026-11-18): the schema's `source` line moves to 632 settings and the
# panel gains THREE rows, net +3, all under providers / Services:
# `live.endpoint` and `live.apiKey` (the key is a credential, so the panel masks
# it) and `providers.webKeyless` (boolean, default true). `live.voice` stops
# being an enum and becomes a free-form string that still ships the same nine
# voices as `ui.options`; omp's own panel renders string+options as a submenu and
# so does `RowEditor`, so the row is unchanged on screen and a custom voice name
# is config-only in both. The RPC wire is byte-identical — 74 commands, 300
# definitions, 0 added, 0 removed, 0 changed — and `MODEL_ROLES`,
# `tools/builtin-names.ts` (29 tools) and the slash registry are identical too.
#
# The generator carried no `credential` marker at all: it read
# `definition.isCredential`, a getter on the `Setting` instance, while
# `orderedSettings()` hands it the raw `SettingDefinition`, where the marker is
# `credential`. Every credential row therefore rendered in plain text. Fixed in
# `scripts/omp-schema.mjs`; four rows now mask (`live.apiKey`,
# `mnemopi.embeddingApiKey`, `mnemopi.llmApiKey`, `hindsight.apiToken`).
#
# Two upstream changes reach Kabmo's surfaces, neither needing code:
#   - RPC `login` no longer refuses a provider with an at-your-own-risk warning
#     (`antigravity-cli`, `google-antigravity`): the warning arrives as an
#     `extension_ui_request` `input` (placeholder `yes`) and the flow continues
#     on "yes". Kabmo's login dialog already renders a non-secret `input` as a
#     text field and posts the value, so those logins can now be completed.
#   - an over-quota 429 now always ends with a terminal `agent_end`, which is
#     the frame Kabmo's fold already treats as the run's close.
#
# Kiro arrives as a built-in provider (`/login kiro`, credits in `/usage`). It
# reaches the console through `get_login_providers` with no list to edit, and
# the provider icon falls back to its initials badge.
#
# Not adopted, deliberately: the browser's native-window report, `select()`
# label/value/index choices, the subagent browser context and the relay/Tern
# `app` gating (Kabmo never drives that tool), the computer tool's `setValue`
# numbers and macOS takeover messages, the eval `commit` argument validation and
# hook output, `/restart` re-execing through the launcher, the background
# prompt-history write, shared discovered-model builds, Anthropic's demoted
# reasoning replay and `omitDemotedReasoning`, the subagent `yield` changes
# (model-facing), `^model` punctuation, `/copy` reading `out://` replies, the
# goal-mode tool roster fix, selective-commit submodule/sparse handling, the
# Zhipu quota-reset retry, status-line credential selection, the `--continue`
# breadcrumb rule and the LSP inotify pruning — host-side or model-facing.
#
# 19.0.0 (2026-11-19) is a BREAKING release upstream. The schema's `source` line
# moves to 638 settings and the panel gains SIX rows: `providers.
# cacheWarmingStrategy` (auto/keepalive/compact), `providers.
# cacheWarmingCompactPercent` and `providers.cacheWarmingCompactTokens`
# (providers / Protocol), `task.crossInstance` (tasks / Subagents),
# `mcp.evalNamespaces` and `mcp.builtinTransforms` (tools / Discovery & MCP).
# `composer.predictions` flips its default false → true (Kabmo has no prediction
# surface, so the row is editable and nothing reads it), `task.enableLsp` is
# relabelled "LSP Edit Checks in Subagents" and now gates only formatting and
# diagnostics, and four descriptions change. The RPC wire keeps its 74 commands
# and gains ONE ADDITIVE definition (300 → 301), `CacheWarmingMethod`, carried
# by a now-required `method` on `cache_warming_start`/`_end`; one description
# changes (`ManualCompactionStartEvent`). `MODEL_ROLES`,
# `tools/builtin-names.ts` (29 tools) and the slash registry are identical.
#
# Three upstream breaks DO reach a Kabmo surface, each fixed with the bump:
#   - `artifact://<id>` became `local://<id>.log`, and the spill file moved from
#     `<sessionDir>/<id>.<kind>.log` to `<sessionDir>/<id>.log`. The `details`
#     record is unchanged, so the chip still finds the id; `readArtifact` now
#     probes `<id>.log` first and falls back to the legacy name for a session
#     recorded before the pin (`artifacts.server.ts`).
#   - `proc://` reports a daemon `UnitSnapshot` — `{key, label, pids,
#     policy.hold}` — instead of the broker's `{name, pid, persist, detached}`.
#     Kabmo's `ProcDaemon` reader maps both generations, so the service name,
#     pid and mode facts survive (`shared/lib/omp/session/proc-daemon.ts`).
#   - the `wait` ladder is two rungs, 5 s then 4 minutes, and the timeout
#     sentence now continues with "Nothing else left? …". The window still ends
#     the first sentence, so the parser is unchanged; the constant and its
#     comments moved (`wait-idle.ts`).
#
# `/handoff` is now a background compaction (`session.compact(focus, {mode:
# "handoff"})`), and the RPC `handoff` command no longer refuses while a
# response is in flight. Kabmo never calls the RPC verb; `/handoff` and
# `/compact handoff` are forwarded as prompts, and `manual_compaction_start`
# arriving mid-stream is already folded. `handoff` stays in
# `CONVERSATION_MOVING_COMMANDS` because the compaction still rewrites the
# transcript a side question snapshotted.
#
# Not adopted, deliberately: the unified per-user daemon and `omp ps --json`'s
# `{daemon, reports}` shape (Kabmo never runs `omp ps`), built-in MCP transforms
# and eval namespaces, cross-instance task discovery, Tern live cards, the `btw`
# draft mode, the `bash` `notify` option and `excludeFromContext` on bash/eval
# messages, the `read` binary-resource backing file, grep's notebook projection
# and gitignored hint, the `todo` active-phase selection, the `yield`
# schema/result changes, `/restart` re-execing through the launcher, the
# `--continue` breadcrumb rule, the commit/hook fixes, the browser/computer
# fixes and the LSP inotify pruning — host-side or model-facing.
# 19.0.1 (2026-11-20) is a PATCH release: no breaking change, no RPC wire
# change (`rpc-wire.schema.json` is byte-identical — 74 commands, 301
# definitions), no settings change (every `*-settings` domain is byte-identical,
# so the panel stays at 638 settings / 477 entries and `omp:schema:check` passes
# on the regenerated file). 27 files under `pi-coding-agent/src` differ (26
# changed, 1 added `utils/stream-newlines.ts`).
#
# ONE upstream break reaches a Kabmo surface, and it is the lease probe:
#
#   On Linux the session ownership lease is now an open-file-description lock on
#   `<session-owners>/<id>.lock` instead of an abstract socket, so the file Kabmo
#   probes finally exists there — but the primitive is NOT `flock`. Linux keeps
#   `flock(2)` and record locks in separate spaces, so a `flock` probe acquires a
#   lease another omp holds and reports "free" (measured in a Linux container,
#   bun 1.4.4: `flock` said free, `F_OFD_GETLK` said `F_WRLCK`). Kabmo would
#   then spawn a second writer on a session another instance owns, and omp forks
#   the session. `lease-flock.server.ts` became `lease-probe.server.ts`: `flock`
#   on macOS, `F_OFD_GETLK` on Linux, and `holdLeaseForTest` takes the same
#   primitive per platform so the test's holder is one omp recognises.
#
# Two more fixes reach a Kabmo surface and need no code:
#   - A PTY transcript no longer gains a blank line when a `\r\n` ending is
#     split across two terminal reads (`bash-executor.ts` now runs the chunk
#     through `StreamNewlineNormalizer` instead of a per-chunk `replace`).
#     Kabmo renders the `bash` tool text verbatim; the minimize `details` are
#     unchanged.
#   - `--resume <id>` under `--mode rpc` no longer fails at start when the
#     session's recorded directory is gone; it opens in place. Kabmo passes
#     `--resume <file>` for a reattached session (`rpc/constants.ts`), a path
#     `SessionManager.open` takes directly, so that prompt never ran here.
#
# One additive `models.yml` field, no code: `snapcompactShape` (`{variant,
# frameSize}`) on a model, on `modelOverrides.<id>` and on an extension
# `registerProvider` model. Kabmo's only `models.yml` writer sets `maxTokens`
# and `thinking` through `setIn`, so a value omp wrote survives the round trip,
# and `models-validation.ts` ignores unknown model keys (omp's schema does too).
#
# Also fixed upstream, host-side or TUI: `^model` mentions in queued messages
# (`steer`/`follow_up`, ACP steering) expand instead of reaching the model as
# literal text, and the "m<N> now available" notice is no longer repeated;
# `/loop` and `/goal` wait for a yielding run's background jobs; a gateway's
# advertised modalities and output cap are read (and a `transport: pi-native`
# provider skips the provider's own model discovery); the first turn after a
# compaction loses its spurious cache-miss marker; plan review measures "approve
# and keep context" against the selected tier; `/session` reports the `local://`
# directory and `/copy local` copies it; the browser relay survives a browser
# without the `downloads` permission; a plugin manifest with a non-string
# `extensions` entry loads instead of throwing; the Windows shell `dirname`
# builtin and Windows bash minimizing are fixed; native dock order and the
# `omp://tools` docs moved.
#
# 19.1.0 (2026-11-21) is a BREAKING release upstream: `xd://` tool DEVICES are
# gone, replaced by tool COMMANDS. Rarely-used tools are unmounted from the
# request and installed as bare commands of the embedded shell, so the model
# runs `resolve "<reason>"`, `propose <slug>` or `lsp --help` through `bash`;
# each invocation is recorded on `details.toolCommands[]` as
# `{tool, mode, exitCode, args?, inner?}`, with the wrapped tool's own result in
# `inner`. Doc topics moved from `xd://<tool>/<topic>` to
# `help://<tool>/<topic>`, and `tools.xdev`/`xdevDocs`/`xdevInlineDevices`/
# `xdevNotices` were renamed to `tools.commands`/`commandDocs`/`commandInline`/
# `commandNotices`. The RPC wire goes 74 → 77 commands and 301 → 308
# definitions (additive: `abort_and_deliver_queue`, `resume`,
# `get_model_picker`, `DataUiResponse`, `FormUiRequest`, `ModelPicker*`), and
# the settings panel 638 → 643 rows / 477 → 482 entries.
#
# THREE upstream breaks reach a Kabmo surface, each fixed with the bump:
#
#   - THE ASK FORM. `RpcExtensionUIContext` now has a real `formDialog`, so the
#     `ask` tool stops walking its HTML form one blocking dialog per control and
#     sends the WHOLE form as one `extension_ui_request` with `method:"form"`
#     (`{html, timeout?}`, no `title`), answered by ONE `extension_ui_response`
#     carrying `{data}`. Neither half of Kabmo's bridge listed the method: the
#     server forgot the request a reattaching client must answer and the client
#     never queued it, so the agent parked forever with nothing on screen.
#     `form` is now in `ANSWERABLE_UI_METHODS`; `splitAskFrames` claims the
#     frame by its `html` (the exact string the tool call carries) and hands it
#     to `FormDialog`, which builds the reply with `buildFormData` — mirroring
#     omp's own validation (unknown keys, disabled options, array-vs-string
#     choices and `required` fields are all refused with the field named).
#   - THE STAGED PROPOSAL. `resolve`/`reject`/`propose` are tool commands now,
#     so the decision arrives as a `bash` call whose result carries
#     `details.toolCommands[]`. `Resolve`/`AstEdit`/`Lsp`/`Mcp` read the wrapped
#     tool's `inner` details and parsed `args` through
#     `shared/lib/chat/tool/tool-commands.ts`, and the panel registry treats a
#     SOLE invocation (`resolve "x"`, nothing piped or redirected) as that
#     tool's own call — otherwise a terminal console drew over the decision.
#     The preview reminder also changed wording ("run `resolve`" instead of
#     "write to `xd://resolve`"), which `SystemNotice` now recognises.
#   - THE TOOL DOCS. `read xd://<tool>/<topic>` became
#     `read help://<tool>/<topic>`; the doc-read path accepts both, because a
#     session recorded before the pin still carries the old URL.
#
# Also adopted with no code: `set_thinking_level` accepts `auto` (Kabmo already
# sends the ladder's own values and skips `auto` in a queue replay),
# `set_model` takes an optional `thinkingLevel`/`role` (Kabmo passes neither),
# and the first JOB wait in a top-level session skips the 5 s floor — the
# window is still parsed from omp's sentence, never from the rung.
#
# Not adopted, deliberately: `abort_and_deliver_queue`, `resume` and
# `get_model_picker` (Kabmo's Stop is `abort` and its picker is its own
# catalog), the daemon-shared MCP host and its `mcp.shared`/`mcp.idleStopMinutes`
# rows, the `magic` edit mode and `edit.magic.model`, Binary Ninja and
# `binja.*`, the archive full-text index, extension provider overrides, the
# `ask` form's option NOTES and images, MCP 2026-07-28, the native
# browser-relay host (Kabmo runs no `omp browser-relay`), collab session
# controls, `pty.notify`, the job-stream files in `proc://<id>/streams`, and the
# transcript-search, selective-commit, Spotlight, TTSR, retry and browser
# fixes — host-side or model-facing.
# 19.1.1 (2026-11-23) is a PATCH release by wire and by panel: the RPC schema is
# BYTE-IDENTICAL to 19.1.0 (77 commands, 308 definitions, same sha256) and
# `builtin-names.ts`, `model-roles.ts`, the 89-spec slash registry and pi-tui's
# `settings-defs.ts` did not move. The settings registry goes 643 → 644 and the
# panel 482 → 483 entries, one net row: `computer.takeover` REPLACES
# `computer.backgroundFallback` (four values, default `fallback`; omp carries a
# stored `refuse` over and drops the rest, since the old `takeover` is the new
# default), and `todo.backend` (string, default `native`, `options: "runtime"`)
# names the extension that mirrors the todo list. Kabmo's panel reads both from
# the regenerated schema and no code named the old key.
#
# Nothing else reaches a Kabmo surface, measured rather than assumed:
#   - the `ask` split-radio refusal (one `name` per radio in one fieldset) sits
#     BEFORE the host branch, so it applies to Kabmo's `method:"form"` host too —
#     but it answers a plain tool result with no answers, which the ask card
#     already renders through `FallbackOutput`, and Kabmo never authors a form.
#   - background job labels are collapsed and bounded in one helper
#     (`formatAsyncJobLabel`): same 120-character cap, newlines folded first.
#     Kabmo draws the label verbatim, so a multi-line command reads as one line.
#   - `model_change` records the routed model identity (`provider/model@upstream`)
#     when a model is pinned to an openrouter/vercel-gateway route; every Kabmo
#     consumer forwards `${provider}/${modelId}` back to omp, which resolves the
#     exact selector, and `omp models --json` lists no routed rows, so the
#     composer's catalog match behaves as before.
#
# Not adopted, deliberately: `/wt`'s post-checkout hook, the `tree` status
# segment, `pi.registerTodoBackend()` and the `phasesChanged` mirror, the
# gateway's discovered models for `pi-native` providers, the `column` shell
# builtin, RPC-host MCP cleanup, the restored-job and exit-diagnostics fixes,
# and the selective-commit, Spotlight, TTSR, browser, scraper and Magic Edit
# work — host-side, TUI or model-facing.
OMP_VERSION="${OMP_VERSION:-19.1.1}"
PACKAGE="@oh-my-pi/pi-coding-agent"
WANTED="omp/${OMP_VERSION}"

if command -v omp >/dev/null 2>&1 && [ "$(omp --version 2>/dev/null | awk '{print $1}')" = "$WANTED" ]; then
  echo "omp ${OMP_VERSION} already installed"
  exit 0
fi

status=1
for attempt in 1 2 3; do
  echo "Installing ${PACKAGE}@${OMP_VERSION} (attempt ${attempt}/3)"
  if bun add -g "${PACKAGE}@${OMP_VERSION}"; then
    status=0
    break
  fi
  status=$?
  if [ "$attempt" -lt 3 ]; then sleep "$((attempt * 5))"; fi
done

if [ "$status" -ne 0 ]; then
  echo "::error::could not install ${PACKAGE}@${OMP_VERSION} after 3 attempts" >&2
  exit 1
fi

installed="$(omp --version 2>/dev/null | awk '{print $1}')"
if [ "$installed" != "$WANTED" ]; then
  echo "::error::installed omp is ${installed:-unknown}, expected ${WANTED}" >&2
  exit 1
fi

echo "omp ${OMP_VERSION} ready"
