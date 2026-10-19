# Cross-platform UI end-to-end testing

Regression prevention for feature work and fixes. The Kabmo today has one test
layer — in-process `bun test` (416 files, ~71.5k lines) — and every bug that
reached a user in the last cycle was a UI-level one the layer cannot see: a
panel that stayed mounted with stale width, a stream indicator that died at
450 ms, a toolbar whose action strip was clipped at 296px, a wiki link that
opened a browser tab instead of navigating. None of those are visible to a
happy-dom mount, because none of them are about the component tree — they are
about a real browser, a real listener, and a real omp child.

Status: **shipped (P0–P4)**. See the Status section at the end for what landed
and what P5 still owes.

## Reference research

Both repositories named as references were read at their current `main`.

### openchamber (`openchamber/openchamber`)

- **No browser automation.** Its dependency tree contains no Playwright,
  Puppeteer, WebdriverIO or Cypress. The only `playwright`/`puppeteer` hits in
  the whole repository are two file-type SVG icons in the editor's icon set.
- Its testing is `vitest` + `supertest` + `happy-dom`, per package, run by
  `node scripts/run-isolated-tests.mjs` and `bun run --cwd packages/* test`.
  `packages/web/vitest.config.ts` is notable for one trick: an alias that maps
  `bun:test` to `packages/web/test/bun-test-shim.ts`, so test files written
  against Bun's runner can also execute under Vitest. `maxWorkers` is clamped
  to `min(4, availableParallelism() - 1)` because loopback sockets and real
  `git` subprocesses fail at random when every core is saturated.
- Its E2E-shaped CI is not browser E2E: `mobile-ci.yml` builds an Android APK
  and an iOS simulator app (smoke build only), `opencode-smoke.yml` runs the
  agent CLI headlessly with a fixed prompt, `oc-integration.yml` is the bot.

**Takeaway:** openchamber confirms the layer split (unit vs integration vs
platform smoke) but offers no browser-E2E pattern to copy.

### get-bb/bb (`get-bb/bb`)

This one is the useful reference. It has two layers above unit tests.

- `tests/integration/` — Vitest workspace config with a real server on a fixed
  port (`BB_SERVER_PORT=49161`), a `global-setup.ts` that sweeps stale
  `/tmp/bb-integration-*` roots by reading `parent.pid` and killing the process
  that still holds files open, and `helpers/` split by concern: `harness.ts`
  (boot the server + host daemon), `api.ts` (a typed client), `assertions.ts`
  (`waitForThreadStatus`), `fixtures.ts` (create project/thread), `seed.ts`,
  `time.ts`.
- `tests/scripted-echo-provider/` — **the keystone**: a fake provider that is
  the *real* echo example bridge plus prompt directives. `delay:<ms>` holds a
  turn open, `approve:<command|file_change|…>` raises an approval, `ask_user`
  raises a question, `call_tool:<name>` invokes a tool, `bg_task` opens work
  that outlives the turn; anything else answers `Response to: <prompt>`. The
  integration suite drives the production adapter and delta assembler against
  it, so there is no test-only code path in the runtime. `SCRIPTED_ECHO_OPTIONS`
  (env JSON) scripts process-level behaviour that must apply before any session
  exists, and `SCRIPTED_ECHO_RECORD_PATH` appends every handled request to a
  JSONL file for assertions on what actually reached the provider.
- `tests/integration/mobile-e2e/backend.ts` — a **seeded demo backend for UI
  flows**: it boots the integration harness, creates a project and four threads
  (one idle, one completed, one "rich" carrying a long markdown message, a
  tool call, an approval and a pending question, one "rows"), optionally serves
  the built web app, and prints one JSON line with the ids when seeding is
  done. That line is the readiness signal the Maestro flows and the CI job wait
  on. It warns loudly when it binds `0.0.0.0`, because the harness is
  unauthenticated and executes commands as the user.
- `.github/workflows/mobile-e2e.yml` — the expensive layer is **label-gated**
  (`mobile-e2e`), plus nightly cron and manual dispatch; a cheap Linux job in
  `ci.yml` still typechecks/lints/unit-tests the same package on every PR.
  Maestro is pinned by version **and** by sha256 of its release asset, with a
  comment on how to recompute it.

**Takeaway:** bb's browser-layer analogue is exactly what kabmo is missing
— a scripted fake agent that makes turns deterministic without a model, a
seeded backend the UI can be pointed at, and a readiness contract the runner
waits on. bb itself has no browser automation (Maestro is mobile-only), so the
browser half is ours to add.

## What kabmo already has to build on

Everything below was read from this tree, not assumed.

- **The server is a single process and takes its whole configuration from the
  environment**: `PORT`, `HOST`, `KABMO_DATA_DIR`, `KABMO_DB_PATH`,
  `KABMO_OMP_BIN`, `MOCK`, `PI_CODING_AGENT_DIR`. `MOCK=true` boots
  without an `omp` install at all (`ompStartupError` returns null), and the
  boot banner prints `listening on http://<host>:<port>`.
  Verified: `MOCK=true KABMO_DATA_DIR=<tmp> PORT=39177 bun run
  src/server/index.ts --kabmo-server` answered `{"ok":true,…,"mock":true}`
  on `/api/health` and `200` on `/`.
- **`KABMO_OMP_BIN` is already the fake-binary seam.** Five suites use it
  today, and `registry.server.test.ts` ships a 20-line NDJSON stub that speaks
  `ready` + `response` frames. The seam exists; it has never been driven from a
  browser.
- **A full MOCK streaming path already exists end to end**: `POST /api/chat/stream`
  → `handleSimulatedStreaming` emits `thinking_start`, tool calls, chunked
  tokens and a final message; the client's `send.ts` falls into it whenever the
  session is not an omp session. So a chat round-trip is testable with no `omp`
  at all.
- **`MOCK=true` seeds demo folders and sessions** (`db/seed.ts`: folders
  `Chats`/`Workspace`/`drrealhandler`, named sessions, sample transcripts), and
  the `MOCK` topic resolvers answer deterministic datasets for todos, plugins,
  usage and the virtual-device panels.
- **Playwright runs on Bun.** Verified: a throwaway `bun test` importing
  `playwright-core` passes. `playwright` itself is untested here yet.
- **A Chromium is already on this machine** that omp installed for its own
  browser tool: `~/.omp/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google
  Chrome for Testing.app`. Reusing it avoids a second ~150 MB download per
  platform, at the cost of coupling to omp's install — see Decision D4.
- **Selector affordance is thin.** Measured: **zero** `data-testid` attributes
  in `src/`; 210 `aria-label` attributes across 99 files. Toolbars deliberately
  carry both `title` and `aria-label` on every icon-only button (AGENTS.md), so
  role + accessible-name selectors are viable for the surfaces that matter, and
  the rest needs a small contract.

## Decisions

**D1 — Playwright, not Maestro/Puppeteer/WebDriver.** The target is a *web
console*: the same document renders on macOS, Linux, Windows, desktop and
phone. Playwright drives Chromium, Firefox and WebKit from one API, ships the
trace viewer / screenshots / video that CONTRIBUTING.md §2 already demands as
PR evidence, and runs under Bun (verified for `playwright-core`). Maestro is
mobile-only; Puppeteer is Chromium-only and has no built-in runner, tracing or
assertion layer.

**D2 — The E2E runner is Playwright's own, in `tests/e2e/`, not `bun test`.**
`bun test` runs every file it finds in one process and shares
`globalThis` (that is why `isolateDb` exists and why `mock.module` broke six
suites). Browser specs need a per-file browser context, a per-file server, and
a trace artifact — a lifecycle Playwright's runner already owns. Keeping them
out of `src/` also keeps them out of the 350-line ceiling gate, which scans
`src/` only.

**D3 — The fake `omp` is the keystone, and it is a real protocol client, not a
mock.** A `tests/e2e/fixtures/fake-omp.ts` (`#!/usr/bin/env bun`) that honors
`--mode rpc-ui --cwd <dir>` and speaks the documented NDJSON surface: a `ready`
frame, `response` frames for `get_state` / `get_available_models` /
`get_available_commands` / `set_event_filter` / `set_ask_dialog`, and the event
frames a turn produces (`agent_start`, `message_start`, `message_update` in
**full** mode — the child is configured with `messageUpdates:"full"`, so the
fake re-sends the accumulated message on each frame, exactly as omp does —
`message_end`, `tool_execution_start/update/end`, `turn_end`, `agent_end`).
Prompt directives mirror bb's scripted-echo-provider: `delay:<ms>`,
`tool:<name>`, `ask:<text>`, `error:<text>`, `retry:<n>`, and a default of
answering the prompt. Rationale: Kabmo's own code under test is the
transport, the fold, the overlay store and the renderer — a fake that bypasses
them tests nothing. This is the same argument AGENTS.md makes for
`realtime-server.ts` ("stubbing `WebSocket` would test the fake's frame timing
rather than the delivery contract").

**D4 — Bundle Playwright's own Chromium; do not depend on omp's install.** The
Chrome for Testing in `~/.omp/puppeteer` is a side effect of an unrelated tool
and is absent on a fresh CI runner and on any machine without the browser
feature used. `bunx playwright install chromium` (cached in CI) is the boring,
self-contained option. An env override (`E2E_CHROMIUM_PATH`) may point at
omp's build for a local run.

**D5 — Two modes, chosen per spec, both deterministic.** Pure-UI specs run the
server with `MOCK=true` and never spawn a child (fast, no fake needed).
Agent-behaviour specs run with `MOCK=false` and `KABMO_OMP_BIN=<fake>`,
so a real session lifecycle, a real child, real frames and the real fold are
exercised — with no model, no network and no token spend. A spec declares which
mode it needs in its fixture, and the server is started per mode.

**D6 — Isolation is not optional, and one gap must be fixed first.**
`getDatabasePath()` returns `path.join(process.cwd(), 'workspace.db')` in MOCK
mode, **ignoring `KABMO_DB_PATH`** — verified: the probe boot above wrote
to the repository's own `workspace.db`. A test that boots a MOCK server from
the repo root therefore touches a real database. Fix: honor `KABMO_DB_PATH`
in mock mode too (it is a one-branch change in `db.server.ts`), and have the
harness set it, plus `KABMO_DATA_DIR` and `PI_CODING_AGENT_DIR`, into a
per-run temp root that is removed on teardown. This is the same class of bug
`isolateDb` documents for the unit layer, one level up.

**D7 — Selectors are a contract, kept small and reviewed.** Preference order:
(1) role + accessible name (`getByRole('button', { name: 'Save' })`), which the
toolbars already satisfy; (2) visible text for content assertions; (3)
`data-testid` **only** where no stable accessible name exists — a container
that must be located to scope a query, a virtualized row, an xterm canvas.
Testids are added as part of a flow, never speculatively, and they are stable
names (`session-item`, `chat-timeline`, `composer-input`) rather than
implementation detail.

**D8 — CI gates stay where they are; browser E2E is a separate job.** The four
existing gates (`lint`, unused-check, 350-line ceiling, build) and `bun test`
keep running on every PR unchanged. Browser E2E is
`.github/workflows/e2e.yml`: on **every push to `main`**, on a PR only with the
`e2e` label, plus nightly cron and manual dispatch. A browser job is minutes not
seconds, so the label is the cheap-PR escape hatch — but `main` is a merge and
gets the full run, the same as the other gates. Linux (ubuntu-latest, Chromium)
is the required leg; a macOS leg is opt-in, since the app is developed on darwin
and one platform would otherwise hide a webkit/safari-only regression.

Both of those are now REUSABLE workflows (`gates.yml`, `e2e-specs.yml`) that
`ci.yml` and `e2e.yml` call as triggers, and that `release.yml`, `publish.yml`
and `publish-plugins.yml` call and `needs:` — so a release cannot be tagged or
published until the gates and the browser specs have passed on the commit being
released. The label condition stays on `e2e.yml`'s own job, because it is a
property of the pull-request trigger: a release always runs the browser layer,
which is the point (a merge whose PR never carried the label was never
browser-verified). `tests/ci-gates.test.ts` asserts the graph, so a new publish
job that forgets its `needs` fails a test instead of shipping.

## Architecture

Three layers, each with one job:

| Layer | Runner | Server | Child | Catches |
|---|---|---|---|---|
| L1 unit / component | `bun test` | none | none | logic, parsers, folds, component markup |
| L2 integration | `bun test` | in-process Elysia | fake omp | route contracts, realtime topics, real WS |
| L3 browser E2E | Playwright | real subprocess | fake omp or none | rendering, layout, streaming UX, cross-browser |

L2 largely exists (`realtime-server.ts`, `peer-harness.ts`, route suites) and
needs no new infrastructure. This plan is about L3, with one L2 addition: the
fake omp is shared by both.

### Directory layout

```
tests/e2e/
  playwright.config.ts        # projects: chromium (required), firefox/webkit/mobile (opt-in)
  fixtures/
    fake-omp.ts               # #!/usr/bin/env bun — the scripted omp RPC child
    server.ts                 # spawn/health/teardown of the real server, temp root
    app.ts                    # Playwright fixture: baseURL, context, page, trace
    selectors.ts              # the D7 contract, one place
    seed.ts                   # create folders/sessions/state through the API
  specs/
    shell.spec.ts             # boots, renders the app shell, no console errors
    chat.spec.ts              # send a prompt, stream renders, footer settles
    sidebar.spec.ts           # sessions listed, select, switch session
    panels.spec.ts            # right-panel switch, persisted per session
    editor.spec.ts            # open a file, edit, save status
    terminal.spec.ts          # PTY opens, echoes, key bar on a touch viewport
    settings.spec.ts          # open settings, change a setting, it persists
    mobile.spec.ts            # phone viewport: composer, drawers, key bar
    theme.spec.ts             # theme switch reaches mermaid + editor
```

### The harness (`fixtures/server.ts`)

1. `mkdtemp` a run root; write a fake `omp` shim that execs `fake-omp.ts`
   (so `KABMO_OMP_BIN` is an executable path, not a `.ts`).
2. Spawn `bun run src/server/index.ts --kabmo-server` with
   `cwd = <repo root>`, `PORT = <free port>`, `HOST=127.0.0.1`,
   `MOCK` per the spec's mode, `KABMO_DATA_DIR`/`KABMO_DB_PATH`/
   `PI_CODING_AGENT_DIR` under the run root, and `KABMO_OMP_BIN` pointing
   at the shim (real-mode specs only).
3. Wait for readiness by **polling `GET /api/health`** until `ok:true` and the
   port matches — the same shape bb waits on, minus its log-line parsing,
   because Kabmo has a health route. Fail fast if the child exits.
4. Capture stdout/stderr into the run root; attach the tail to a failing spec.
5. Teardown: `SIGTERM` the process group, wait, `SIGKILL` after a grace period,
   remove the run root. Stale-run sweeping (bb's `global-setup`) is a follow-up,
   not phase 1 — a leaked temp dir costs disk, not correctness.

### The fake omp (`fixtures/fake-omp.ts`)

- Reads argv for `--mode rpc-ui`, `--cwd`, `--resume`, `--no-session`,
  `--no-lsp`, `--approval-mode`; ignores what it does not model, so the real
  argv Kabmo builds is what the fake receives (no test-only argv path).
- Emits `{"type":"ready","protocolVersion":1}` on stdout first, then serves
  commands by `type` with the documented `{type:'response', id, command,
  success, data}` envelope.
- `get_state` returns a session id, a file path under the temp agent dir, a
  model with `thinking.efforts`, `messageCount`, `isStreaming`, and
  `isSettled` — the field `run-settle.server.ts` reads, so the settle path is
  testable.
- `prompt` runs the directive script: `delay:` holds, `tool:` emits a
  `tool_execution_*` triple, `ask:` emits `extension_ui_request` and waits for
  the reply, `error:` emits an error frame, `retry:` emits
  `auto_retry_start`/`end`; the default streams a few `message_update` **delta**
  fragments then `message_end` + `turn_end` + `agent_end`.
- Honours `set_event_filter` (so a spec can assert both the delta path and the
  accumulated path), `set_ask_dialog`, `set_subagent_subscription` (answering
  `Unknown command` is also a case worth pinning, since Kabmo treats it
  as best-effort).
- Optional `FAKE_OMP_RECORD_PATH`: append every received frame as JSONL, so a
  spec can assert what Kabmo *sent* (bb's `SCRIPTED_ECHO_RECORD_PATH`
  idea — it is the only way to test "the reload reached the child" without
  reading the child's mind).

### Determinism rules

- **No real model, ever.** Every spec either uses MOCK streaming or the fake
  child. A spec that would need a provider is out of scope.
- **No sleeps as assertions.** Wait on a condition: a locator becoming visible,
  a stream frame observed via `page.evaluate` on the realtime socket, or a
  route response. The fake's `delay:` exists so a "still streaming" assertion
  has a stable window, not so the test can sleep.
- **No shared state between specs.** One run root, one server, one browser
  context per spec file (Playwright's default isolation), one temp DB.
- **Animations off** (`reducedMotion: 'reduce'`), except in the specs that
  specifically test motion.

## Phases

| Phase | Deliverable | Gate |
|---|---|---|
| P0 | `KABMO_DB_PATH` honored in MOCK mode; temp-root harness; `playwright.config.ts`; `shell.spec.ts` green | the server boots from a temp root and `/` renders the app shell with no console error |
| P1 | `fake-omp.ts` + `chat.spec.ts` (real mode): send a prompt, watch the delta stream render, the run footer settle | a full turn renders from frames Kabmo folded, with no model |
| P2 | Sidebar, panels, settings, theme specs; the `data-testid` contract where roles are not enough | a session switch restores that session's layout; a theme switch repaints |
| P3 | Mobile viewport spec (composer, drawers, key bar), editor spec, terminal spec | a phone viewport can send a message and open the terminal |
| P4 | `e2e.yml` (push to `main` + label + nightly), trace/screenshot artifacts uploaded on failure | the job is green on a clean runner and its artifacts are readable |
| P5 | Cross-browser legs (firefox/webkit) behind a label; a macOS leg | a webkit-only regression is caught before merge |

Each phase lands green before the next starts, and P0/P1 are the ones worth
doing first — they are what make the rest cheap.

## Resolved decisions

The three questions this plan opened were settled by building P0–P4, and the
answers are recorded here so the plan and the code agree.

1. **Chromium source: Playwright's own, bundled.** `bunx playwright install
   chromium` in the CI job, cached on `hashFiles('bun.lock')`. omp's
   `~/.omp/puppeteer` build is a side effect of an unrelated tool and is absent
   on a fresh runner, so depending on it would make the layer pass locally and
   fail in CI — the worst of both. There is no `E2E_CHROMIUM_PATH` override:
   nothing needed one.
2. **Fake directives ride the PROMPT TEXT.** `delay:`, `tool:`, `ask:`,
   `error:`, `retry:`, `slow` are parsed out of the message the spec types, so
   the directive and the assertion sit in the same place and a reader can see
   what a turn does without a second config surface. A spawn-time env JSON is
   the escape hatch if a directive is ever needed BEFORE a session exists;
   nothing has needed one yet.
3. **`tests/e2e/**` stays outside the pr-review bot's `human-required` trust
   boundary.** It is test code, not policy, and the boundary list in
   `CONTRIBUTING.md` §3 is unchanged. The bot reviews a spec like any other
   source file.

## Status

**Shipped: P0–P4.** 23 specs across 7 files (20 desktop + 3 mobile), green
repeatedly, plus the DB-isolation fix and its regression test. `e2e.yml` runs on
every push to `main` like the other gates, on a pull request only when the `e2e`
label is applied, and nightly. P5 (firefox / webkit / a macOS leg) has its
projects declared in the config but no CI job: the legs are opt-in via
`--project`, and turning them on is a follow-up that should wait for a measured
need rather than being wired speculatively.

P5 was attempted and is blocked on the environment, not on the layer: on this
machine `bunx playwright install firefox` succeeds but every firefox spec fails
at launch with `Could not find profile folder` (the Nightly build exits 1 under
`-headless -profile <tmp>`). That is a sandbox limitation, so the leg cannot be
verified here — and an unverified leg must not be wired into CI. Chromium is the
required leg and it is green; firefox/webkit stay opt-in until someone can run
them where the browser launches.

The layers, as they stand:

| Layer | Runner | Server | Child | Catches |
|---|---|---|---|---|
| L1 unit / component | `bun test` | none | none | logic, parsers, folds, component markup |
| L2 integration | `bun test` | in-process Elysia | fake omp | route contracts, realtime topics, real WS |
| L3 browser E2E | Playwright | real subprocess | fake omp or none | rendering, layout, streaming UX, PTY |

## Non-goals

- **No E2E for omp itself.** The Kabmo's contract with `omp` is the wire
  protocol; a test that drives a real `omp` binary belongs to omp.
- **No visual-regression baseline.** Screenshots are attached as failure
  evidence; a pixel-diff suite needs its own stability work (fonts,
  antialiasing, animation) and is a separate decision.
- **No mobile-native runner.** The Kabmo has no native client; the phone
  surface is the same web app at a phone viewport, which Playwright's device
  emulation covers.
- **No load/performance testing.** The profile scripts in the reference repos
  measure a different question.
