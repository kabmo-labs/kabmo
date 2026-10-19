#!/usr/bin/env bash
# Publishes the @kabmo-labs/* plugin packages to npm.
#
# Publishing is IDEMPOTENT, and that is the whole point of this script rather
# than a bare `bun publish` in the workflow. A run can die between the first
# package and the second (a network blip, a token that expires mid-job, a
# cancelled job), and the retry must finish the job rather than fail on the
# package that already went out. So each package is checked against the registry
# first, and one that is already published at this exact version is skipped.
#
# A version already on npm is never overwritten: npm refuses a republish, and
# republishing would be wrong anyway. To ship a change, bump the version.
#
# A failure STOPS the run rather than moving to the next package. The list is in
# catalog order, and `@kabmo-labs/ui` pins the SDK version at pack time, so
# publishing `ui` after a failed SDK publish would put a package on npm whose
# dependency does not exist there — worse than publishing neither.
#
# usage: publish-plugin-packages.sh <package-dir>...
#   each <package-dir> is relative to the repo root and holds a package.json
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: publish-plugin-packages.sh <package-dir>..." >&2
  exit 2
fi

# Which packages are already at this version, asked once.
# `npm view` exits non-zero for a package that does not exist yet, which is the
# expected answer on a first publish — hence the `|| true` rather than a guard.
published_version() {
  local name="$1"
  npm view "$name" version 2>/dev/null || true
}

for dir in "$@"; do
  if [ ! -f "$dir/package.json" ]; then
    echo "::error::$dir has no package.json"
    exit 1
  fi

  name="$(bun -e "console.log((await Bun.file('$dir/package.json').json()).name)")"
  version="$(bun -e "console.log((await Bun.file('$dir/package.json').json()).version)")"

  if [ -z "$name" ] || [ -z "$version" ]; then
    echo "::error::$dir has no name or version"
    exit 1
  fi

  existing="$(published_version "$name")"
  if [ "$existing" = "$version" ]; then
    echo "skip: $name@$version is already on npm"
    continue
  fi

  echo "publishing $name@$version (registry has: ${existing:-<none>})"
  if ! (cd "$dir" && bun publish); then
    echo "::error::failed to publish $name@$version — stopping, later packages depend on it"
    exit 1
  fi
  echo "published $name@$version"
done
