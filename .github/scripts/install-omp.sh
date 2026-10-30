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
# audit in docs/omp-18.8-adoption-plan.md names which features each phase
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
# docs/omp-18.8-adoption-plan.md.
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
OMP_VERSION="${OMP_VERSION:-18.14.0}"
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
