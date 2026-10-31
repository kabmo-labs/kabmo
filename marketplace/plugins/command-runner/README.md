# Command Runner

A right-panel view that lists a repository's commands and runs them — in the
foreground or as background jobs, with their output shown live.

The activity-bar mark is a framed play button (Lucide's `square-play`): the panel
lists commands and runs one. It deliberately is NOT a shell prompt — that is the
`terminal` view's own glyph, and two buttons in one activity bar carrying the same
mark is what this replaced.

## What it lists

Grouped by the FILE each command comes from, because in a monorepo the file is
the command's identity. 26 filenames across 14 toolchains, plus the group you add
to yourself:

| Source | What is listed | Row runs |
|---|---|---|
| `package.json` | every key of `scripts` | the RESOLVED runner (`bun run dev`, `npm run dev`) |
| `deno.jsonc` / `deno.json` | every key of `tasks` | `deno task <name>` |
| `Makefile` / `makefile` / `GNUmakefile` | targets (`.PHONY` and other dot-targets are not commands; a pattern rule is not either) | `make <name>` |
| `justfile` / `Justfile` / `.justfile` | recipes | `just <name>` |
| `Taskfile.yml` / `.yaml` | every key of `tasks` | `task <name>` |
| `pyproject.toml` | `[tool.poe.tasks]`, `[tool.pdm.scripts]`, `[tool.taskipy.tasks]`, `[tool.hatch.envs.*.scripts]` — each with its own runner | `poe <name>`, `pdm run <name>`, `task <name>`, `hatch run <name>` |
| `Pipfile` | `[scripts]` | `pipenv run <name>` |
| `manage.py` | Django's own verbs | `python manage.py <verb>` |
| `docker-compose.yml` / `.yaml` / `compose.yml` / `.yaml` | two rows per SERVICE (`up`, `logs -f`) | `docker compose up <svc>` |
| `go.mod` | the `cmd/<name>` packages beside it | `go run ./cmd/<name>` |
| `Cargo.toml` | cargo's verbs + every `[[bin]]` | `cargo build`, `cargo run --bin <name>` |
| `.cargo/config.toml` | `[alias]` — a project's own command names | `cargo <alias>` |
| `composer.json` | `scripts`, plus Laravel's verbs when `artisan` sits beside it | `composer run-script <name>` |
| `artisan` | Laravel's verbs | `php artisan <verb>` |
| `build.gradle` / `.kts` | Gradle's verbs + any `task <name>` declared in the file | `./gradlew <task>` when a wrapper is committed |
| `pom.xml` | Maven's verbs | `./mvnw <goal>` when a wrapper is committed |
| `mix.exs` | the project's own `aliases` | `mix <alias>` |
| **your own commands** | a group you add to from the panel — see below | the text you saved |

### Three answers to "where are the commands"

The differences are why each source is its own detector rather than one generic
"look for a build file":

1. **Declared in the file** — `scripts`, `tasks`, targets, recipes, `[alias]`,
   `aliases`. Read directly.
2. **Declared only at runtime** — cargo, `go`, `artisan`, `manage.py` and Gradle
   have no task file, and their command lists are knowable only by RUNNING them.
   The stable, universal verbs are listed instead, and each row's label says
   exactly what will run. Deliberately short: a curated list that is wrong is
   worse than a short one.
3. **Found beside the file** — `go.mod`'s commands are the `cmd/<name>`
   directories next to it, Laravel is recognised by the `artisan` beside a
   `composer.json`, and the Gradle/Maven wrapper is preferred over whatever is on
   `PATH` because a committed wrapper pins the version the build was written for.

`[project.scripts]` in `pyproject.toml` is deliberately NOT read: those are
console-script entry points, installed into an environment, so a row would fail
until the package was installed first.

The walk is bounded (depth 4, 200 files) and never descends into `node_modules`,
`.git`, `dist`, `build`, `out`, `.next`, `coverage`, `target` or `vendor`. Hitting
a cap is REPORTED in the panel rather than silently shortening the list.

## Your own commands

Above the file groups sits **`Custom commands`**, always present — even in a
repository with no command file at all, because its header is where the `+` that
adds one lives.

A custom command is arbitrary text (`bun run build -- --watch`, `make deploy
ENV=staging`, `git push && gh pr create`) run through `sh -c`, so pipes, `&&` and
variables work. It is the ONE place this plugin involves a shell, and the rule
that keeps it safe is about **who supplies the text**: `start` still takes an ID,
and the text is read back out of your own storage server-side. There is no method
that accepts a command line, so a page cannot run a string it invented — only
something you already saved.

Each entry carries two choices:

| Field | What it decides |
|---|---|
| **Available in** | `This workspace` (only under the repo you created it in) or `Every workspace` (offered everywhere) |
| **Directory** | the cwd, RELATIVE to the workspace root. `.` is the root. A script in a monorepo only resolves in its own directory |

A stored command's row gains **`✎` edit** and **`🗑` delete**, revealed on hover
and always shown on a touch device. Edit opens the dialog seeded with the entry;
delete asks first, because a stored command exists nowhere else — there is no
file and no git history to restore it from.

Where they live: the plugin's own record storage (`plugin_records`, namespaced by
the host to this plugin's id), keyed `<scope>:<slug>`. A global command and a
repo-scoped one with the same name are two entries; editing the text MOVES the
row (the slug is part of the key), and the old one is removed as it moves.

## The package runner is resolved, and shown

For a `package.json`, the runner is decided in this order:

1. the file's own `packageManager` field (`bun@1.4.2` → `bun`);
2. the nearest lockfile, walking up to the repo root — `bun.lock`/`bun.lockb`,
   `package-lock.json`/`npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`;
3. `bun`.

The resolved runner appears on the row (`bun run dev` vs `npm run build`), so the
guess is visible rather than implied.

## Two collapsible levels: file, then command

```
▾ Custom commands                 1          [+]
  ▸ bun run build -- --watch      exit 0   [✎] [🗑] [⏱] [▶]
▾ package.json                    2
  ▸ bun run dev       exit 0      [≡] [⏱] [▶]
  ▾ bun run test      running     [≡] [⏱] [■]
    ┌────────────────────────────────────────┐
    │ running · 12s · 48 KB            Stop  │
    │  12 pass · 0 fail                       │
    └────────────────────────────────────────┘
▸ Makefile                        2
```

The custom group's header is **not** a disclosure: the `+` lives in it, and a
button inside a button is invalid HTML whose inner click never fires.

A **group header** is one command FILE — it collapses its rows, and carries the
count. Every group starts CLOSED, so the panel opens as a list of files; the
sketch above shows the ones the reader opened. A **row** is one command — it
collapses its own output. Both use the same reveal, and a collapsed body leaves
the tab order entirely (its rows cannot be reached with `Tab` or announced), so a
closed group is genuinely closed.

## Every command is a row that opens

A row is one line — the command, its last outcome, and four controls:

```
▸ bun run dev            exit 0   [≡] [⏱] [▶]
```

- **`▸` / `▾`** — the disclosure. It opens that command's own output underneath
  it, and the reveal is Kabmo's standard one (`grid-template-rows: 0fr → 1fr`),
  so the body rises rather than the list jumping.
- **`[⏱]` background** — track this command as a job. On, the run is also listed
  under `Running` with a Stop button and its elapsed time, which is the shape of
  `bun run dev`. Turning it OFF stops the command's runs.
- **`[▶]` run / `[■]` stop** — run it once. The glyph becomes a square while the
  run is live, so one control says which of the two things a click will do.

**The disclosure is disabled until the command has run.** There is nothing to
expand before that, and a toggle that opens onto a placeholder teaches the reader
the control is unreliable; the row says `has not run yet` instead. Once a run
exists the row opens ITSELF, so a Run never looks like it did nothing.

There is no output toggle: expanding the row is what shows the output, so a
second control for the same thing was one decision with two controls. The
background toggle is the only one left, because how a run is *tracked* is a real
choice — it is per command and persisted per session.

## Reading the output

The type is a three-step hierarchy, and the sizes are load-bearing:

| Level | Size | Weight |
|---|---|---|
| Group (`package.json`) | 12px | 600 — the heading of the list |
| Command (`bun run speak`) | 11px | 400 — one item in it |
| Log | 10px | 400 — that item's OUTPUT |

The log must never out-weigh the command that names it, so it sits one step
BELOW the label rather than at the code-block default (`text-xs`, which was a
full step larger). The line box is a ratio of the size, so a wrapped log line
stays readable at any zoom.

The header of an expansion names the outcome and what is NOT shown. A killed run
reads `stopped (SIGTERM)` — never `exit 0`, which is what a null exit code would
look like. A build larger than the 256 KB buffer says `last 64 KB of 3.1 MB`
rather than presenting a window as the whole log.

## The repo picker

The panel header carries the same nested-repo picker the Files, Search, Source
Control and Terminal panels share. The selection is ONE value
(`workspace.activeRepo`) for all of them, so picking a repo here moves those
panels too — and vice versa.

## Switching repos stops everything

A repo switch force-stops every run of the session, background or not. That is
enforced by three mechanisms, because each alone has a hole:

1. **A content script** watches the shared scope for as long as the plugin is
   enabled — the panel itself is unmounted while another view is on screen, so a
   switch made from the Files panel would otherwise leave processes running with
   nothing to notice. The script renders nothing.
2. **The panel sweeps on mount**, which covers a reloaded Kabmo (no watcher has
   run yet) and a phone.
3. **Every run records its scope**, so a sweep kills runs started before a
   watcher existed.

`stop-others` is defined by the scope it is handed: it kills this session's runs
in any OTHER scope and leaves the current one alone. Calling it twice is a no-op,
which is why the watcher fires on every notification instead of tracking changes.

## What it does not do

- **No run history.** A restart forgets every run.
- **No run of an unsaved string.** A run is started by command ID: a file command
  is re-resolved against a fresh scan, a custom one against your own storage. So
  this is not a remote-shell endpoint, even though a custom command is free text.
- **No PTY.** These are pipes: a command expecting a terminal (a progress bar, an
  editor) behaves differently from the Terminal panel's shell. A custom command
  runs `sh -c <text>` under the same pipe, so it is not an exception.
- **No editing** of `package.json` / `Makefile` from the panel. Only a command you
  added yourself is editable here.
- **No runtime discovery.** Cargo, `go`, `artisan` and Gradle could each answer
  their real command list if the toolchain were run; the panel does not execute
  anything to build a LIST, so it shows their stable verbs instead (and a project's
  own names where the file states them, such as `[[bin]]`, `[alias]` and
  `mix.exs`'s aliases).

## Settings

| Setting | Default | What it does |
|---|---|---|
| Log tail (KB) | 64 | How much output one read returns. The server keeps the last 256 KB per run regardless. |
| Concurrent runs | 8 | A run beyond this is refused with a reason rather than queued. |
