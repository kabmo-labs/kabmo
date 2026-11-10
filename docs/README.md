# Kabmo docs

Two kinds of document live here, and the difference decides the filename.

- **[`milestones/`](milestones/)** — the record of one piece of work: what was measured, what
  was decided, what shipped, what did not. Numbered, ordered, and never renamed after the fact.
- **[`reference/`](reference/)** — a living contract that is read continuously and never
  "finishes": the plugin SDK and the built-in panel table.

[`assets/`](assets/) is the README's media (used by `README.md` and `scripts/readme-media.ts`); it
is not documentation and does not move.

## Milestones

| # | Milestone | What it delivered | Status |
|---|---|---|---|
| 01 | [Unified realtime transport](milestones/M01-realtime-transport.md) | one WebSocket per tab, per-topic subscriptions, polling and per-session SSE gone | done |
| 02 | [omp engine adoption](milestones/M02-omp-engine-adoption.md) | the RPC and settings audit from 18.8 through 18.10, and the schema it adopted | done |
| 03 | [Browser end-to-end testing](milestones/M03-e2e-testing.md) | the Playwright layer: temp-root harness, fake omp, a `data-testid` contract | partial |
| 04 | [Plugin platform](milestones/M04-plugin-platform.md) | a plugin's server half, keyed slots, storage, the test harness and the CLI | done |
| 05 | [Plugin platform, wave 2](milestones/M05-plugin-platform-wave2.md) | participant hooks (`useComposer`, `useRpc`, `useRealtime`) and four conversation slots | done |
| 06 | [Tool renderer audit](milestones/M06-tool-render-audit.md) | four tool-card defects measured at omp 18.10.3, and their fixes | done |
| 07 | [Stats plugin](milestones/M07-stats-plugin.md) | the CPU/RAM panel and the server-side sampler behind it | done |
| 08 | [Git panel](milestones/M08-git-panel.md) | merge and conflict resolution, branch rename, the branch manager, fetch and amend | done |
| 09 | [Command Runner plugin](milestones/M09-command-runner-plugin.md) | a repo's command sources as rows, run in the foreground or the background | done |
| 10 | [Packaging and shells](milestones/M10-packaging-and-shells.md) | five native shells released as artifacts; the bundled-server sidecar is not built | partial |
| 11 | [Worktree sessions](milestones/M11-worktree-sessions.md) | a chat born in its own git worktree, chosen before the first send | done |
| 12 | [CodeMirror 6 editor](milestones/M12-editor-codemirror6.md) | the hand-built code surface replaced end to end, diff view included | partial |
| 13 | [Shell transport and QR pairing](milestones/M13-shell-transport-and-qr.md) | the measured case for TLS trust and pairing between a shell and a server | planned |
| 14 | [Editor panel gaps](milestones/M14-editor-panel-gaps.md) | external-change guard, indentation, tab management, Save As, split editor | done |
| 15 | [Composer styles](milestones/M15-composer-styles.md) | five selectable composer styles, each with a desktop and a phone form | done |
| 16 | [Multi-harness research](milestones/M16-harnesses-research.md) | the measured ACP/RPC capability matrix for nine agent harnesses | done |
| 17 | [Multi-harness design](milestones/M17-harnesses-design.md) | one transport per harness: per-harness tabs, the sidebar mark, per-harness settings | done |
| 18 | [Centre terminal](milestones/M18-centre-terminal.md) | xterm versus Ghostty, measured, for a terminal beside the timeline | planned |
| 19 | [Threads, forks and orchestration](milestones/M19-threads-forks-orchestration.md) | a reference implementation measured, then the session tree, spawn, fork, child outcomes and the sidebar separation | done |
| 20 | [Cross-harness orchestration](milestones/M20-cross-harness-orchestration.md) | five references compared, then the shipped `@harness` mention grammar: default-model delegation, prompt contract, worker preamble | partial |
| 21 | [Terminal emulator migration](milestones/M21-terminal-ghostty-web-migration.md) | the right-panel terminal moved from xterm.js to ghostty-web, with the theme/scrollback workarounds and the transport fix it uncovered | partial |

### What still owes

| Milestone | Owed | Why it is not done |
|---|---|---|
| 03 | P5: firefox, webkit and a macOS leg | the firefox build will not launch on the author's machine, and an unverified leg must not gate `main` |
| 10 | P0–P3: a desktop shell that bundles and spawns its own server | the shells shipped as thin webview hosts first; the sidecar needs the packaged-server layout measured in that document |
| 12 | Phase 4's device run: soft keyboard, IME composition, selection handles, both mobile WebViews | a viewport emulation has none of them |
| 13 | all of it | research only: no TLS trust in any shell, no QR pairing |
| 18 | all of it | research only: no centre-stage terminal view exists |
| 20 | composer-side direct spawn, model autocomplete, roles, MCP injection, Run/fleet UI | the mention grammar and defaults shipped; the rest needs the MCP and Run work in the milestone |
| 21 | the phone/WebView run, the hidden-terminal memory number, and upstream theme/scrollback/reset fixes | the renderer swap, its workarounds and the paint benchmark shipped; the device run and the upstream fixes that would delete the workarounds remain |

Declined, and recorded as such rather than left open: plugin-platform **P6** (component registry,
declined in M04 and re-declined in M05/W6) and the editor's **format-on-save** (M14).

## Reference

| Page | What it is |
|---|---|
| [Plugin SDK](reference/plugin-sdk.md) | the contract a panel plugin is written against: `definePluginApp`, the slots, the kit hooks, the server half, the build and the test harness |
| [Built-in panels](reference/builtin-panels.md) | every right-panel view travels one path — a registration, one merged catalog, one enablement store — and a built-in is a plugin that arrived installed |

## Naming

`M<NN>-<slug>.md`, two digits, contiguous from `01`.

- **`NN` is the order the work started**, not the order it finished — so a `planned` milestone keeps
  its early number, and the table above reads chronologically even where a later one shipped first.
- **The slug carries no version and no date.** `18.8`, `2026-10-13` and the like drift the moment a
  pin moves; the header and the body carry them.
- **One milestone, one file.** Two documents that were written together but decide different things
  (M16 measures, M17 designs) stay two milestones, in order.

## Status

Every milestone states its status once, in the header block — after the title, before the first `##`
section — as exactly one line:

```
Status: **<token>** — <one clause naming what is left, or how it ended> (YYYY-MM-DD, `commit`)
```

| Token | Means |
|---|---|
| `done` | every planned item landed, or was declined with the reason recorded in the file |
| `partial` | something is still owed and is named in the clause and in "What still owes" |
| `planned` | nothing is implemented; the file is research or design only |
| `declined` | considered, measured, and not built — with the reason |
| `blocked` | owed, and blocked by something outside this repository |

`reference/` documents carry **no** status line: a contract that is over is not a contract.

`tests/docs-milestones.test.ts` enforces all of the above, plus that every `docs/…` path named from
`README.md`, `packages/**`, `.github/**`, `marketplace/**` and `docs/**` resolves. Those rules are
mechanical because the failure they prevent is silent: a renamed page left referenced from a build
script breaks nothing until a reader follows it.
