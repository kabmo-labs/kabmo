# Workspace packages

`packages/` holds 31 npm packages. The rule is deliberately simple: **one prefix,
one package.** A module that shares a prefix belongs in that package as a
subpath, not in a new manifest.

`@kabmo-labs/kabmo-sdk` and `@kabmo-labs/kabmo-ui` are the only packages a panel
plugin imports. The other 29 are the runtime the app is assembled from; they are
published with exact pins, but they are not a plugin API.

## Families

A family package keeps every former package as a subpath, so an import is stable
and a server-only module stays server-only.

| Package | Former prefixes | Subpath example |
|---|---|---|
| `@kabmo-labs/kabmo-omp` | `kabmo-omp-*` (38) | `@kabmo-labs/kabmo-omp/session-reader` |
| `@kabmo-labs/kabmo-harness` | `kabmo-harness-*` (23) | `@kabmo-labs/kabmo-harness/catalog` |
| `@kabmo-labs/kabmo-acp` | `kabmo-acp-*` (10) | `@kabmo-labs/kabmo-acp/protocol/v2` |
| `@kabmo-labs/kabmo-fs` | `kabmo-fs-*` (5) | `@kabmo-labs/kabmo-fs/media` |
| `@kabmo-labs/kabmo-chat` | `kabmo-chat-*` (4) | `@kabmo-labs/kabmo-chat/tool` |
| `@kabmo-labs/kabmo-session` | `kabmo-session-*` (4) | `@kabmo-labs/kabmo-session/lifecycle` |
| `@kabmo-labs/kabmo-git` | `kabmo-git-*` (2) | `@kabmo-labs/kabmo-git/runner` |
| `@kabmo-labs/kabmo-process` | `kabmo-process-*` (2) | `@kabmo-labs/kabmo-process/probe` |
| `@kabmo-labs/kabmo-settings` | `kabmo-settings-*` (2) | `@kabmo-labs/kabmo-settings/store` |
| `@kabmo-labs/kabmo-workspace` | `kabmo-workspace-*` (2) | `@kabmo-labs/kabmo-workspace/root` |
| `@kabmo-labs/kabmo-worktree` | `kabmo-worktree-*` (2) | `@kabmo-labs/kabmo-worktree/topology` |

The 20 singleton packages keep their own names: `kabmo-app-contracts`,
`kabmo-auth`, `kabmo-bytes`, `kabmo-db`, `kabmo-format`, `kabmo-guards`,
`kabmo-http`, `kabmo-idle-reaper`, `kabmo-live-sessions`, `kabmo-mcp-contracts`,
`kabmo-model-contracts`, `kabmo-paths`, `kabmo-platform`,
`kabmo-provider-contracts`, `kabmo-realtime-signals`, `kabmo-refresh-cadence`,
`kabmo-rpc-lines`, `kabmo-runtime-flags`, `kabmo-sdk`, `kabmo-ui`.

## Import shape

The former package name becomes a subpath of its family. The former subpath is
appended unchanged.

```ts
// before
import { readSession } from '@kabmo-labs/kabmo-omp-session-reader';
import { ACP_ERROR } from '@kabmo-labs/kabmo-acp-protocol/v2';

// after
import { readSession } from '@kabmo-labs/kabmo-omp/session-reader';
import { ACP_ERROR } from '@kabmo-labs/kabmo-acp/protocol/v2';
```

Each package's `exports` map is generated from the manifests the merge replaced:
the former root export is `./<folder>`, and every former subpath is
`./<folder>/<subpath>`. There is no catch-all wildcard, so a file that was
private inside a package stays private.

`tsconfig.json` mirrors the same map, plus one wildcard per package for editor
resolution. `tsconfig.consumer.json` keeps its browser-safe subset by listing the
former package folders, not whole mixed packages.

## Adding a package

Create a package only when one of these is true:

1. it is a new **prefix family** (a new domain), or
2. it is a contract with a consumer that must not install the whole family.

Otherwise add a file and an `exports` subpath to the family. A manifest per file
is the thing this layout exists to prevent.

## Release

All 31 packages are in `release/packages.js`; their tag prefixes are the package
names (`kabmo-omp/v0.1.0`). The family packages are mutually dependent (ACP, OMP,
harness, chat, and session import each other), so catalog order is no longer a
topological order. `publish-plugin-packages.sh` still publishes in catalog order
and still stops on the first failure; exact `workspace:` pins are substituted
from `bun.lock` at pack time.

See [Releases and workflows](https://github.com/kabmo-labs/kabmo/wiki/Releases-and-Workflows)
for the pipeline and `release/packages.js` for the catalog.
