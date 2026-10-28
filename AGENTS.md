# AGENTS.md — Kabmo agent contract

**Kabmo** is the browser console and diagnostic workbench for **Oh-My-Pi** (`omp`): a Preact client,
a Bun/Elysia server that speaks omp's RPC mode, and a panel-plugin platform.

This file is the short, binding contract. It is deliberately **not** the manual: the measured detail
for every subsystem — the bug each rule prevents, and how it was verified — lives in the
**[Kabmo wiki](https://github.com/kabmo-labs/kabmo/wiki)**. Read the page for the area you are about
to touch before you change it; the map is at the end of this file.

---

## 1. Runtime: Bun only

- **No Node.** The server imports `bun:sqlite` and resolves `@/`; tests run under `bun test`; the
  client is bundled by `Bun.build`. Never add a Node test runner, `tsx`/`ts-node`, or a `node:` import
  to `src/client/**` or `src/shared/lib/**` (they also run in the browser).
- **Toolchain: `bun`, `bunx`, `bun test`.** `npm`, `npx`, `yarn` and `pnpm` are never used —
  `bun.lock` is the only lockfile. Never commit another lockfile.
- **Bun APIs where they exist, `node:*` where they do not.** `Bun.spawn` over `child_process`,
  `Bun.file`/`Bun.write` over `fs.promises`, `Bun.Glob` over readdir loops. `node:path`, `node:os`,
  directory ops and `node:readline` stay — Bun has no equivalent, and `os.homedir()`/`os.tmpdir()`
  must never become `Bun.env.HOME`/`TMPDIR`. Details: [Runtime and toolchain](https://github.com/kabmo-labs/kabmo/wiki/Runtime-and-Toolchain).
- **A database-touching suite must isolate it** (`isolateDb`/`releaseDb`,
  `src/test-support/isolated-db.ts`) or it reads and writes the developer's real `~/.kabmo/db.sqlite`.
- **Process-wide state that owns a descriptor lives on `globalThis`**, because `bun --hot`
  re-evaluates a module while its handle lives on.

## 2. Verification gates (all mandatory)

```bash
bun run lint                                            # tsc --noEmit
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters  # no dead code
bun run build                                           # production bundle
bun test                                                # unit + route suites
bun run typecheck:e2e                                   # the Playwright specs
```

Plus, before declaring anything done:

- `find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | grep -v total | awk '$1>350'` prints
  **nothing**.
- No `TS6133`/`TS6192`/`TS6196`/`TS6198` left behind. Unused props, state, imports and call-site
  arguments are removed in the same change.
- Non-trivial work is **smoke-tested**: run the thing and observe the changed path. A unit test is
  not proof that the assembled product works.

## 3. Code organization (hard rules)

- **350 lines per file, hard ceiling.** Split before you cross it: sub-components in the feature's
  kebab-case folder, stateful logic into `src/client/hooks/<domain>/`, pure helpers into
  `src/shared/lib/<domain>/`.
- **Folders mirror component names in kebab-case**, entry file `index.tsx`. Child files drop the
  redundant prefix (`git-panel/TreeView.tsx`, never `GitTreeView.tsx`). No duplicate basenames in
  one folder.
- **Absolute imports only** (`@/…`). No `./` or `../` in `src/**`.
- **No re-export barrels** under `components/`, `hooks/` or `shared/lib/`; `index` is the folder's
  real implementation, never a list of `export … from`. The one barrel is `src/shared/types/index.ts`.
- **Preact directly** — `preact/hooks`, `preact/compat`. Zero React packages; never add a
  react→preact alias to accommodate a dependency.
- **Group by domain, never flat.** New modules go in the right `src/{client,server,shared}/{hooks,lib,data,types}/<domain>/`
  folder, and a move updates every importer in the same change.
- **Reuse the existing pattern** for the thing you are adding. A second convention for the same job
  is the defect, even when it works.

## 4. Boundaries and module shapes

- **Three-way split.** `src/server/**` is Bun-only, `src/client/**` is browser-only, `src/shared/**`
  is imported by both and therefore cannot touch `node:` or `bun:sqlite`.
- **Route modules keep the ported Remix shape**: an exported `loader` (GET) and/or `action`
  (mutating verbs), where `action` owns method dispatch and returns its own `405`. Routes are grouped
  by domain under `src/server/routes/`, one Elysia plugin per domain, mounted in `routes/index.ts`.
- **One parameter name per path position.** A static segment that shares a position with a parameter
  route is registered *before* it, explicitly (a parameter route winning the match answers 405 and
  hides the real problem).
- **Every right-panel view is a plugin**, built-in or installed, resolved through one catalog. A view
  cannot be a table in one layout and a fetch in another.
- **A fact is stated once.** Layout math, the panel order, header control order, the theme writer,
  the scrollbar reveal, the wordmark and every other shared fact has exactly one module; a second
  copy drifts silently and is how a layout looks right in one place and wrong in another.

## 5. UI and theming

- **Theme through the CSS variables** (`var(--theme-ink)`, `--theme-paper`, `--theme-error`, …) and
  the Tailwind classes mapped to them. Never hardcode hex in a component.
- **Every theme write goes through `applyDocumentTheme`** (`src/client/hooks/ui/theme.ts`): it sets
  `<html data-theme>` and dispatches `omp:theme-changed`. Writing the dataset directly leaves
  consumers that cannot read CSS (the mermaid hydrator) on the previous palette.
- **Chroma is reserved**: the only colour outside the palette is `var(--theme-error)`. Syntax
  highlighting is the explicit exception (Shiki's dual `--shiki-light`/`--shiki-dark` pair).
- **Both layouts are one product.** A control, dialog or piece of copy added to the desktop belongs
  to the phone too, unless the platform genuinely cannot do it — and then the shell says so in words.

## 6. Data, state and persistence

- **The database is a singleton on `globalThis`**; `KABMO_DB_PATH` is read only while that handle
  opens. Never open a second handle to "isolate" something at runtime.
- **Server-side state for anything that must survive a reload, a closed tab or a second instance**
  (queues, scheduled tasks, held prompts, plugin state). A client timer is not a durable schedule.
- **Per-session UI state goes in `session_ui_state`**, keyed by session id; the sidebar's width is the
  documented global exception.
- **Never substitute a failure.** A failed read is reported, a failed save says so, and a refusal
  names its reason. Silent fallbacks (`fallback` content, `success` for a no-op) are bugs.

## 7. Commits, changelog and releases

- **Conventional Commits, always.** The subject becomes the changelog bullet verbatim, so it names
  the behaviour that changed. Body explains why, never restates the diff.

  | Type | Use |
  |---|---|
  | `feat` | new user-visible behaviour |
  | `fix` | corrects behaviour that was wrong |
  | `refactor` | no external behaviour change |
  | `perf` | measurable performance win, behaviour unchanged |
  | `docs` | documentation only |
  | `test` | tests only |
  | `build` / `ci` / `chore` / `style` | toolchain, pipeline, maintenance, formatting |

- **`BREAKING CHANGE:` is uppercase and read case-sensitively**, and a `!` only releases a major on
  `feat`, `fix`, `perf` or `refactor`. The full rule table and the measured reasons live in
  [Releases and workflows](https://github.com/kabmo-labs/kabmo/wiki/Releases-and-Workflows).
- **NEVER edit `CHANGELOG.md` during normal work.** It is written by the release pipeline only.
- **Never write a skip marker** (`[skip ci]`, `[ci skip]`, `[no ci]`) into a message pushed to
  `main` — it silently skips the release run.
- **Commit only the files this task changed**, and do not commit at all until asked.

## 8. Working on a subsystem

1. Read the wiki page for the area (map below). Each rule there names the bug it prevents.
2. Find the single module that owns the fact you are about to change; do not add a second one.
3. Change the code **and** every call site, doc line and test that names it, in one change.
4. Run the gates in §2, then exercise the changed path for real.
5. If you learn something a future reader would otherwise re-break, it belongs in the wiki page —
   with the measurement, not just the conclusion. The wiki source is the `.wiki/` checkout at the
   repo root: its own git repository, gitignored by the app, pushed to
   `https://github.com/kabmo-labs/kabmo.wiki.git`.

## 9. Wiki map

| Page | Read it before touching |
|---|---|
| [Architecture](https://github.com/kabmo-labs/kabmo/wiki/Architecture) | anything — the tree and the invariants |
| [Runtime and toolchain](https://github.com/kabmo-labs/kabmo/wiki/Runtime-and-Toolchain) | build, CLI, a `node:`/Bun API choice |
| [App shell and layout](https://github.com/kabmo-labs/kabmo/wiki/App-Shell-and-Layout) | sidebar, headers, composer, editor, panel widths |
| [Chat stream and tools](https://github.com/kabmo-labs/kabmo/wiki/Chat-Stream-and-Tools) | timeline, transports, tool cards, injected entries, dictation |
| [omp engine and settings](https://github.com/kabmo-labs/kabmo/wiki/Omp-Engine-and-Settings) | settings schema, model roles, standby processes, self-update |
| [Plugins, skills and automation](https://github.com/kabmo-labs/kabmo/wiki/Plugins-Skills-and-Automation) | panel plugins, skills, BTW, schedules, held prompts, the PTY |
| [Desktop integration](https://github.com/kabmo-labs/kabmo/wiki/Desktop-Integration) | tray, login entry, OS document handling |
| [Workspace panels](https://github.com/kabmo-labs/kabmo/wiki/Workspace-Panels) | repo scope, source control, worktrees, search, the panel kit |
| [Providers](https://github.com/kabmo-labs/kabmo/wiki/Providers) | provider settings, models, dialects, usage, marks |
| [Tool panels](https://github.com/kabmo-labs/kabmo/wiki/Tool-Panels) | command runner, ask dialog, approval gate, todo, wiki |
| [Build, test and release internals](https://github.com/kabmo-labs/kabmo/wiki/Build-Test-and-Release) | dev loop, assets, fonts, E2E layer, route contract |
| [Releases and workflows](https://github.com/kabmo-labs/kabmo/wiki/Releases-and-Workflows) | commits, changelog, package and shell releases, the bot |
| [Codebase rules](https://github.com/kabmo-labs/kabmo/wiki/Codebase-Rules) | file layout, imports, verification, layout math |
| [Security](https://github.com/kabmo-labs/kabmo/wiki/Security) | auth, sessions, TLS, origin checks |
