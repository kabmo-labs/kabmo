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
OMP_VERSION="${OMP_VERSION:-18.18.3}"
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
