#!/usr/bin/env bash
# Publishes the @kabmo-labs/* packages to GitHub Packages (npm.pkg.github.com).
#
# This is an ADDITIONAL destination, never a replacement. The npmjs.org publish
# stays exactly as it is (`publish-packages.yml`, `publish-app.yml`), nothing
# here is reachable from a release run, and NO manifest carries
# `publishConfig.registry` — adding one would silently redirect `bun publish`
# for the whole pipeline, which is the one way this file could break the app's
# own release. `tests/publish-github-packages.test.ts` asserts that.
#
# WHY A SEPARATE SCRIPT, not `publish-plugin-packages.sh`. The npmjs script asks
# npm for the published version (`npm view`), which resolves its registry from
# npm's own scope config; here the registry is named on the command line and the
# existence check is one authenticated GET against the packument. The two differ
# in the auth mechanism and in the question they ask, so sharing a script would
# mean branching on the registry inside every step.
#
# AUTH: `GITHUB_TOKEN`, which GitHub Packages accepts for a package associated
# with this repository — the `repository` field in each package.json is what
# associates it, and the workflow grants `packages: write`.
#
# The token reaches bun through `NPM_CONFIG_TOKEN` and the registry through
# `--registry`, and BOTH are load-bearing (each was measured on bun 1.4.3):
#
#   - `.npmrc` `_authToken=${VAR}` — bun does NOT expand the environment in a
#     `.npmrc`, so the literal `${VAR}` is sent and every publish is refused.
#   - `.npmrc` `@kabmo-labs:registry=…` alone — `bun publish` ignores the scope
#     mapping and publishes to npmjs.org, i.e. it would put a duplicate of this
#     repository's packages on the public registry.
#   - `--registry` alone — the publish reaches the right host and is refused
#     `missing authentication`, because no token is configured for it.
#   - `--registry` + `NPM_CONFIG_TOKEN` — works, and is what this script does.
#
# The scoped attachment key is also required and is what bun already sends
# (`@kabmo-labs/probe-0.0.4.tgz`, verified against a header/body-recording
# registry stub). GitHub Packages answers `400 no attachments present in
# packument` for a flattened key, which is the bun bug fixed upstream in
# oven-sh/bun#16630; a bun downgrade below that fix would surface here.
#
# A version already on the registry is SKIPPED, never overwritten: GitHub
# Packages refuses a republish with `409`, and `--tolerate-republish` does NOT
# suppress it (measured — bun 1.4.3 still exits 1). To ship a change, bump the
# version. The skip is also what makes a re-run finish a half-published run.
#
# A failure STOPS the run rather than moving to the next package. The list is in
# catalog order and `@kabmo-labs/kabmo-ui` pins `@kabmo-labs/kabmo-sdk` at the
# exact version, so a UI published after a failed SDK publish would name a
# dependency this registry does not have.
#
# usage: publish-github-packages.sh <package-dir>...
#   each <package-dir> is relative to the repo root and holds a package.json;
#   `.` is the app itself, which must come LAST because it depends on both
#   plugin packages.
#
# env: GITHUB_TOKEN   required; a token with `packages: write`. In the workflow
#                     this is the job's own GITHUB_TOKEN. A PAT (classic, with
#                     `write:packages`) is accepted through the same variable —
#                     see GH_PACKAGES_TOKEN in the workflow, which exists for the
#                     one case GITHUB_TOKEN cannot cover.
#      GH_PACKAGES_DRY_RUN=1  pack and report without publishing
#      GH_PACKAGES_REGISTRY   the registry to publish to, DEFAULTED and never
#                             set by a workflow. It exists so the test can point
#                             this script at a stub — the skip/refuse/report
#                             branches are unreachable against the real registry
#                             without credentials — and a caller that sets it is
#                             asking to publish somewhere else on purpose.
set -euo pipefail

REGISTRY="${GH_PACKAGES_REGISTRY:-https://npm.pkg.github.com/}"

if [ "$#" -eq 0 ]; then
  echo "usage: publish-github-packages.sh <package-dir>..." >&2
  exit 2
fi

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required (packages: write)}"
DRY_RUN="${GH_PACKAGES_DRY_RUN:-0}"

# The packument URL for a package name, percent-encoded the way the registry
# spells a scope: `@kabmo-labs/kabmo-sdk` -> `@kabmo-labs%2fkabmo-sdk`.
packument_url() {
  local name="$1"
  printf '%s%s' "$REGISTRY" "${name//\//%2f}"
}

# The versions already published for a package, one per line on stdout.
#
# Three answers, and the caller must not confuse them: a version list (possibly
# empty), `absent` (a 404 — the expected answer on a first publish), and a
# REFUSAL (401/403), which is reported rather than read as "nothing published"
# because the two look identical on screen and only one is actionable.
#
# The HTTP status is RETURNED as an exit code rather than decided inside a
# pipeline, because "not published yet" and "the credential was refused" both
# look like a non-zero pipeline status — measured: with the check written as
# `published_versions … | grep -q`, a 401 fell through to the publish and only
# failed there, one step later and with the registry's message instead of the
# actionable one. `set -o pipefail` cannot separate them either.
#
# exit 0 → versions on stdout (empty for a first publish)
# exit 3 → the credential was refused (401/403)
# exit 4 → any other unexpected status
read_published_versions() {
  local name="$1" body="$2" code
  code="$(curl -sS -o "$body" -w '%{http_code}' \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    "$(packument_url "$name")")"
  case "$code" in
    200)
      bun -e "
        const doc = await Bun.file('$body').json();
        for (const version of Object.keys(doc.versions ?? {})) console.log(version);
      "
      return 0
      ;;
    404) return 0 ;;
    401|403)
      echo "::error::GitHub Packages refused the credential for $name (HTTP $code). The token needs 'packages: write' on this repository, and GitHub Packages accepts GITHUB_TOKEN only for a package associated with the repository that publishes it." >&2
      return 3
      ;;
    *)
      echo "::error::GitHub Packages answered HTTP $code for $name: $(head -c 400 "$body")" >&2
      return 4
      ;;
  esac
}

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

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

  # GitHub Packages requires a lowercase scoped name. Checked here rather than
  # left to the registry, whose refusal names the name but not the reason.
  case "$name" in
    @*/*) : ;;
    *)
      echo "::error::$name is not a scoped name; GitHub Packages only accepts @NAMESPACE/PACKAGE"
      exit 1
      ;;
  esac
  if [ "$name" != "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "::error::$name must be lowercase; GitHub Packages rejects uppercase package names"
    exit 1
  fi

  # The status is checked BEFORE the list is trusted: a refusal must stop the
  # run, never read as "nothing published yet".
  versions="$(read_published_versions "$name" "$body")" || {
    echo "::error::could not read the published versions of $name; refusing to publish" >&2
    exit 1
  }
  if grep -qxF "$version" <<< "$versions"; then
    echo "skip: $name@$version is already on GitHub Packages"
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run: would publish $name@$version to $REGISTRY"
    continue
  fi

  echo "publishing $name@$version to $REGISTRY"
  # `--access public` is harmless where the registry ignores it: GitHub Packages
  # decides visibility per package in the repository settings, and defaults a
  # first publish to private.
  #
  # The output is CAPTURED so a 403 can be explained rather than echoed. GitHub
  # Packages answers a first publish with `403 … The requested installation does
  # not exist` / `permission_denied: create_package`, which names neither the
  # cause nor the fix — and the two causes are not the same repair:
  #
  #   - the token is a PAT that cannot create a package in this org, or
  #   - the repository is not linked, because the `repository` field does not
  #     match, so the token has no package to write to.
  #
  # `GITHUB_TOKEN` covers both only when the workflow repository is the one the
  # package is associated with — which is why `GH_PACKAGES_TOKEN` exists.
  if ! output="$(cd "$dir" && NPM_CONFIG_TOKEN="$GITHUB_TOKEN" bun publish --registry="$REGISTRY" --access public 2>&1)"; then
    printf '%s\n' "$output" >&2
    if grep -qE '403|permission_denied' <<< "$output"; then
      echo "::error::GitHub Packages refused the publish of $name@$version. Two causes, and they need different fixes: (1) the credential cannot create a package in this namespace — a GITHUB_TOKEN can only publish to a package associated with THIS repository, so set a PAT (classic) with 'write:packages' as the GH_PACKAGES_TOKEN secret; (2) the package is not associated with this repository — each package.json must carry a 'repository' field naming it (docs: working-with-the-npm-registry#publishing-a-package)." >&2
    else
      echo "::error::failed to publish $name@$version to GitHub Packages — stopping, later packages depend on it" >&2
    fi
    exit 1
  fi
  printf '%s\n' "$output" | tail -3
  echo "published $name@$version"
done
