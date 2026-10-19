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
OMP_VERSION="${OMP_VERSION:-18.12.0}"
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
