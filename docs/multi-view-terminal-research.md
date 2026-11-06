# Multi-view centre stage: a terminal view, and xterm vs Ghostty

Status: research only (2026-11-05). No code changed.

The question: the centre column is the chat timeline; add a **terminal view** beside
it. Should that terminal render with **xterm** or **Ghostty**?

## Verdict

1. **Reuse the terminal stack Kabmo already ships.** The terminal is a real PTY
   (`Bun.Terminal`) rendered by **xterm 6.0 + WebGL**. It already runs full-screen
   TUIs; a terminal view is a **layout and state** feature, not an emulator change.
2. **Do not adopt Ghostty now.** Ghostty the app cannot be embedded in a web page.
   Only `libghostty-vt` (WASM) is embeddable, and it is **VT parse + terminal state
   only — it ships no renderer**. Everything Kabmo has measured and hardened around
   xterm (theme switching, Nerd Font atlas, WebGL lifecycle, fit/replay, key bar,
   bracketed paste) would be re-earned from scratch.
3. **If "terminal view" means showing omp's TUI for the same session: it cannot
   coexist with Kabmo's chat.** omp holds a per-session ownership lease (`flock`);
   a second omp that resumes that file forks itself to a new session id
   (`reason: "open-elsewhere"`). See `src/server/lib/omp/session/ownership.server.ts`
   and `lease-flock.server.ts`.
4. **Subagents already have a first-class surface.** The timeline exposes
   `?subagent=<id>` → `SubagentView` (live transcript + steer/cancel) and the
   sidebar has the roster (`components/common/subagent-list`). A terminal is not
   needed to see them, and a TUI would not share the RPC child's state.

## What exists today

| Surface | Module | Facts |
|---|---|---|
| Right-panel terminal | `src/client/components/workspace/terminal-panel/` | Built-in view, lazy `@xterm/xterm` + `@xterm/addon-webgl`; `liveWhileHidden` so the shell keeps streaming while another view is shown |
| PTY runtime | `src/server/lib/terminal/{runtime.server,session.server,history,output,shell,spawn}.ts` | One shell per terminal id, N viewers, bounded scrollback, coalesced reads (4 ms / 8 KiB) |
| Transport | `src/shared/lib/workspace/terminal/protocol.ts`, `src/server/routes/terminal/ws.ts` | One WebSocket per terminal; text = JSON control (`attach`/`resize`/`close`), binary = raw PTY bytes |
| Client transport | `src/client/hooks/workspace/terminal/{index,socket}.ts` | `useTerminal` owns **one hardcoded key**: `useSessionState('terminal.id')` |
| Event delivery | `src/client/hooks/workspace/terminal/socket.ts` | `onData`/`onBinary` out, `Uint8Array` in, replay at recorded `replayCols/replayRows` |
| Layout | `WorkspacePanels.tsx` | `center-panel` (filler, ChatTimeline) · `editor-panel` · `right-panel`; the chat can be collapsed but **stays mounted and inert** (`chatHidden`) |

Consequences that shape a second terminal surface:

- **One grid per PTY.** Two viewers of the same terminal id fight over `cols`/`rows`;
  the last `attach`/`resize` wins and the other viewer sees wrapped output. The wiki
  states this is inherent to a shared PTY. A centre terminal therefore needs its
  **own terminal id**, not a second socket to `terminal.id`.
- **`useTerminal` hardcodes `'terminal.id'`.** Both instances would mint/read the same
  key and open two sockets to one shell; a restart from one panel would replace the
  other's buffer. Refactor to take a `stateKey` (e.g. `terminal.center.id`) before a
  second mount exists.
- **The right-panel terminal is always mounted.** `WorkspacePanels` renders every
  built-in view and hides the inactive ones with CSS, and `liveWhileHidden` keeps it
  connected. So the second terminal is a genuinely second shell.
- **The server caps live shells at 8** (`MAX_TERMINALS`, `runtime.server.ts`), counted
  across all sessions. One extra shell per open session is cheap but not free.

## What Ghostty can and cannot be here

Kabmo's shells are thin WebViews (macOS `WKWebView`, Windows `WebView2`, Linux
`WebKitGTK`; Android `WebView`). Every product surface is the server's page.

- **Ghostty the app**: a native terminal emulator. No browser/webview embed API, and
  embedding it would need a native terminal view in each of the four shells
  (`NSView`, HWND, GTK widget, Android View) — a different product surface per
  platform, breaking "every product surface is the server's own page".
- **`libghostty-vt` WASM**: real and shipping. `ghostty-vt-small.wasm` (818,082 bytes)
  is an asset on Ghostty's `tip` release (checked 2026-11-04/05). It provides the VT
  parser, terminal state, a render-state ABI (dirty rows, tagged colors, cursor) and a
  key encoder. **It ships no renderer** — no glyph atlas, no shaping, no box drawing.
  Its author is explicit that the web renderer is out of scope for libghostty-vt.
- **Consequence**: adopting Ghostty is adopting a renderer project (or a wrapper), not
  an import swap.

### Candidates

| Option | Version / activity (2026-11-05) | Renderer | Notes |
|---|---|---|---|
| **`@xterm/xterm`** (incumbent) | 6.0.0, deps already in `bun.lock` | WebGL addon + DOM fallback | Wired end to end; all Kabmo integrations proven |
| `ghostty-web` (coder) | npm 0.4.0 (Dec 2025), repo pushed 2026-10-31, 3,016★, MIT | **Canvas 2D only** | "xterm.js API compatibility"; ~400 KB WASM; no WebGL addon |
| `@wterm/ghostty` (Vercel Labs) | 0.5.9 (Nov 2026) | DOM renderer | VT core + `TerminalCore` adapter; renderer core-agnostic |
| Restty | early-release, ~970 files | **WebGPU + WebGL2**, ligatures, procedural box drawing | Closest to a full Ghostty-quality renderer; ships pane manager/plugin host/search — collides with what Kabmo/Preact owns; inlines its WASM base64 |

`ghostty-web` is pre-1.0 (0.4.0, 76 open issues) and its renderer is a single 1,001-line
Canvas 2D file — no WebGL, no glyph atlas control. It is a credible reference
implementation and a future spike target, not a drop-in for a panel that has been
tuned against xterm's renderer internals.

### The gaps that decide it (checked in `coder/ghostty-web` source at `main`)

1. **Runtime theme changes are unsupported.** `lib/terminal.ts`:
   `case 'theme': console.warn('ghostty-web: theme changes after open() are not yet fully supported')`.
   Kabmo's whole theme system writes a new xterm palette on switch and expects the
   scrollback to repaint (`.wiki/...`, `getXtermTheme`, `applyDocumentTheme`). This alone
   blocks a naive swap.
2. **No `onBinary`.** Kabmo forwards non-UTF-8 input through `term.onBinary`
   (`mount.ts`). ghostty-web exposes no equivalent.
3. **No `term.modes.applicationCursorKeysMode`.** The touch key bar asks xterm for
   DECCKM at press time (`RealtimeXtermView.applicationCursorKeys`); without it, arrows
   in vim/less are encoded wrong.
4. **Kabmo patches xterm internals on purpose.** `_core._renderService.dimensions` gates
   both fit and attach; `safePatchFitAddon` / `safePatchRenderService` exist because a
   hidden panel measures 0 px; `refreshAtlasWhenNerdFaceLoads` calls `clearTextureAtlas()`
   when the bundled Nerd Font face lands late; `webgl.ts` owns context release (measured
   541.8 MB graphics in an 817.7 MB footprint). None of that exists in a Canvas 2D engine,
   and each item was a measured bug once.

### Performance: real numbers, right layer

- Published library benches (Mitchell Hashimoto, M4 Max 80×24) put libghostty-vt well
  above xterm.js at **VT work**: IO long lines 1023 vs 144 MB/s, mixed 543 vs 121,
  reflow ~9000 vs 1605 resizes/s, incremental scroll ~76923 vs 19084 render-state
  updates/s. These measure parse/state, not paint.
- Kabmo's actual bottleneck was already found and fixed one layer down: forwarding
  `Bun.Terminal` reads one-per-read produced 182,259 frames for `seq 1 300000`;
  coalescing at 4 ms / 8 KiB took a real `seq 1 400000` run from 1.78 → 2.99 MB/s on
  the socket, and in a browser (PTY → WS → xterm WebGL) 33.7 MB from **2.12 → 6.9–7.3
  MB/s**.
- So: the VT is not the wall today, and ghostty-web's Canvas 2D renderer is **not
  proven faster than xterm's WebGL** at large viewports; swapping the VT alone would
  not move the measured number. Claiming otherwise would require a Kabmo benchmark.

### Explicit non-goals now

- No native Ghostty embed in any shell.
- No renderer we own (Canvas/WebGPU) — that is the Restty bill of materials.
- No swap until one measured Kabmo workload fails under xterm.

### When to revisit

Only if a real Kabmo workload hits xterm's ceiling: complex-script shaping,
`XTPUSHSGR/XTPOPSGR`, ligatures, many concurrent terminals, or sustained >10–20 MB/s.
At that point the existing `XtermMount` / `RealtimeXtermHandle` is already the seam:
spike `@wterm/ghostty` or Restty behind it and measure the same scripts
(`seq 1 400000`, the 33.7 MB cat, a resize burst, a theme switch, a phone with no
Nerd Font) before changing production code.

## "Can xterm show omp's subagent TUI?"

Two different questions, two different answers.

### Rendering: yes

omp's subagent UI is `pi-tui` overlays — `AgentHubOverlayComponent` (roster table with
status/unread/task, keys + wheel + click) and `AgentTranscriptViewer` (a `fullscreen`
overlay that **borrows the alternate screen**, `?1049h`), plus
`running-subagent-badge`, `job-tree`, `session-observer-registry`
(`@oh-my-pi/pi-tui/dist/types/overlays/*`). That is plain text + SGR on the alternate
screen — exactly what xterm 6 does: alt-screen, truecolor, mouse reporting, bracketed
paste. xterm also implements DEC mode 2026 synchronized output and answers DECRQM for it
(`node_modules/@xterm/xterm/src/common/InputHandler.ts:1972`, `:2301`), so omp's
frame-compositing path is honoured.

Capability loss is real but bounded, because Kabmo's PTY sets
`TERM=xterm-256color`, `COLORTERM=truecolor` (`terminalEnv`, `lib/terminal/shell.ts`)
and pi-tui's detection keys off env markers, not the renderer:

| Feature omp probes | In Kabmo's PTY | Effect |
|---|---|---|
| Kitty / iTerm2 / SIXEL images | **off** (no `TERM_PROGRAM` marker) | inline screenshots in a transcript do not appear; the text does |
| DECCARA rectangles | **off** (opt, falls back to padded strings) | no visual loss |
| OSC 8 hyperlinks | off by default for `base` | links render as text |
| DEC 2026 sync output | **on** where xterm's DECRQM probe answers | correct |
| Kitty keyboard protocol | **not implemented by xterm** (`CSI u` is SCORC there) | omp falls back to legacy keys; exotic chords are lost |

pi-tui already carries the scar for xterm.js embedders: a host that advertises Kitty
while its xterm.js renderer implements neither graphics nor Unicode placeholders turns
image previews into PUA garbage (`isPaseoEmbedder`, `terminal-capabilities.d.ts`).
Kabmo sends no such advertisement, so omp degrades instead of painting garbage.

**Except when the host leaks one.** `terminalEnv` (`src/server/lib/terminal/shell.ts`)
overrides `TERM`/`COLORTERM` but does not remove `TERM_PROGRAM`/`TERM_PROGRAM_VERSION`,
so a Kabmo server launched from Ghostty, iTerm2, WezTerm or VS Code hands its PTY that
outer identity (`stripKabmoHostEnv` only removes `PORT`/`HOST`/`NODE_ENV`/credentials).
pi-tui's detector recognises all of those markers (present in the omp binary:
`Apple_Terminal`, `iTerm.app`, `ghostty`, `WezTerm`, `vscode`) and would then pick an
image protocol xterm cannot paint — Kitty placeholders would show as PUA cells. This is
a latent bug in the existing terminal panel for any capability-probing TUI, not a reason
to change the renderer: scrub those markers (and `KITTY_*`/`WEZTERM_*`) in `terminalEnv`
so `TERM=xterm-256color` + `COLORTERM=truecolor` is the whole truth.

### Access: no, not for the session Kabmo is running

An xterm only renders bytes; the subagent TUI is drawn by an **omp TUI process**. To get
it, that process must own the session — and Kabmo's RPC child already does:

- omp takes a per-session `flock` (`ownership.server.ts`, `lease-flock.server.ts`);
  a second omp that resumes the file moves itself to a new session id with
  `parentSession` and `reason: "open-elsewhere"`.
- So typing `omp --resume <id>` inside Kabmo's terminal produces a second session file,
  not a view of the one the chat is driving.
- Subagents are not PTYs: they are records and frames inside the RPC child
  (`subagent_lifecycle` / `subagent_progress`), which Kabmo already renders as
  `SubagentView` (`?subagent=<id>`, live transcript, steer/cancel) and the sidebar
  roster. There is no subagent process to attach a terminal to.

Viable shapes, in preference order: keep the structured `SubagentView`; or run a
separate omp TUI session in the terminal and accept that it duplicates the chat with
none of Kabmo's composer/queue/steer surfaces.

## Prior art: Orca and Ghostex

Two shipping agent workspaces answer this question from opposite ends.

### Orca (`stablyai/orca`, MIT, TypeScript/Electron, ~116k★)

An Electron desktop + mobile app for fleets of coding agents. Its terminal is
**xterm.js** — and it is the closest production reference for Kabmo, because it is
the same renderer in the same kind of web UI.

- Pins `@xterm/xterm@6.1.0-beta.336` plus `addon-fit`, `addon-image`, `addon-ligatures`,
  `addon-search`, `addon-unicode11`, `addon-web-links`, `addon-webgl` — **and patches
  every one of them** (`config/patches/@xterm__*.patch`; source hunks touch
  `CoreBrowserTerminal`, `CompositionHelper`, `InputHandler`, `AttributeData`, `Buffer`,
  `WidthCache`, `SortedList`). `node-pty` is patched too.
- Its own options show what the patches buy: `vtExtensions: { kittyKeyboard: false }`
  is set only for Windows ConPTY, i.e. the patched xterm **does** implement the kitty
  keyboard protocol elsewhere (`preview-terminal-options.ts`).
- Terminal tabs live in a pane tree; drag a tab to an edge to split, layouts persist per
  worktree. Agent tabs carry live state (working / waiting / done / unread).
- Scrollback survives restarts via `@xterm/headless` + `addon-serialize` ("cold park"),
  and a hidden pane's TUI is restored rather than replayed from scratch.
- Terminal features Kabmo does not have yet: find-in-scrollback, OSC 52 clipboard,
  link action popover, "Copy Context", "Reset Terminal" for stuck keyboard/mouse modes.

**Lesson:** xterm.js is proven for agent TUIs at fleet scale, but "Ghostty-class" marketing
is xterm **plus a maintained patch set**. Kabmo's shell view needs none of those patches
today; the patch burden is the price of matching native terminals, not of adding a view.

### Ghostex (`maddada/Ghostex`, MIT, Rust/GPUI + native Ghostty)

A native workspace where **every agent is a real terminal session** and the chat is a
second view of that same session ("switch to its terminal with one click", Option+G).

- It **vendors Ghostty's source** with seven patches under `.dependencies/ghostty-patches`
  to expose embedding APIs (`0005-embed-config-string-apis`, `0006-mouse-cmd-click-encode`,
  `0008-embed-custom-shader-msl-api`, teardown hardening). Native Ghostty inside an app is
  a patched-libghostty integration, not a library you import.
- Chat View reads the agent's **transcript** (`packages/gx-protocol/src/session_chat_agents.rs`:
  13 families, including `family: "pi"` with labels `pi`/`omp`), while the live session
  is the PTY. Per-agent setting for the **default view** (Chat or Terminal), and sessions
  keep running when the window closes.
- Subagents are first-class in the chat view (`transcript/subagent.rs`,
  `native_chat/subagent_view.rs`).

**Lesson:** the model the user is asking for — chat and terminal as two renderings of ONE
session — is real, and Ghostex does it for omp. But it works there because the agent's TUI
is the session (`omp` runs in a PTY, the chat is a parsed mirror). Kabmo is the inverse:
omp runs `--mode rpc-ui` with no TUI bytes, so there is nothing for a terminal to render.

### What Kabmo should borrow, and what it should not

Borrow:

- **One session, two views, one toggle** (Ghostex): chat stays mounted, terminal is a view;
  the toggle is persisted per session, and the default view is a setting.
- **The terminal stays live while hidden** (both). Kabmo already does this
  (`liveWhileHidden`, WebGL context released when not visible).
- **Per-worktree/session layout memory** (both). Kabmo already persists
  `layout.panelWidths` per session; a `layout.centerView` belongs beside it.
- **Reset Terminal** and **find-in-scrollback**: cheap, high-value; the first one covers
  the stuck-mode class of bugs that a shell panel otherwise blames on the server.

Do not borrow (yet):

- **Patched xterm / kitty images / ligatures** (Orca): Kabmo's xterm is unpatched and its
  theme pipeline is built on that. Revisit only with a measured need.
- **Serialize + cold park** (Orca): Kabmo's server-side history already replays raw bytes
  at the recorded grid. Serialization buys survival across a *server* restart, which is a
  different feature with a different budget.
- **A pane tree** (Orca): Kabmo's three-column layout + switches is the right size now;
  a drag-to-split tree is its own project.

## The multi-view itself

"Multi view" = a second view in the centre column. Four shapes, cheapest first.

### A. Pop out the existing terminal (no new state) — interim

The right-panel terminal toggles a full-width mode that hides the other columns. Same
`terminal.id`, same socket, same scrollback; no second shell, no duplicate grid, no
persistence. Smallest change and it answers "I need the terminal big" immediately.
It is a mode on `TerminalPanel` + the layout's existing collapse machinery, not a new view.

### B. Centre switcher: Chat | Terminal — recommended

A view switch in the centre column:

```
session_ui_state: layout.centerView = 'chat' | 'terminal'
```

- Chat **stays mounted and inert** while terminal is shown — the same mechanism the
  editor's `full` mode already uses (`chatHidden` in `WorkspacePanels`, `inert` on the
  container). Never unmount it: it owns the live run, the queue, the draft and the
  scroll position.
- The terminal gets its **own** state key (`terminal.center.id`) via a `stateKey` prop on
  `useTerminal`; it is a different shell from the right-panel one. Both can exist
  (cap 8), or the centre view can be the only one by disabling the right-panel view.
- Persist in `session_ui_state` (per-session UI state rule). If two surfaces must agree
  on the mode (switcher + a layout reader), use `useSharedSessionState`, not
  `useSessionState` — a private copy is the documented drift bug in `editor-view.ts`.
- Model the switch as a table (`CENTER_VIEWS`) with id/title/icon/component, not an
  `if (view === 'terminal')`; that is the "a fact is stated once" rule.
- Mobile: the phone's `MainView` renders the same `ChatTimeline`; the same switch must be
  present, or the shell says in words why not. The phone already reaches the terminal
  through the right drawer.

### C. Editor-column takeover

The editor column already has a plugin takeover slot (`app.panel`) and a rail. Reusing it
for the terminal means no new layout concept, but it is semantically the editor's slot
and the built-in terminal has no rail entry. Not recommended unless a third centre view
is also coming.

### D. True split: chat + terminal side by side

Adds a third resizable `Panel` to the `Group`. Real cost is the width resolver: the
editor/right pair already share a coupled budget with fractions and floors
(`shared/lib/workspace/panel-widths.ts`, `resolveWorkspacePanelWidths`), and the chat is
the filler with its own floor. A third panel is a new budget with two handles, on two
platforms. Defer until B is used and the split is actually requested.

### Plugin scope

Every right-panel view is a plugin, but there is **no centre-stage slot** in
`@kabmo-labs/kabmo-sdk` (`rightPanel` | `panel` | `headerPanel` | `settingsSection`).
Do not smuggle a centre view through the editor slot. If centre views should be
pluggable, add a positional `centerPanel` slot and a built-in entry in
`panels/builtin.tsx`'s sibling table — one catalog, one enablement axis, the same rule
as today.

## Invariants for whichever shape is chosen

1. **One socket per terminal id.** A second mount must use a different id key; the PTY
   has one grid, and `attach`/`resize` are last-writer-wins.
2. **Chat is collapsed, never unmounted** when another centre view is shown.
3. **Theme switch repaints the terminal** (`getXtermTheme` per theme id); this is why
   the renderer matters.
4. **Attach waits for a real grid** (hidden container = 0 px) and replay is written at
   `replayCols × replayRows`, then fitted.
5. **Resize is debounced before `SIGWINCH`**; the burst rule does not change.
6. **Key bar and bracketed paste stay** (`term.modes…`, `term.paste`).
7. **Both layouts** get the switch, and the terminal keeps working while hidden
   (`liveWhileHidden` is about the right-panel view; a hidden centre view should
   release the WebGL context, as `RealtimeXtermView` already does with `visible`).
8. **Cap 8** busy shells is a shared budget; a second per-session shell is a product
   decision, not an implementation detail.

## Verification plan (when this becomes code)

- Run the real thing: open the centre terminal in Chromium, run `vim`, a 400k-line
  `seq`, a resize drag, a theme switch, and a phone viewport with no Nerd Font installed.
- Assert reattach after reload lands on the remembered id with replayed scrollback.
- Assert the right-panel and centre terminals have different ids and neither steals the
  other's grid.
- Run the gates in `AGENTS.md` §2.

## Open decisions for the user

1. **Switch or split?** B (Chat | Terminal switcher) vs D (side by side).
2. **One shell or two?** Does the centre terminal reuse the right panel's shell (then
   only one may be visible at a time), or own a second shell?
3. **Is the goal a shell, or omp's TUI?** This document assumes a shell. A TUI of the
   same session is blocked by omp's ownership lease; a TUI of a *new* session would
   duplicate the chat product with none of the composer/queue/subagent surfaces.

## Sources

- Repo: `src/client/components/workspace/terminal-panel/*`, `src/client/hooks/workspace/terminal/*`,
  `src/server/lib/terminal/*`, `src/shared/lib/workspace/terminal/protocol.ts`,
  `src/client/components/layout/desktop-layout/WorkspacePanels.tsx`,
  `src/server/lib/omp/session/ownership.server.ts`, `.wiki/Plugins-Skills-and-Automation.md`
  ("Terminal Panel (real PTY)"), `.wiki/App-Shell-and-Layout.md`.
- Ghostty WebAssembly: `ghostty-org/ghostty` release `tip` assets (2026-11-04),
  `ghostty-vt-small.wasm` (818,082 bytes); Mitchell Hashimoto's 2026-08-14 posts that
  libghostty-vt is VT + state only and ships no web renderer.
- `coder/ghostty-web` `main` (`lib/terminal.ts`, `lib/renderer.ts`, README), npm
  `ghostty-web@0.4.0`.
- `@wterm/ghostty@0.5.9` (npm, 2026-11-04), `wterm.dev/ghostty`; Restty internals as
  surveyed in termio's 2026-08-18 design note.
- Published libghostty-vt vs xterm.js library benchmarks (M4 Max, 80×24) as relayed by
  termio's design note; Kabmo's own PTY-framing measurements as recorded in the wiki.
