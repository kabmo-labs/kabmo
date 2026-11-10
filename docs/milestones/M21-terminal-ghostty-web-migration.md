# M21 — Terminal emulator migration: xterm.js to ghostty-web

Status: **partial** — the right-panel terminal renders with `ghostty-web`, the desktop/theme smoke runs pass, and the paint benchmark is measured (34.8 MB/s on the 33.7 MB `cat`, above the xterm baseline); the phone/WebView run and the upstream fixes that would remove the workarounds remain (2026-11-09, `d27b9f85`).

The right-panel terminal is a real PTY (`Bun.Terminal`). Until this milestone it was rendered by
`@xterm/xterm@6.0.0` plus `@xterm/addon-webgl@0.19.0`
(`src/client/components/workspace/terminal-panel/`); §1a records the migration. The question:

> Can that renderer be replaced with `ghostty-web` — Ghostty's VT parser compiled to WASM, with an
> xterm-compatible JavaScript API — without losing behaviour Kabmo has measured and hardened?

M18 compared xterm to libghostty for a **new centre-stage terminal** and declined Ghostty then
because libghostty-vt ships no renderer. This milestone is narrower and newer: ghostty-web **does**
ship a renderer, and the migration target is the existing panel, not a second terminal view.

## 1. Verdict

1. **The seam is close enough to migrate.** ghostty-web implements the surface the panel actually
   uses: `open`, `write(Uint8Array)`, `onData`, `onResize`, `onScroll`, `paste`, `getSelection`,
   `focus`, the scroll verbs, `reset`, `dispose`, `options.*` and a `FitAddon`. The socket,
   protocol and PTY runtime need no change for a basic cutover.
2. **Do not cut over on the published stable release.** `ghostty-web@0.4.0` (2025-12-09) has **no
   terminal mouse tracking at all**; the `next` prerelease (2026-10-28) does. Both still lack
   runtime theme changes, `onBinary`, xterm's line-count scrollback, and a clean reset/rebuild.
3. **Two gaps need design, not a type swap:**
   - **Theme switching** is built on a palette fixed at terminal creation. Kabmo switches the whole
     document theme at runtime and expects the terminal to repaint. ghostty-web only warns.
   - **Scrollback** is Ghostty's **byte** budget, not xterm's line count. Passing xterm's `10000`
     retains roughly 600 lines at a 98-column panel in the measurement below.
4. **No performance case exists yet, and the one direction measured is negative.** In a synthetic
   16 MiB ANSI-heavy parse benchmark, ghostty-web's WASM path was **slower** than
   `@xterm/headless@6.0.0` (70–72 vs 137–154 MiB/s). Paint is unmeasured; xterm's WebGL memory
   problem disappears with Canvas 2D, but ghostty-web's render loop runs while the panel is hidden.
5. **The research recommendation was to keep xterm in production and spike the migration behind the
   existing mount seam** — not to treat it as an import change. The spike was run and shipped with
   the workarounds in §1a; the gates in §7 are what the remaining work still owes.

## 1a. What shipped (2026-11-09)

The panel was migrated behind the existing mount seam, with the workarounds this research named:

- `@xterm/xterm`, `@xterm/addon-fit` and `@xterm/addon-webgl` are gone; the dependency is
  `ghostty-web@0.4.0-next.21.g640db46` (the `next` prerelease, because stable `0.4.0` has no mouse
  tracking). `webgl.ts`, `safePatchFitAddon`, `safePatchRenderService`, `XtermCore` and `XtermModule`
  are deleted.
- `terminal-panel/mount.ts` owns the new lifecycle: load WASM + fonts in parallel, `open`, **`clear()`**
  (stale-page guard), `FitAddon`, input wiring, replay, fit and theme rebuild. `setTheme` recreates
  the terminal with the new palette, then `useTerminal.reattach()` reconnects the socket and the
  server replays its 512 KiB history.
- Legacy X10 mouse reports are routed through `shared/lib/workspace/terminal/input.ts` as latin-1
  bytes; SGR reports stay on the text channel.
- `scrollback` is `TERMINAL_SCROLLBACK_BYTES` (16 MB = 10,000 lines × 100 columns × 16-byte cells),
  not xterm's `10000` line count.
- Fonts: `terminal-panel/fonts.ts` waits for the text face (bounded) so the cell box is measured
  against the face the grid uses, and re-measures when either face lands late. The bundled Nerd face
  stays lazy — asking for it up front would download 1.1 MB on machines whose own Nerd Font already
  supplies the glyphs. `terminal-panel/navigation.ts` keeps Shift+scroll and touch drag, written for
  ghostty's inverted custom-key-handler contract.
- **A latent transport bug was found and fixed at its source while smoke-testing:** every PTY frame
  reached the browser as TEXT (`{"0":27,…}`), not as a binary frame, so the client dropped live shell
  output. The cause is Elysia's `ws.send`: it JSON-stringifies any object that is not a Buffer
  (`node_modules/elysia/dist/ws/index.js`), and the viewer handed it a `Uint8Array`. `asBinaryFrame`
  (`server/lib/terminal/send-result.ts`) now wraps the frame in a zero-copy `Buffer` view, so the
  socket carries real binary bytes. The fix is worth more than correctness: measured `cat` of a
  33.7 MB text file through the real panel went from **4.58 MB/s** (text byte maps) to
  **34.8 MB/s** (binary) — above the xterm WebGL baseline recorded in §7 (6.9-7.3 MB/s), because the
  JSON spelling expanded every output byte ~4× and made the client parse it back.
- **`term.write('')` throws** (`Offset should not be negative`): replay completion no longer uses
  xterm's empty-write callback; it uses the non-empty write callback or a frame.

Verified: `bun test` (all suites), `bun run build`, the terminal network e2e on Chromium and WebKit
(Firefox still fails to launch on this machine, a pre-existing browser issue), a visual prompt +
`echo` run, and a live `paper → nord-dark` switch that rebuilt the terminal, replayed
`theme-smoke`, and produced no console errors.

### 1b. Benchmark and phone run (2026-11-09)

Measured on the real panel, Chromium, 1440x900, one PTY, via a throwaway Playwright spec (§7
scenarios 1, 2, 7):

| Scenario | Result |
|---|---|
| `seq 1 50000` (340 KB) | 0.15 s, 81 frames, rAF p50/p95 16.7 ms, no long tasks |
| `cat` of a 33.7 MB text file | **34.8 MB/s** (0.92 s), 127 binary frames — xterm WebGL baseline 6.9-7.3 MB/s |
| JS heap, one terminal | ~32 MB after 34 MB of output (`Performance.getMetrics`) |
| Replay + theme switch | second `ready`, replay, canvas sampled at the Nord background `[31,36,48]` |
| Phone viewport 390x844, touch | canvas 360x598, `touch-action: pan-y`, key bar with Ctrl/Alt/Copy/Paste and the navigation keys, no document overflow, shell output rendered |

Caveat: the phone leg is a Chromium device emulation (viewport, coarse pointer, touch), not a real
iOS `WKWebView`/Android `WebView` run, and the hidden-terminal memory number (§7 scenario 8) is not
measured. Both stay owed in the milestone index.

### 1c. Render and font parity audit (2026-11-09)

A screenshot + pixel-sample pass against a styled shell (ANSI colors, bold/dim/italic, wide glyphs)
checked the render against the xterm view it replaced. The font is **unchanged by construction**:
same family stack (`TERMINAL_FONT_FAMILY` = `'Fira Code'` + the same glyph fallbacks + bundled Nerd
face), same 12px size, same `p-1.5` host padding — the canvas renderer's cell width is
`ceil(measureText('M').width)` = 8px at 12px Fira Code, matching xterm's advance, and the palette
maps slot-for-slot onto xterm's theme (`getTerminalTheme` vs. the old `getXtermTheme`, verified
pixel-level: sampled ANSI yellow renders `rgb(215,153,33)`, the renderer's own mapping of
`#c2410c`).

Deviations found, with their verdicts:

- **Line pitch is 20px** — the font's 16px line box plus 2px on each side — but only because the
  cell box is measured here rather than inherited (§5.5): the vendor's `M`-ink measurement gave
  13px and left descenders sitting on the cell's last pixel, which cropped every SGR background
  block. Two smaller corrections (14px, then 16px, both padded from the ink) still read as a
  cropped rectangle on the real panel; the chosen box pads the em box and centres the ink.
  Measured on the real panel: cell 20px, glyph ink 11px, 5px above and 4px below, 37 rows in the
  same panel (57 at the vendor's 13px).
- **`dim` renders brighter than expected** — sampled `rgb(215,153,33)` for SGR-2 yellow vs. the
  expected `rgb(214,93,14)`. Measured in the renderer: a FAINT cell sets `globalAlpha=0.5` around
  `fillText`, but the text color comes from the WASM cell (`fg_*`), which was already resolved at
  parse time against the **8-color palette** — so SGR-2 yellow is palette[3] with alpha, a
  *lighter* mix, not the dimmed RGB xterm computed. Upstream parser behavior, not a Kabmo bug.
- **`italic` renders synthesized** (`ctx.font = 'italic …'` with no italic face in the stack —
  Fira Code has no italic; the browser slants the 400). Same as xterm's WebGL atlas behavior;
  no change.
- **Bold is real weight 700**, not synthesized: the renderer composes
  `bold 12px <stack>`; CSS font matching picks the bundled 700 face
  (`fira-code-fonts.css` ships 400/500/600/700), verified: with 500/600/700 unloaded, a bold cell
  loads `fira-code-latin-700-normal.woff2`. Note: a per-family weight hint (`'Fira Code';700` in
  the stack) is NOT valid CSS font shorthand and was rejected — documented at
  `TERMINAL_FONT_FAMILY` so it is not retried.
- **Cursor color** is the theme accent (`palette.meta`) drawn as an opaque block — visible on both
  light and dark palettes. Selection background stays an opaque 28% ink-over-canvas gray because
  the renderer's selection branch paints the raw `selectionBackground` with no alpha handling; an
  `rgba()` value would be misread. Both documented at `getTerminalTheme`.
- **Neither the terminal nor the fit is left with a surface of its own.** The renderer paints the
  host's full box (`renderLine` clears each row, then fills it with `theme.background`), and
  `FitAddon` subtracts a hard-coded **15 px** before dividing by the cell width — so with a
  background of its own the terminal read as a rectangle that stopped short of the panel. Both are
  now Kabmo's: `theme.background` is **`transparent`**, and `installFullWidthFit` replaces
  `proposeDimensions` without the 15 px reservation. Measured: canvas alpha **0** in both looks, so
  the surface behind it is the panel's — `--theme-paper` under the classic look, and under
  `[data-surface="glass"]` the frosted `glass-chrome` tint (`color-mix(… paper 34%, transparent)`,
  measured), which `glass.css` already makes the view ROOT cede to. Geometry after: host 334×759,
  canvas 328×752; the 6/7 px remainder is a sub-cell strip that now has nothing to paint, so it has
  no visible seam. The host also lost its `p-1.5`: the grid starts at the panel's own edge. Cost:
  ghostty's in-canvas scrollbar (8 px, only while scrolling) can overlap the last column, which is
  why it reserved the space.

## 2. What the panel depends on today

| Fact | Module | Consequence for migration |
|---|---|---|
| Mount lifecycle, dynamic import, fit, replay, input wiring | `src/client/components/workspace/terminal-panel/mount.ts` | The single seam. `XtermMount`/`XtermMountCallbacks` are the contract to keep (or rename in one cutover). |
| Imperative handle used by the panel and key bar | `RealtimeXtermView.tsx:8-35` | `write`, `writeReplay`, `reset`, `focus`, `applicationCursorKeys`, `getSelection`, `paste` must be re-implemented. |
| Theme palette and font constants | `src/client/data/theme/terminal.ts:22-196` | `getXtermTheme` maps cleanly to ghostty-web's `ITheme`; `safePatchFitAddon`, `safePatchRenderService`, `XtermCore` and `XtermModule` are xterm-private and must disappear. |
| WebGL context lifecycle | `src/client/components/workspace/terminal-panel/webgl.ts` | Does not exist in a Canvas 2D renderer; delete the module and its test rather than emulate it. |
| Font loading and late re-measure | `terminal-panel/fonts.ts:49-100` | Keep `ensureTerminalFonts`; replace `clearTextureAtlas` with `renderer.remeasureFont()` + a full render. |
| xterm CSS and viewport scrollbar | `src/client/tailwind.css:2,556-566` | Remove the xterm stylesheet import; ghostty-web draws its own scrollbar inside the canvas. |
| Transport | `src/client/hooks/workspace/terminal/{index,socket}.ts`, `src/shared/lib/workspace/terminal/protocol.ts` | Unchanged for the basic swap. Reconnect semantics matter for a theme rebuild (§6). |
| Server scrollback | `src/server/lib/terminal/history.ts` (`MAX_HISTORY_BYTES = 512 * 1024`) | A reattach replays at most 512 KiB. That makes theme replay cheaper than it first appears. |
| E2E selectors | `tests/e2e/specs/terminal.e2e.ts`, `terminal-capacity.e2e.ts` | `.xterm`, `.xterm-helper-textarea` and the "WebGL canvas, `.xterm-rows` empty" comments are xterm facts; all must change. |

## 3. Candidate facts (measured 2026-11-09)

| Fact | Stable `0.4.0` | `0.4.0-next.21.g640db46` |
|---|---|---|
| Published | 2025-12-09 | 2026-10-28 |
| License | MIT | MIT |
| ESM bundle | 681,918 B (194 KB gzip) | 702,145 B (198 KB gzip) |
| WASM | 423,045 B, inlined as a `data:application/wasm;base64` URL | 423,939 B, same inline scheme |
| Browser bundle through `Bun.build` (one entry, minified) | 636,027 B / 184,929 B gzip | — |
| `init()` in Chromium | 10 ms | 10 ms |
| Terminal mouse tracking | **absent** (`InputHandler` has no mouse listeners/config) | **present** (SGR and legacy X10 encoders) |
| Zero runtime dependencies | yes | yes |

The inline WASM is why no asset route is needed: `Ghostty.load()` fetches the data URL. It is also a
CSP liability (§5.7), and `init()` offers no path override; constructing `Terminal({ ghostty })` from
an explicit `Ghostty.load(url)` is the escape hatch.

The stable/next split is decisive: pinning `latest` loses mouse reporting for vim, htop, tmux and any
other mouse-aware TUI. A migration must pin the prerelease (or a commit) and accept pre-1.0 churn.

## 4. API compatibility against the current usage

| Current use | ghostty-web | Verdict |
|---|---|---|
| `new Terminal({ fontSize, fontFamily, theme, scrollback, smoothScrollDuration, cursorBlink, cursorStyle })` | supported | works; `lineHeight`, `scrollSensitivity`, `fastScrollSensitivity`, `allowProposedApi` are **not** options |
| `term.open(container)` | supported | works |
| `term.write(Uint8Array, cb)` | supported; callback after next render | works; streaming UTF-8 is the WASM parser's job |
| `term.onData` | supported | works, but see `onBinary` below |
| `term.onBinary` | **absent** | must be bridged (§5.3) |
| `term.onResize` | supported | works |
| `term.onScroll` | emits `number` (`viewportY`; 0 = bottom) | works; `term.buffer.active.viewportY` is hardcoded 0 and must not be used |
| `term.modes.applicationCursorKeysMode` | **absent** | `term.wasmTerm.getMode(1, false)` works and was measured true/false around `CSI ? 1 h/l` |
| `term.paste(text)` | supported, bracketed when DEC 2004 is set | measured: `ESC[200~a\r\nbESC[201~` |
| `getSelection`, `focus`, `scrollLines/Pages/Top/Bottom` | supported | works |
| `reset()` | supported | rebuilds the WASM terminal, **loses scrollback**, and leaves stale cells (§5.4) |
| `refresh()`, `clearTextureAtlas()` | **absent** | use `renderer.remeasureFont()` + `renderer.render(wasmTerm, true, viewportY)` |
| `loadAddon(new FitAddon())` | supported | works; fit uses `renderer.getMetrics()` and reserves 15 px |
| `_core._renderService.dimensions` | **absent** | replace with `renderer.getMetrics()` / container size checks |
| WebGL addon | by design absent | Canvas 2D only |
| Runtime `options.theme = …` | warns, does not update the palette | blocks a naive theme switch (§5.1) |
| ANSI palette supplied at construction | applied by WASM | measured custom green/red/default RGB |
| `scrollback` option | **bytes**, not lines (Ghostty `max_scrollback`) | must be re-budgeted (§5.2) |

## 5. Gaps that decide the migration

### 5.1 Theme switching is not supported at runtime

`lib/terminal.ts` answers `options.theme` after `open()` with
`console.warn('ghostty-web: theme changes after open() are not yet fully supported')`. The renderer's
`setTheme()` updates canvas background, cursor and selection colours, but ANSI cells already carry
RGB resolved by WASM at parse time, and the WASM palette cannot be updated in place. Upstream:
[#125](https://github.com/coder/ghostty-web/issues/125),
[#144](https://github.com/coder/ghostty-web/issues/144) (open; adds
`ghostty_terminal_set_colors`).

Measured workaround: set the new theme, then `reset()` (or construct a new `Terminal`). The
background did change to the new palette (`rgb(250,248,243)`), but the scrollback was gone and the
previous screen text was still present until `clear()` was called. Rebuilding therefore implies
**replaying history**. The server already retains 512 KiB per terminal, so a reconnect/re-attach
delivers a bounded replay at the recorded `replayCols`/`replayRows`.

Options, in order of preference:

1. **Wait for #144.** The clean answer: a palette update plus full redraw, no replay.
2. **Rebuild + reattach (interim).** On a theme change: dispose/construct the terminal with the new
   palette, `clear()` it, then reconnect the socket to the same terminal id so the server replays
   ≤512 KiB. Cost: one flicker and one replay per theme switch; no server change.
3. **Renderer-only theme.** `renderer.setTheme()` without a palette rebuild — rejected: every ANSI
   colour in existing and new output stays on the old theme.
4. **Local WASM patch.** Add the setter from #144 ourselves — rejected unless the project accepts a
   Zig/WASM build and a patched dependency, which Kabmo's unpatched-xterm rule exists to avoid.

### 5.2 `scrollback` is a byte budget, not a line count

Ghostty's `max_scrollback` is bytes; ghostty-web types and documents it as lines. Measured on a
98×50 terminal with 5,000 written lines:

| `scrollback` value | Rows retained |
|---|---|
| `10_000` | 613 |
| `1_000_000` | 613 |
| `100_000_000` | 4,951 (all) |
| `0` | 4,951 (unlimited per the wrapper) |

Upstream: [#140](https://github.com/coder/ghostty-web/issues/140) (open) and
[#177](https://github.com/coder/ghostty-web/pull/177) (open; converts the JavaScript line budget to
bytes and fixes viewport row coherence). A migration must replace `scrollback: 10000` with a byte
budget derived from the panel's column count — start at 16 MiB (≈13k rows at 100 columns in the
measured 64 MiB/53k-row regime) and verify against a real 10k-line scrollback. The server's 512 KiB
history bounds reattach replay regardless.

### 5.3 `onBinary` has no equivalent

Kabmo forwards xterm's non-UTF-8 input through `term.onBinary` (`mount.ts`, `RealtimeXtermView`).
ghostty-web fires mouse reports through `onData` as a JavaScript string. Measured legacy X10 output
for a click at column 188:

```
codes: 27 91 77 32 220 35      (ESC [ M, button, col+32, row+32)
TextEncoder sees 7 bytes, not 6 — 220 becomes C3 9C
```

`handleInput` in `terminal-panel/index.tsx` encodes every `onData` payload with `TextEncoder`, so a
legacy mouse report is corrupted and the shell receives garbage. Precision fix: in the mount
adapter, route a payload that starts with `ESC [ M` through the existing binary path
(`charCodeAt(i) & 0xff`), everything else through `onData`. The alternative is to patch
ghostty-web to expose `onBinary` (no open issue for it was found on 2026-11-09; SGR mode is mostly
ASCII, so this is narrower than it looks — but legacy X10 is exactly the case xterm's `onBinary`
exists for).

### 5.4 `reset()` and a fresh `Terminal` can inherit stale cells

Measured in Chromium, both on `0.4.0` and `next`:

- Write `hello`, call `reset()`: the handle stayed at `1310720`, `getScrollbackLength()` became 0,
  and `getLine(0)` still returned `hello`. `clear()` then zeroed it.
- `dispose()` a terminal that had `hello`, construct a new `Terminal` at the same width: it received
  the **same handle** and `getLine(0)` returned `hello` before any write.

This is the WASM allocator reusing pages without a blank bootstrap. Upstream:
[#154](https://github.com/coder/ghostty-web/pull/154) (open; blank bootstrap for `open`/`reset`) and
[#134](https://github.com/coder/ghostty-web/pull/134) (open; stale cells during scroll). Until a fix
lands, **every open and every reset must be followed by `term.clear()`**; otherwise a shell restart,
a theme rebuild or a second terminal can display the previous session's screen. That is a
correctness and privacy rule, not a cosmetic one.

Reported separately upstream is
[#210](https://github.com/coder/ghostty-web/issues/210): freeing a terminal with scrollback and then
writing to a new terminal at a **different width** throws `memory access out of bounds`. It did not
reproduce in a Bun probe at 98→20 columns with `next`, but it is the exact shape a theme rebuild or
panel resize can create; treat it as an open risk.

### 5.5 Visual parity is not free

- `lineHeight` is not an option, and the vendor's cell box is too short. Its `measureFont` reads
  the **ink of `M`**, which has no descender, so the descent falls back to `0.2em`: at 12 px Fira
  Code the cell is **8×13** with the baseline at `ceil(ink ascent) + 1` = 10. A `g`/`y`/`p`
  descender (2.54 px below the baseline) then ends on the row's last pixel, and since `renderLine`
  repaints the row's full band with the theme background before its cells, the next row's fill clips
  anything past it. Measured on the real panel: an SGR background block around `ggyypp` had **0 px
  of block under the descenders**, so every coloured block read as cropped.

  Kabmo therefore measures its own cell box (`measureTerminalCell` in
  `terminal-panel/fonts.ts`, installed by `installCellMetrics`): `height = round(lineBox) +
  2 × CELL_PADDING_PX` (2), and `baseline` centres the measured `Mg` ink inside it. At 12 px Fira
  Code that is **8×20** — line box 16 + 2 + 2 — with the ink 11 px tall, 5 px above and 4 px below.
  Re-verified by pixels on the real panel: cell 20 px, ink 11 px, 37 rows. Padding from the *ink*
  rather than the line box was tried first (14 px, 16 px) and still read as cropped, because
  ascenders and accent marks live inside the em box but above the cap ink. `measureFont` and the
  field it writes are private, so the correction replaces the instance method and calls
  `remeasureFont()`; the override reads `term.options`, so the font-size round-trip done by
  `watchTerminalFonts` re-measures with the same rule.
- The host is `contenteditable="true"` with `tabindex="0"` (ghostty-web's IME and
  `beforeinput` path), and its real input is a hidden textarea. A click on the 6px host padding
  therefore focuses the DIV, and the browser paints its **native caret** there: a black blinking
  bar at the left edge whose height follows the host's inherited `16px/24px` line box (measured in
  Chromium: `caret-color: rgb(20,19,16)`, 24px). It is not the terminal cursor — that is the canvas
  block in `--theme-*` meta — and it must not exist. Fixed with `caret-color: transparent` on
  `.kabmo-terminal`; pinned by an e2e assertion that clicks the padding and reads the computed
  colour, because the caret itself blinks.
- DECSCUSR cursor shape is ignored (the cursor stays the constructed block) — upstream
  [#145](https://github.com/coder/ghostty-web/issues/145),
  [#147](https://github.com/coder/ghostty-web/pull/147).
- In the alternate screen, wheel events are converted to CSI arrow keys before mouse tracking is
  considered, so vim/tmux split panes cannot scroll the pane under the pointer and DECCKM is not
  honoured — [#136](https://github.com/coder/ghostty-web/issues/136), #147.
- Powerline/Nerd Font glyphs are painted with `fillText` from the same canvas; there is no WebGL
  atlas, so the "seamless powerline" reason for `addon-webgl` disappears but glyph fallback is a
  different rasteriser. Compare screenshots at 1× and 2× DPR.
- Touch is not implemented. Keep Kabmo's custom `attachTouchScroll` (`scrollLines` per 16 px drag);
  ghostty-web has wheel handling only.
- **A grid announcement is a PTY resize, and the panel animates its width.** The right panel opens
  with a width transition, so a fit during that transition measures a squeezed box; announcing it
  sent `resize 5x37` to a real shell, the shell answered by redrawing its prompt hard-wrapped at 5
  columns, and that output stayed in the scrollback — every reload replayed one more wrapped prompt
  block above the live one, so the prompt marched down the panel and the shell printed its
  partial-line mark (`%`) between blocks. The same reload also announced ghostty's **80×24
  default** before the first fit, which looks like a plausible size and rewrapped the prompt at 80
  columns. Fixed in `terminal-panel/grid.ts`: a grid is announced only after it has held still for
  `GRID_SETTLE_MS` (120 ms), is at least `MIN_REPORT_COLS × MIN_REPORT_ROWS` (10 × 5), and came from
  a fit that actually measured the container (`safeFit` reports it, so the default grid is never
  announced). `finishReplay` re-states the grid afterwards so a missed resize self-heals, and
  `attachTerminal` applies the attach's size to the existing session, because a page that fits to
  the grid the session already had sends no resize frame at all. Verified by frames: the attach is
  the settled `40x36`, every resize frame equals it, and `replayBytes` is identical across two
  reloads (the shell wrote nothing between them).

### 5.6 Hidden panels still run a render loop

xterm's `setWebgl(false)` released a measured 541.8 MB of graphics in an 817.7 MB footprint. A Canvas
2D terminal has no separate GPU context to release, but `Terminal.open()` starts a
`requestAnimationFrame` loop that runs until `dispose()`. Kabmo keeps every built-in right-panel view
mounted and keeps the terminal live while hidden, so eight terminals mean eight loops. Canvas work
is smaller than WebGL, but this is a CPU/GPU question that needs the same `vmmap`/CPU measurement the
WebGL change got — not an assumption. There is no pause API; a visibility pause would be an upstream
feature.

### 5.7 CSP and offline startup

The published bundle inlines the WASM as a `data:` URL and `init()` has no path argument. Under a
policy such as `default-src 'self'; script-src 'self'; connect-src 'self'`, the data fetch and
`WebAssembly.compile` both fail; upstream
[#188](https://github.com/coder/ghostty-web/issues/188). Kabmo sets no global CSP today, but this is
why the adapter should load explicitly:

```ts
const ghostty = await Ghostty.load('/ghostty-vt.wasm');
const term = new Terminal({ ...options, ghostty });
```

That needs the WASM served as a same-origin asset (and `'wasm-unsafe-eval'` if a CSP is ever
introduced). The default data-URL path is acceptable only while the page has no CSP.

## 6. Migration design behind the existing seam

The transport and server stay untouched. The cutover is contained in the terminal panel plus the
theme module:

1. **Rename the seam.** `XtermMount` → `TerminalMount`, `XtermMountCallbacks` →
   `TerminalMountCallbacks`, `mountXterm` → `mountTerminal`, `RealtimeXtermHandle` →
   `RealtimeTerminalHandle`, and `RealtimeXtermView` → `RealtimeTerminalView`. One cutover, no
   aliases; `terminal/index.tsx` and the key bar are the only importers.
2. **Mount order.** `Promise.all([ensureTerminalFonts(fontSize), Ghostty.load()])` → construct
   `Terminal` with the palette, font and a byte scrollback budget → `open(container)` →
   `clear()` (stale-cell guard) → `FitAddon` → event wiring. `init()` / `new Terminal()` before
   `open` throws, so the order is part of the contract.
3. **Readiness.** Replace `_core._renderService.dimensions` with
   `renderer.getMetrics().width > 0` plus the existing `clientWidth/clientHeight > 0` guard. A
   hidden panel still measures 0 px, so attach continues to wait for the ResizeObserver, exactly as
   now.
4. **Input.** One `onData` handler: `ESC [ M` prefix → byte path (`onBinaryInput`); everything else
   → `onInput`. Keep the modifier latch in `terminal-panel/index.tsx`; ghostty's own KeyEncoder
   already applies DECCKM for physical keys, and the soft key bar reads
   `term.wasmTerm?.getMode(1, false)`.
5. **Replay.** Keep `writeReplay`: `term.resize(replayCols, replayRows)`, `term.write(bytes, cb)`,
   suppress `onResize` while replaying, then fit. ghostty-web's write callback runs on the next
   frame, so `fitAfterWrites` behaves like the xterm path.
6. **Theme.** Implement option 2 from §5.1 behind a `TerminalHandle.setTheme` / panel callback:
   rebuild the terminal with the new palette, `clear()`, then ask the hook to reattach the same
   terminal id. `useTerminal` needs a `reattach()` verb (release + reconnect, or a future `replay`
   control frame); `restart()` must not be reused because it mints a new shell id.
7. **Fonts.** `refreshWhenFacesLoad` keeps its `document.fonts` listener but calls
   `renderer.remeasureFont()` and a forced full render, then `fit()`. The xterm fontSize
   bump trick and `clearTextureAtlas` go away.
8. **Scroll state.** `onScroll((viewportY) => setScrolledUp(viewportY > 0))`; do not read
   `buffer.active.viewportY` (always 0). The "Latest" button keeps `scrollToBottom()`.
9. **Visibility.** Delete `setWebgl` from the mount and the view. Keep the `visible` prop only if a
   measured hidden-loop cost needs a future pause; do not pretend Canvas has a context to release.
10. **Styles.** Remove `@import "@xterm/xterm/css/xterm.css"` and the `.xterm .xterm-viewport`
    rule. The canvas fills the container; keep `touch-action: pan-y` on the terminal host and the
    existing custom touch-scroll handlers.

## 7. Verification gates before cutover

The xterm path is proven; a renderer swap must prove the same surfaces, not a compiling adapter.

**Unit and route gates** — the six commands in `AGENTS.md` §2. Tests to add or change:

- a pure adapter test for the `ESC [ M` → binary decision, including bytes ≥ 0x80 (the measured
  220 case) and ordinary Unicode input that must stay on the text path;
- a pure scrollback budget test (lines × columns → bytes) pinned to the measured table, so a future
  “fix” cannot quietly restore `10000` as a line count;
- a theme-classification test: no ANSI palette change is claimed without a rebuild/replay path;
- update `fonts.test.ts` to the new terminal shape (`remeasureFont` + render instead of
  `clearTextureAtlas`); delete `webgl.test.ts` with `webgl.ts`;
- a mount test that asserts `clear()` is called immediately after `open()` and after `reset()` (the
  #154 guard);
- e2e selector cutover: replace `.xterm` with an explicit wrapper hook
  (`data-terminal-root`), replace `.xterm-helper-textarea` focus with a click on the terminal host
  (ghostty focuses its hidden textarea itself), and rewrite the comments that explain why
  `.xterm-rows` is empty under WebGL.

**Product scenarios** — run each on the real panel, not a fixture:

1. `seq 1 400000` through the real PTY: **paint** throughput and frame latency, xterm WebGL vs
   ghostty Canvas, same panel size.
2. The 33.7 MB `cat`: the measured xterm number was 6.9–7.3 MB/s after PTY coalescing; a regression
   here is a blocker.
3. Resize burst: drag the panel while a full-screen app runs; look for wrapped fragments, duplicate
   prompts and `onResize` feedback loops during replay.
4. Theme switch with 10k lines of scrollback: palette correct, history restored, no stale screen,
   no second prompt.
5. Shell restart: old screen gone (`clear()` after `reset()`), new prompt at the panel's grid.
6. `vim`/`less`/`htop`/`tmux`: DECCKM arrows, alternate screen, wheel over a split pane, cursor
   shape, selection and copy.
7. A phone with neither Nerd Font installed: cold load, late font arrival, touch scroll, key bar.
8. Memory and CPU with eight hidden terminals: compare against the xterm/WebGL `vmmap` baseline and
   record the Canvas 2D number; this is the one claim that can justify the swap by itself.

**Performance nuance.** The only direct comparison measured here is VT parse/state, not paint:
16 MiB of ANSI-heavy lines in 64 KiB chunks at 100×40 parsed at **221–230 ms (70–72 MiB/s)** in
ghostty-web and **104–117 ms (137–154 MiB/s)** in `@xterm/headless@6.0.0`. That contradicts the
published libghostty-vt comparison and is exactly why the swap needs a Kabmo paint benchmark before
any “faster” claim. xterm's advantage may be its headless fast paths; ghostty-web pays a copy and a
WASM call per chunk. Neither number decides the renderer.

## 8. Risks and upstream dependencies

| Risk | Severity | Current mitigation |
|---|---|---|
| Runtime theme unsupported (#125/#144) | blocker for parity | rebuild + reattach, or wait for #144 |
| Scrollback is bytes, not lines (#140/#177) | blocker for UX parity | byte budget + measured scrollback test |
| `onBinary` absent | correctness for legacy mouse | `ESC [ M` adapter, or upstream API |
| Stale cells after `reset`/new terminal (#154/#134) | correctness + privacy | `clear()` after every open/reset |
| Free + new width OOB (#210) | crash risk | do not rebuild across widths; wait for fix |
| Mouse tracking only in `next` | feature loss on `latest` | pin the prerelease/commit |
| Wheel in alt screen ignores tracking/DECCKM (#136/#147) | TUI usability | upstream fix |
| DECSCUSR ignored (#145/#147) | visual parity | accept block cursor or upstream fix |
| No hidden-loop pause | memory/CPU | measure with 8 terminals; upstream API if needed |
| CSP/data-URL WASM (#188) | deployment | explicit `Ghostty.load(url)` + same-origin asset |
| `next` is pre-1.0, no 0.5 stable | maintenance | pin exact version, re-measure on upgrade |

## 9. Phases

**P0 — spike, no production switch.** Put `ghostty-web` behind the existing mount seam on a branch.
Prove: attach/fit/replay, input (including X10), paste, scrollback depth, theme rebuild + reattach,
`clear()` guards, hidden-panel CPU, phone. Record the eight scenarios in §7.

**P1 — adapter and tests.** Rename the seam, delete `webgl.ts`, update `fonts.ts` and the theme
module, add the pure tests, update the e2e selectors. No server change.

**P2 — theme and scrollback.** Implement the chosen theme strategy and the byte budget. This is the
phase that decides whether the migration is worth shipping; if #144/#177 land first, it collapses to
configuration plus deletion.

**P3 — parity run.** The full §7 matrix on desktop, phone, and each shell. Gate the swap on paint
throughput, memory and the TUI scenarios; not on unit tests.

**P4 — cutover.** Remove `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, the xterm CSS
import, `webgl.ts`, `safePatchFitAddon`, `safePatchRenderService` and the `XtermCore`/`XtermModule`
shapes. Update `bun.lock` and the wiki page for the terminal. Rollback is the reverse commit while
the seam names are still one module.

## 10. What would change the verdict

Adopt when **all** of the following hold: a Kabmo paint benchmark shows Canvas 2D at least matching
xterm WebGL for the same panel and stream; the theme and scrollback gaps have an upstream fix or a
measured workaround; and the TUI matrix (vim/tmux/htop, DECCKM, mouse, cursor shape) passes. Continue
with xterm when the only motivation is “Ghostty is more correct”: the VT work is not Kabmo's measured
bottleneck, and the current renderer is the one whose failure modes are already pinned by tests.
