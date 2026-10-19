#!/usr/bin/env bash
# Run the CI gates locally, in the same Linux container CI uses.
#
# WHY THIS EXISTS: a Windows-only change cannot be verified on a Mac, and pushing
# to `main` to find out costs a release. But the LINUX gate can be reproduced
# exactly — same image, same Bun version, same commands — so a push only ever
# carries the part that genuinely needs CI.
#
# What this CANNOT do: run the Windows gate. Windows containers need a Windows
# kernel, and Docker on macOS/OrbStack runs Linux ones only (measured:
# `docker run mcr.microsoft.com/windows/servercore` answers "no matching
# manifest for linux/arm64"). A Windows VM (Parallels/UTM) or a self-hosted
# runner is the only local option for that leg.
#
# Usage:
#   scripts/ci-local.sh              # all gates, Linux
#   scripts/ci-local.sh test         # bun test only
#   scripts/ci-local.sh e2e          # Playwright Chromium
#   scripts/ci-local.sh typecheck    # tsc + the no-unused pass + the E2E layer
#   scripts/ci-local.sh size         # the 350-line ceiling
#
# The working tree is mounted read-write because the build writes `dist/` and
# Playwright writes `test-results/`; both are gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="ompchamber-ci-local:1.4.3"
TASK="${1:-all}"

# The gate image is `oven/bun` PLUS the tools the suite actually spawns.
# Measured: the stock image has no `git` at all, so 149 tests failed with
# `Executable not found in $PATH: "git"` — a property of the image, not of the
# code. `python3`, `procps` and `make` are here for the same reason: the
# font-subset check, every `ps`-based probe (`psProbe`, `detectBusyShells`,
# `foregroundGroup`) and the command-runner's Makefile detector, which really
# runs `make`. Debian's base image ships none of them.
#
# `ripgrep` is deliberately NOT installed. Debian's rg is 14.x, which emits the
# raw line (NUL bytes and all) when a binary file is named explicitly, while
# rg 15 strips them; `ripgrep.test.ts` pins the stripping. The runner image CI
# actually uses has no rg on PATH either, so the `ripgrep` npm package's WASI
# build is what runs there — and installing the older native one here made a
# test fail for a reason CI would never see. Reproduce CI, not a Debian box.
ensure_image() {
  if docker image inspect "${IMAGE}" >/dev/null 2>&1; then return; fi
  echo "ci-local: building ${IMAGE} (once)..."
  docker build -q -t "${IMAGE}" -f - "${ROOT}" <<'DOCKERFILE'
FROM oven/bun:1.4.3
RUN apt-get update \
 && apt-get install -y --no-install-recommends git make python3 procps \
 && rm -rf /var/lib/apt/lists/*
# A NON-ROOT user, because root bypasses permission bits. Two tests depend on a
# write actually FAILING — `chmod 0o500` on a directory, and a file the process
# may not replace — and as root both writes succeed, so the assertions failed for
# a reason that has nothing to do with the code. CI's runner is non-root too.
# The image already ships `bun` at uid 1000, so reuse it rather than add a second.
USER bun
DOCKERFILE
}

# Every `node_modules` in the tree is OVERLAID with a volume, and that is not a
# speed trick — it is a correctness one. The host's install is a Bun workspace
# whose member symlinks are ABSOLUTE macOS paths (`marketplace/plugins/…/
# node_modules/@kabmo-labs/ui -> /Users/<name>/…/packages/ui`), so a container
# that mounts the tree read-write resolves them to nothing: six suites died with
# `ENOENT reading "…/node_modules/@kabmo-labs/ui"` while the same suites passed
# on the host. The overlay also keeps `bun install` inside the container from
# rewriting the host's tree, which it did once (the whole install was deleted).
NODE_MODULES_OVERLAYS=(
  /work/node_modules
  /work/packages/ui/node_modules
  /work/packages/plugin-sdk/node_modules
  /work/marketplace/plugins/command-runner/node_modules
  /work/marketplace/plugins/session-info/node_modules
  /work/marketplace/plugins/stats/node_modules
)

# One `-v` pair per path. Built as an ARRAY rather than through `mapfile`,
# which macOS's bash 3.2 does not have — a script that only runs on the Linux
# side of a cross-platform repo is the same trap the Windows gate exists for.
overlay_args() {
  OVERLAYS=()
  for path in "${NODE_MODULES_OVERLAYS[@]}"; do
    OVERLAYS+=(-v "ompchamber-ci$(echo "${path}" | tr '/' '-')":${path})
  done
}

# A fresh named volume is owned by root, and the container runs as `bun`, so the
# first `bun install` into one fails with `ENOENT … failed to link package`. The
# ownership is set ONCE per volume (a named volume keeps it), which is why this
# is a separate short container rather than a `--user root` on the real run: the
# suite must run unprivileged (two tests depend on a write actually FAILING).
prepare_overlays() {
  overlay_args
  local paths
  paths="$(printf '%s ' "${NODE_MODULES_OVERLAYS[@]}")"
  docker run --rm --user root \
    -v "${ROOT}:/work" \
    "${OVERLAYS[@]}" \
    -w /work \
    -e "OVERLAY_PATHS=${paths}" \
    "${IMAGE}" \
    bash -lc 'chown bun:bun ${OVERLAY_PATHS} 2>/dev/null || true' >/dev/null
}

# `--init` so a killed `bun test` does not leave orphaned children, and a fixed
# hostname so nothing in the suite depends on the machine name.
run() {
  ensure_image
  prepare_overlays
  overlay_args
  docker run --rm --init \
    -v "${ROOT}:/work" \
    "${OVERLAYS[@]}" \
    -w /work \
    -e CI=true \
    -e NODE_ENV=test \
    -e SYNC_WORKSPACE=false \
    -e HOME=/home/bun \
    "${IMAGE}" \
    bash -lc "$1"
}

case "${TASK}" in
  typecheck)
    run 'bun install --frozen-lockfile && bun run lint && bunx tsc --noEmit --noUnusedLocals --noUnusedParameters && bun run typecheck:e2e'
    ;;
  test)
    run 'bun install --frozen-lockfile && bun test'
    ;;
  size)
    # The ceiling is a rule about the source tree; it needs no install.
    run 'find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | grep -v total | awk "\$1>350" | { ! grep . || { echo "Files over 350 lines:"; cat; exit 1; }; }'
    ;;
  build)
    run 'bun install --frozen-lockfile && NODE_ENV=production bun run build'
    ;;
  e2e)
    # The browser download is the slow part; it is cached in a named volume so a
    # second run does not refetch it.
    ensure_image
    prepare_overlays
    overlay_args
    docker run --rm --init \
      -v "${ROOT}:/work" \
      "${OVERLAYS[@]}" \
      -v ompchamber-playwright:/home/bun/.cache/ms-playwright \
      -w /work \
      -e CI=true \
      -e HOME=/home/bun \
      "${IMAGE}" \
      bash -lc 'bun install --frozen-lockfile && bunx playwright install --with-deps chromium && bun run test:e2e --project=chromium'
    ;;
  all)
    run 'bun install --frozen-lockfile && bun run lint && bunx tsc --noEmit --noUnusedLocals --noUnusedParameters && bun run typecheck:e2e && bun test && NODE_ENV=production bun run build'
    run 'find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | grep -v total | awk "\$1>350" | { ! grep . || { echo "Files over 350 lines:"; cat; exit 1; }; }'
    ;;
  *)
    echo "unknown task: ${TASK}" >&2
    echo "use: all | typecheck | test | e2e | build | size" >&2
    exit 2
    ;;
esac

echo "ci-local: ${TASK} OK"
