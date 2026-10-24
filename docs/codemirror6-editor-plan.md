# CodeMirror 6 — Editor Panel Replacement

Replacing the editor panel's hand-built editing surface (`CodeSurface` +
`CodeEditor`: a transparent `<textarea>` over a Shiki-highlighted `<pre>`, with
Kabmo's own windowing, undo, multi-cursor, find bar and keymap) with
CodeMirror 6.

Status: **implemented.** Phases 1–3 shipped; Phase 4's desktop half is verified
and its device run is not (see *Phase 4* below). The measurements in this
document are the 2026-10-23 baseline, kept as the record the migration was
decided on; the *Verification* section at the end states what was re-measured
afterwards.

Baseline method: `@codemirror/view` 6.43.15 / `state` 6.7.6 / `merge` 6.12.3 in
headless Chromium, and this repository's own editor through the e2e harness
(`startHarnessServer` + Playwright, 1440×900, default panel width). Reproduce by
pointing a throwaway spec at `tests/e2e/fixtures/server.ts`.

Scope: the desktop editor panel (`src/client/components/workspace/editor/`) and
the phone's full-screen editor
(`src/client/components/mobile/mobile-right-sidebar/FullEditor.tsx`), which share
`CodeSurface`. The diff panel and the chat tool cards followed in Phase 3 (both
now render through `@codemirror/merge`); the wiki reader and the markdown
preview are unchanged and keep their own renderers.

## Verdict

Worth it. Three measured reasons, in order of weight:

1. **Typing is 25× slower than it needs to be, and it degrades with file size.**
   In the real app, one keystroke on a 4,800-line file costs a median **59.6 ms**
   (p95 78.1 ms, max 124.6 ms); CM6 with the same Shiki colours costs a median
   **2.1 ms** (p95 3.2 ms) — and that figure is *flat* from 8,000 to 20,000 lines,
   because CM6 renders only its viewport.
2. **4,350 lines of hand-rolled editor machinery become deletable** (text
   commands, undo stack, multi-cursor, find matcher, wrap measurement, line
   windowing, gutter geometry) along with the class of bugs they keep producing
   every migration of this file (see `AGENTS.md`: the shared scroller clamping on
   tab switch, the find-jump that scrolled to the wrong band, `-webkit-text-fill-color`
   overlays, the textarea-vs-`pre` register drift).
3. **Capabilities the panel does not have and should**: real multi-cursor with a
   single undo step, find/replace with a maintained matcher, per-tab undo
   isolation, and — for the diff panel later — `unifiedMergeView` with chunk
   accept/reject, which is 1,066 lines of table rendering plus a diff parser today.

The cost is honest and bounded: **+127 KB gz** inside the editor's *existing*
lazy chunk (`WorkspacePanels.tsx` already `lazy()`-imports the editor, so first
paint is unaffected), six MIT dependency packages, and six e2e specs plus part of
the editor unit suite rewritten.

The cheaper alternative — keep the surface and fix its two hot spots (the
whole-document wrap re-measure, and the per-keystroke `highlightCode` +
`innerHTML` replacement, measured at 7.2 ms and 5.3 ms) — is a legitimate
short-term fix, but it reaches none of (2) or (3) and leaves the textarea/pre
overlay architecture in place. Do that only if this migration is deferred.

## Measured baseline

One keystroke, 30 samples with one `requestAnimationFrame` between each
(`setRangeText` + `input`, i.e. what a person types):

| Surface | Document | median | p95 | max |
|---|---|---|---|---|
| current editor (real app) | 480 lines | 16.8 ms | 27.8 ms | 32.9 ms |
| current editor (real app) | 4,800 lines | **59.6 ms** | 78.1 ms | 124.6 ms |
| CM6 + Shiki decorations | 8,000 lines | 2.2 ms | 3.2 ms | 5.6 ms |
| CM6 + Shiki decorations | 20,000 lines | **2.1 ms** | 3.2 ms | 3.7 ms |

Mount and scroll:

| Metric | current | CM6 |
|---|---|---|
| mount, 20,000 lines | n/a (windowed by our own code; full-document `highlightCode` is 543 ms @2k, 1,466 ms @20k) | 9 ms, 66 rendered lines |
| mount, 50,000 lines | — | 9 ms, 66 rendered lines |
| 20 scroll steps, 4,800 lines | median 15.6 ms, **p95 77.3 ms** | median 16.7 ms, p95 17.6 ms @20k |
| find "respond" on 4,800 lines | count badge `1 of 1200` | `SearchCursor` enumerates the same list |

Bundle, `Bun.build` (`target: browser`, minify, splitting):

| Entry | raw | gzip |
|---|---|---|
| current `code-surface` entry | 6 KB + 80 chunks | 1.9 KB entry / 434 KB total |
| CM6 `state+view+commands+search+merge+language` (whole static graph) | 394 KB | **127 KB** |
| `@codemirror/language-data` (do not import) | 2,332 KB | 639 KB |

Language coverage, measured against the 59 ids in
`src/shared/lib/code/shiki-langs.ts`:

| Approach | Languages | Colours |
|---|---|---|
| CM6 modern `lang-*` + `legacy-modes` | 48 / 59 (no grammar for `zig dart nix hcl graphql solidity racket makefile json5 svelte astro`) | a second tokenizer — disagrees with chat, diff, wiki and markdown preview |
| CM6 + our Shiki decoration plugin | **59 / 59** | byte-identical to every other surface |

## Decisions

**Keep Shiki as the tokenizer; CM6 supplies the editor, not the colours.** A
lezer grammars build would trade 11 languages and a different palette for a
smaller chunk; the palette already shipped is the app's (`one-light` /
`one-dark-pro`, consumed through CSS custom properties), and the chat timeline,
diff panel, wiki reader and markdown preview all render through the same
pipeline. A second tokenizer is a visible inconsistency, not a refactor.

**Rejected: `codemirror-shiki@0.3.0`.** It dispatches inside its `ViewPlugin`
constructor, so `new EditorView` throws
`Calls to EditorView.update are not allowed while an update is in progress`; in a
real browser it produced zero token spans and no error at all (a silent failure).
Write ~60 lines instead: a `ViewPlugin` that tokenizes `view.viewport` (plus the
same ~40 lines of grammar context `windowed-highlight.ts` already uses) and emits
`Decoration.mark` ranges.

**Decorations carry Shiki's dual-theme custom properties, so the palette stays in
CSS and a theme switch does not re-tokenize.** `Decoration.mark({ class:
'shiki-tok', attributes: { style: '--shiki-light:…;--shiki-dark:…' } })` (verified
that mark-decoration `attributes` accepts arbitrary keys, `style` included), plus
two rules in `src/client/tailwind.css` — `.cm-content .shiki-tok { color:
var(--shiki-light) }` and `html[data-theme-variant="dark"] .cm-content
.shiki-tok { color: var(--shiki-dark) }` — mirroring the existing `.shiki span`
pair at lines 384–385. Theme switching is then CSS-only: a dual-theme token
carries both colours, so nothing re-tokenizes.

**CM6 owns the scroller: the code surface gets a bounded host
(`height: 100%`), not the panel's `overflow-auto` wrapper.** Measured: with an
unconstrained host the editor grows to the document's height (363,758 px at 20k
lines, 909,383 px at 50k) and windowing still bounds the DOM, but the scroll
geometry, `scrollIntoView`, the gutter and the restore path all become the
outer scroller's problem. The markdown preview keeps its own scroller — it is not
a CM6 surface.

**The `CodeSurfaceHandle` contract survives, extended by one method.** Every
consumer stays untouched: `useEditorFind` (`readSelection` / `select` / `reveal` /
`applyDocument`), `useLineJump`, `useEditorOutlineBridge`, `useSearchReveal`. That
is what keeps this migration contained to one component.

**`EDITOR_KEY_BINDINGS` stays the one source of chords**, and the CM6 keymap is
generated from it. Panel-owned commands (`find`/`replace`/`nextMatch`/…,
`toggleWordWrap`) are bound inside the editor too and *delegate outward* through
`onCommand`, exactly as `deps.delegate` does today — so the palette remains a
second way in and never a second implementation. The panel's capture-phase
handler keeps only what has no editor focus: `Escape`, `⌘⇧P`, and chords pressed
while the find field holds focus.

**Per-document `EditorState` cache keyed by tab id, applied with
`view.setState()`.** Verified: document, selection and undo history all follow the
tab, and an undo in one tab cannot touch another. This is what the panel's tab
model needs and what the current single-buffer-plus-`value`-prop design fakes.

**No lezer grammar packages.** Comment toggling and indentation come from a
`languageData` facet — verified `toggleComment` works with only
`{ commentTokens: { line, block } }` and no syntax tree. `indentUnit.of('  ')`
supplies the unit. No folding, no bracket matching, no `indentOnInput` until a
language is actually installed (a later decision, per language).

**Read-only needs both halves.** `EditorState.readOnly.of(true)` stops commands
but *not* a programmatic `dispatch({ changes })` (measured: the change applied);
`EditorView.editable.of(false)` sets `contenteditable=false`. A viewer takes both.

## File inventory

**What actually shipped, against the forecast below.** The forecast was right
about the volume and wrong about four rows, and the deltas are worth stating
because each one was a discovery:

- `use-editor-find.ts` and `find-state.ts` were **kept**. The plan contradicted
  itself here (Phase 2 step 2 says keep the state shape); the hook is the state
  machine, and only its matcher imports changed. Its two test files and the
  harness were kept with it.
- `marks.ts` and `lines.ts` were **kept**. `lines.ts` is the line arithmetic half
  the highlighter, the outline and the search panel all use, and `marks.ts` still
  emits `<mark>` for every surface that is not the editor (the chat card's
  excerpt, the search panel's rows). Only the editor stopped using them.
- `commands.ts` (236 lines) and `line-edits.ts` (its helpers) were **deleted**,
  which the forecast did not list: every command in them is a CM6 command now,
  and the one thing still needed — the comment-token table — became
  `comment-syntax.ts` (56 lines) because `toggleComment` reads exactly that.
- `diff-panel/{UnifiedView,SplitView}.tsx`, `shared/lib/fs/diff-parser.ts` and
  the chat card's parser use were **deleted in Phase 3**, not listed here.

Delete — 4,350 lines including tests (measured with `wc -l`), as forecast:

| Path | Lines | Why |
|---|---|---|
| `src/client/components/common/code-editor/{index.tsx,handler.ts,handler.test.ts}` | 763 | the textarea layer and its dispatcher |
| `src/client/components/common/code-surface/{index.tsx,measure.ts}` | 496 | replaced; wrapping is `EditorView.lineWrapping` |
| `src/client/hooks/editor/use-code-window.ts` | 100 | CM6 viewport |
| `src/client/hooks/editor/use-editor-history.ts` | 134 | `history()` |
| `src/client/hooks/editor/use-occurrences.ts` (+test) | 334 | `selectNextOccurrence` / `selectSelectionMatches` |
| `src/client/hooks/editor/{use-editor-find.ts,find-state.ts}` | 375 | Phase 2 — `SearchCursor` + the widget's own state shape |
| `src/client/hooks/editor/{use-editor-find.test.ts,use-editor-find-write.test.ts,find-harness.test-util.ts}` | 498 | Phase 2 |
| `src/shared/lib/code/editor/{occurrences.ts,occurrences.test.ts}` | 228 | CM6 multi-selection |
| `src/shared/lib/code/editor/{text-commands.ts,text-commands.test.ts}` | 332 | `@codemirror/commands` |
| `src/shared/lib/code/editor/{marks.ts,marks.test.ts}` | 192 | `Decoration` |
| `src/shared/lib/code/editor/{lines.ts,lines.test.ts}` | 164 | `state.doc.line*` |
| `src/shared/lib/code/editor/{find.ts}` | 236 | Phase 2 |
| `src/shared/lib/code/editor/{reset-css.ts,reset-css.test.ts}` | 67 | no transparent textarea |
| `src/shared/lib/code/{lazy-window.ts,lazy-window.test.ts,windowed-highlight.ts}` | 431 | CM6 viewport + the decoration plugin |

Rewrite:

- `src/client/components/common/code-surface/index.tsx` — becomes the CM6 mount
  (`EditorView` lifecycle, the handle, the keymap, the theme) and must be split
  under the 350-line ceiling into
  `code-surface/{index.tsx,extensions.ts,shiki.ts,keymap.ts,theme.ts,documents.ts}`.
- `src/client/hooks/editor/use-scroll-restore.ts` — restore targets the editor's
  own scroller (`handle.getScrollElement()`), not the panel's wrapper.
- `src/client/components/workspace/editor/FileDocument.tsx` — host layout: the
  code surface fills a bounded box; only the preview keeps the panel scroller.
- The `occurrences` / `onOccurrencesChange` props and the panel's
  `occurrences` state disappear (CM6 owns secondary selections).

Keep unchanged (this is the point of preserving the handle): `use-line-jump`,
`use-editor-outline-bridge`, `use-editor-document`, `use-search-reveal`,
`use-file-editor`, `use-file-read`, `use-file-writes`, `use-file-transfer`,
`use-editor-drop`, `resolve-viewer`, `font.ts`, `typography.ts`, `keymap.ts`,
`palette.ts`, `syntax-highlight.ts`, `highlighter.ts`, `shiki-langs.ts`,
`shiki-themes.ts`, `highlight-cache.ts`, and every viewer under `editor/viewers/`.

Dependencies to add (all MIT, versions as measured):

```
@codemirror/state@6.7.6
@codemirror/view@6.43.15
@codemirror/commands@6.11.1
@codemirror/search@6.7.2
@codemirror/merge@6.12.3       // Phase 3 (already needed for its pure diff())
@codemirror/language@6.13.1    // indentUnit, languageData types
```

## Contracts

Props (the call sites keep passing what they pass today, minus `occurrences`):

```ts
interface CodeSurfaceProps {
  value: string;
  onValueChange: (value: string) => void;
  language: string;            // Shiki id — unchanged
  wordWrap: boolean;
  documentKey: string;         // NEW: which EditorState in the per-tab cache
  marks?: readonly MarkRange[];
  currentMark?: number;
  onCommand?: (command: EditorCommand) => void;
  readOnly?: boolean;          // now actually enforced (readOnly + editable(false))
  style?: CSSProperties;       // font family / size / line height (zoom)
  padding?: number;            // the document's own padding, as `--surface-pad`
  scrollTestId?: string;       // `data-testid` on `view.scrollDOM`
  onScroller?: (el: HTMLElement | null) => void;  // NEW: see below
  className?: string;
}
```

Handle (the four existing methods; the planned getter was dropped):

```ts
interface CodeSurfaceHandle {
  getSelection(): { start: number; end: number } | null;
  select(start: number, end: number, focus?: boolean): void;
  applyDocument(value: string, caretStart: number, caretEnd: number): void; // one undoable transaction
  runCommand(command: EditorCommand): void;
  revealOffset(offset: number): void;   // EditorView.scrollIntoView(offset, { y: 'nearest' })
}
```

**Deviation: the scroller is reported, not read back.** The plan called for a
`getScrollElement()` accessor so `use-scroll-restore` could write to
`view.scrollDOM`. A getter cannot work there: the element appears only once the
view mounts, so a caller reading it through a `ref` during render gets `null` and
never re-runs. `onScroller` hands the element over on mount (and `null` on
unmount), the panel holds it in state, and `useScrollRestore` takes it as its
`element` option — which also re-arms the restore on the render the element
arrives in. An accessor nobody calls would have been dead API, so it is not
there.

## Phases

Each phase lands as its own commit(s) and leaves the app green. Gates for every
phase: `bun run lint`, `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`,
the 350-line check, `bun test`, `bun run typecheck:e2e`, `bun run build`, and the
Playwright suite (chromium + mobile projects).

### Phase 1 — core surface (editor panel + phone editor)

1. Add the five dependencies; write `code-surface/{extensions,shiki,keymap,theme,documents}.ts`
   and the new `index.tsx` (mount once, `view.setState` per `documentKey`, guarded
   external sync: `if (next === state.doc.toString()) return;`, plus an
   `applyingExternal` flag so the update listener cannot echo back).
2. Keymap generated from `EDITOR_KEY_BINDINGS`; panel-owned commands delegate via
   `onCommand`. `Tab` / `⇧Tab` keep the existing capture behaviour (`indentWithTab`
   plus a toggle so keyboard users can leave the editor).
3. Shiki decoration plugin over `view.viewport` with the 40-line context rule and
   the 12,000-character line bail-out, a mark cache keyed by the style string, and
   a rebuild skipped while `view.composing` is true.
4. Host layout: code surface in a bounded box; `FileDocument` keeps the scroller
   for the markdown preview only; the `editor-scroller` testid moves to whatever
   the surface scrolls (`view.scrollDOM`), and `selectors.ts` follows.
5. Rewrite `use-scroll-restore` to write to `getScrollElement()`, keeping the
   per-tab/per-surface keys (`editor.scrollPositions`, `editor.mobileScrollPositions`).
6. Delete the Phase-1 rows of the inventory; drop the `occurrences` props and
   state; update `editor/{index,Body,FilePane,FileDocument}.tsx` and
   `mobile-right-sidebar/FullEditor.tsx`.
7. e2e: rewrite `editor.e2e.ts` (contenteditable, not `textarea`),
   `editor-scroll.e2e.ts` (scroller locator), `outline.e2e.ts` (caret/selection
   via `view.state.selection` exposed through a test-only accessor or via the DOM
   selection), `search-panel.e2e.ts` (assert the rendered text, not `toHaveValue`).

Acceptance, measured in the real app:

- typing at 4,800 lines: median ≤ 5 ms, p95 ≤ 10 ms (baseline 59.6 / 78.1);
- mount of a 20,000-line file ≤ 100 ms with ≤ 200 rendered `.cm-line` nodes;
- wrap toggle in a 340 px panel: document `scrollWidth` equals `clientWidth` with
  wrap on, exceeds it with wrap off (probe: 14,511 → 340);
- ⌘D twice yields two cursors, typing edits both, one undo reverts both, and
  `Escape` collapses to one;
- `editor.e2e.ts`'s on-disk save assertion green; `editor-scroll.e2e.ts` round
  trip green (switch tab, come back, position kept);
- outline click selects the declaration's own name and focuses the editor;
- no `textarea` remains in the editor panel (one locator-defined fact the spec
  asserts).

### Phase 2 — find / replace on CM6

`FindWidget` keeps its markup, its chords, its `aria-label`s and its
`focusRequest` behaviour; only the matcher changes.

1. Replace `find.ts` with `SearchCursor` / `RegExpCursor`, which give the same
   ordered match list, the same case/regex/whole-word options and the same count.
   Verified: a cursor walk over a 4,800-line document enumerates 1,200 matches.
2. Keep `use-editor-find`'s state shape (`find-state.ts`) minus the matcher: query,
   replacement, options, `currentIndex`, `truncated`, `invalid`, `revealMatch`,
   `replaceCurrent`, `replaceAll`. Replace-one and replace-all become one CM6
   transaction each.
3. `marks` become a `StateEffect`-driven decoration field (verified: 95 marks
   rendered in the viewport of a 5,000-line document) instead of Shiki markup
   injection, so find results no longer force a re-tokenize.
4. Delete `find.ts`, `find-state`'s matcher imports, and the old tests; add
   matcher tests against `SearchCursor` semantics (case, whole word, regex,
   invalid regex = a different answer from "no matches", the cap).

Acceptance: the count badge, the step-through order, replace-one/replace-all
undo coalescing, `editor.findQuery` / `editor.findReplace` / `editor.findOptions`
persistence across reload, and the search-panel "jump to hit" path
(`search-panel.e2e.ts`, `jump-rail.e2e.ts`) all unchanged.

### Phase 3 — diff panel on `@codemirror/merge`

Shipped. What the plan did not anticipate, and what the implementation had to
decide:

- **The server sends both sides on every read, and `fullContext` is gone.** The
  panel compares DOCUMENTS now, so `oldContent`/`newContent` travel on the
  existing `GET /api/fs/git?fileDiff=1` response (they already did, unused by
  this panel) and *Diff Only* ↔ *Full Code* is a client-side
  `collapseUnchanged` reconfigure. The `-U<n>` probe existed only because a
  table renderer cannot collapse anything.
- **The counts come from `Chunk.build(a, b)`, not from `diff()`.** `diff()` is a
  CHARACTER diff: changing `line 5` to `line 5 changed` reports one insertion of
  `" changed"` and no deletion, so a badge built on it claimed `+2` for two
  edited lines. `Chunk.build` is the line-level chunking the rows are drawn
  from, and it needs no view — verified: two edited lines → `+2 -2`, a new file
  → `+2 -0`, an inserted line → `+1 -0`.
- **The chat tool card renders the same merge view**, so it does not grow a
  second diff implementation. It has a PATCH and no documents, so
  `shared/lib/fs/patch-sides.ts` rebuilds the two sides from the hunks — padding
  each side to the line its `@@` header names, or the gutter would number a
  mid-file change from 1. `contentMode: 'diff'` collapses that padding.
- **`diff-parser.ts` is deleted.** Its only remaining consumer was the card, and
  the card now needs the two sides rather than per-row line numbers.

The plan's own steps, as they landed:

1. `unifiedMergeView({ original, collapseUnchanged })` for the Unified view:
   measured 4 chunks, `.cm-changedLine`, `.cm-deletedChunk`, inline
   `.cm-changedText`, and `collapseUnchanged` reproducing *Diff Only* (25 viewport
   blocks) vs *Full Code* (80) through one `Compartment`.
2. `MergeView` for Split (measured: 3 chunks, two editors, aligned unchanged
   lines), and `Chunk.build(a, b)` for the toolbar's `+n/-n` (see above).
3. `getChunks(state)` is the read — note it is a *function*, and
   `state.field(getChunks)` throws (`Field is not present in this state`); the
   counts therefore go through `Chunk.build`, which needs no view.
   `collapseUnchanged` is a `Compartment` reconfigure, not a re-mount.
4. Keep `FileDiffData` (`oldContent` / `newContent` already travel), keep the
   toolbar's stage/unstage/discard and `revert`, keep the word-wrap toggle
   (`EditorView.lineWrapping`) and the persisted `diff.viewMode` /
   `diff.contentMode` / `diff.wordWrap`.
5. Delete `diff-panel/{UnifiedView,SplitView}.tsx` and `diff-parser` once both
   views are on the merge extension.

Acceptance: `git-panel.e2e.ts` green; `diff-panel.e2e.ts` pins a real
working-tree change rendering the right counts and toggling *Diff Only* ↔ *Full
Code*, the split shape's two read-only editors, and the wrapped default;
discard/stage still hit the routes they hit today.

### Phase 4 — mobile, IME and the shells

1. `EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off',
   autocapitalize: 'off', translate: 'no' })` — stated explicitly in
   `code-surface/extensions.ts`, so a future CM6 default cannot silently regress a
   phone keyboard.
2. **Device run: not done.** Everything a desktop browser can exercise is
   covered — `mobile-editor.e2e.ts` opens a file in the phone's full-screen
   editor, types into it, waits for the autosave to land on disk, and reopens the
   file to the scroll position it was left at, on the `mobile-chromium` (Pixel 7)
   project. A soft keyboard, IME composition and selection handles are exactly
   what a viewport emulation does not have, so they remain unverified.
3. The two shells' WebViews (Android WebView, iOS WKWebView) are likewise
   unverified; CM6's changelog through 2026-10-19 was still fixing Chrome Android
   and iOS composition/selection behaviour.
4. The composer is untouched: it is a `<textarea>` and must stay one.

Acceptance met: `mobile.e2e.ts` / `mobile-dock.e2e.ts` / `mobile-files.e2e.ts` /
`mobile-editor.e2e.ts` green on `mobile-chromium`; no change to composer
behaviour. Outstanding: the emulator checklist in (2) and the shell pass in (3).

**One bug this phase found, which no unit test could:** the phone's editor was
wrapped in an `overflow-auto` div, and `height: 100%` against an auto-height box
resolves to `auto` — so the surface grew to the document's full height and the
panel had nothing to scroll (`scrollHeight === clientHeight`, measured 3 624 px
in a 3 624 px box). The fix is structural: the code surface is a SIBLING branch
that is not wrapped, and only the states that own their own content (loading,
refusal, failed read, markdown preview) keep the scroller.

## Test strategy

Unit tests can run CM6 under happy-dom — verified: mount, dispatch, undo/redo,
multi-cursor, search panel, decorations, merge chunks and `syntaxTree` all work
with three shims (`globalThis.Window`, `requestAnimationFrame`,
`getComputedStyle`; without `Window` the view throws `ReferenceError: Window is
not defined` from `isScrolledToBottom`). Two limits, both measured:

- **Geometry is not testable there**: `getBoundingClientRect()` is 0,
  `coordsAtPos()` returns `null`, and `view.lineWrapping` never flips because the
  injected stylesheet is not resolved. Anything about rows, wrap or scroll band
  belongs to the e2e layer.
- Assertions must be about state and DOM structure (document text, selection
  ranges, decoration classes, gutter elements), never about pixels.

New unit coverage, as it landed: `keymap.test.ts` (every `EDITOR_KEY_BINDINGS`
row resolves to a chord on both platforms, and no two rows claim one),
`documents.test.ts` (per-tab undo isolation, the caret surviving a switch, the
LRU bound, read-only), `extensions.test.ts` (the `languageData` shape that makes
`toggleComment` work, plus the wrap/read-only compartments), and
`comment-syntax.test.ts`. The Shiki decoration builder has no unit test: its
window maths are CM6's viewport and its output is a `DecorationSet` over a
viewport happy-dom does not compute, so it is covered by `editor.e2e.ts` and by
the typed-text assertions in `find.e2e.ts`.

Specs rewritten (all were bound to the old surface): `editor.e2e.ts`,
`editor-scroll.e2e.ts`, `outline.e2e.ts`, `search-panel.e2e.ts`, plus
`fixtures/selectors.ts`'s `editorScroller`. New: `find.e2e.ts`,
`diff-panel.e2e.ts`, `editor-commands.e2e.ts`, `mobile-editor.e2e.ts`.
`composer-stretch.e2e.ts` and `terminal.e2e.ts` mention `textarea` but never the
editor — left alone.

## Risks

| Risk | Evidence | Mitigation |
|---|---|---|
| Mobile/IME regressions | CM6 6.43.x changelog fixes Chrome Android select-all/scroll-on-tap and iOS Shift+Enter, composition and native cursor alignment | Phase 4 device run before cutover; desktop shells keep the same WebView rules |
| e2e locators break by construction | `editor.e2e.ts` uses `locator('textarea')` and `toHaveValue`; `outline.e2e.ts` reads `selectionStart`/`selectionEnd` off the textarea | Rewrite in Phase 1, with the assertion moved to the observable that actually changes (`view.state.selection`, the file on disk) |
| happy-dom cannot assert geometry | measured above | Keep geometry claims in e2e; keep unit tests on state |
| Drop-to-open stops working | CM6's `contentDOM` is a `contenteditable` host and may claim drag events | Keep `useEditorDrop` on the wrapping element. NOT covered by a spec: the editor's drop path has no e2e case, and the harness has no way to synthesise a Finder drag. `useEditorDrop`'s own unit test covers the counter and the refusal shapes. |
| Panel resize fights CM6's measurement | the panel animates its width for 200 ms; the current surface pays for that with a 600 ms restore replay and a hidden mirror measuring every line | CM6 owns the measurement (verified: it constructs its own `ResizeObserver` and re-measures on layout change), so the replay can collapse to one write on `view.scrollDOM`; if a wrap re-flow still lands late, keep a short replay rather than porting the mirror |
| Stored scroll offsets do not match the new line heights | `editor.scrollPositions` is px of the old scroller | Treat stored offsets as best-effort (same as today), keep the key and the per-surface split; do not migrate or clear |
| 350-line ceiling | `code-surface/index.tsx` was 348 lines and grows when it owns the mount | Split as listed; the shipped modules are `index.tsx` 324, `keymap.ts` 256, `shiki.ts` 197, `extensions.ts` 149, `documents.ts` 140, `theme.ts` 91, `marks.ts` 74 |

## Non-goals

No lezer grammar packages in Phase 1–3 (no folding, no bracket matching, no
`indentOnInput`, no autocomplete). No `@codemirror/language-data` (639 KB gz — use
per-language dynamic imports if lezer arrives later). No vim/emacs keymaps. No
collaborative editing. No replacement of Shiki in the chat timeline, diff parser
output, wiki or markdown preview. No change to the composer, the search panel or
the terminal.

## Rollback

Editor-only, with no schema change and no state migration: the stored keys
(`editor.findQuery`, `editor.findReplace`, `editor.findOptions`,
`editor.scrollPositions`, `editor.mobileScrollPositions`, `layout.openedFiles`)
keep their shapes, and reverting a phase is reverting its commit. The surface is
reached from exactly three places (`FileDocument`, `FullEditor`, and the
type-only imports in `use-line-jump` / `use-editor-outline-bridge`), so no other
subsystem can be left half-migrated.

## Open questions — resolved

1. **Kabmo's `FindWidget` was kept**, and it was the right call for a reason the
   plan did not state: the widget owns the persisted query and the option
   toggles, and CM6's panel has no persistence at all. Only its matcher changed.
   The one thing the move cost was a bug in the widget's geometry — it was
   330 px wide in a 320 px panel, so its leftmost control was unreachable.
2. **Scroll is a px offset on the scroller**, as planned. `scrollSnapshot()`
   cannot be serialized and the offset has to survive a reload.
3. **No lezer grammars.** Nothing has asked for folding, and the decoration
   plugin already covers all 59 languages.

Two new questions the migration raises:

4. **Should the outline stop re-scanning the whole buffer per keystroke?** At
   20 000 lines with the Files panel open, a keystroke costs ~165 ms and the
   profile is Shiki's `findNextMatchSync` inside `extractOutline`. It is not a
   regression (the outline always ran on every content change) but it is now the
   slowest thing in the editor's neighbourhood, and a debounce or a
   viewport-scoped scan would fix it.
5. **Should the diff panel's Split view have its own word-wrap control?** It
   shares `diff.wordWrap`, but the two shapes wrap differently (a split row has
   half the width), so a reader who wants wrapping in Unified may not want it in
   Split. Left shared because one setting that means "wrap" is easier to reason
   about than two that can disagree.

## Verification

Re-measured after the migration, on the same harness and the same 1440×900
viewport. Every figure below is from a throwaway Playwright spec driving the
assembled app, not from a unit test.

| Claim | Result |
|---|---|
| One keystroke at 4 800 lines, synchronous cost of the edit | **0.2 ms median, 0.5 ms p95** (baseline 59.6 / 78.1) |
| One keystroke at 20 000 lines | **0.3 ms median, 0.4 ms p95** — flat, as the plan predicted |
| Rendered `.cm-line` nodes at 20 000 lines | **54** (the budget was ≤ 200) |
| `<textarea>` inside the editor panel | **0** |
| Wrap toggle, 600-char single line in a 320 px panel | `scrollWidth 320 = clientWidth 320` wrapped → **4 525** unwrapped |
| ⌘D twice | two cursors; typing edits both; **one** ⌘Z reverts both |
| Find on a 200-line file (`alpha1`) | count **111**, one `data-find-current`, stepping moves it |
| Replace all | one ⌘Z restores the file |
| Invalid regex | `Invalid pattern`, distinct from `No results` |
| Mount of a 20 000-line file | ~1.6 s from click to content, including the read |
| The contenteditable's input attributes | `spellcheck=false`, `autocorrect=off`, `autocapitalize=off`, `translate=no`, `role=textbox` — pinned by `editor.e2e.ts` |

The keystroke figures are the SYNCHRONOUS cost of the DOM edit (what the plan's
baseline measured). A frame-level figure is dominated by the browser's own
compositing and reads ~17 ms at any document size, which is why it is not the
number quoted here.

Two measurements that surprised, both worth keeping:

- **The outline consumer, not the surface, was the slow path at 20 000 lines.**
  With the Files panel on screen a keystroke cost ~165 ms; with Search on screen
  it cost ~17 ms and the CPU profile showed Shiki's `findNextMatchSync` at 15%.
  The outline re-scans the whole buffer per keystroke (`extractOutline`), which is
  a property of that panel and not of the editor — it is left as it is here
  because changing it is a different decision, but it is the next thing to fix if
  a large file with the outline open feels slow.
- **The find bar was wider than the panel it lives in** (330 px fixed, in a 320 px
  panel), so its leftmost control hung past the panel edge and a click on it
  landed on the panel beside it. `max-w-[calc(100%-1rem)]` fixed it; the spec
  clicks the control.
- **`applyDocument` must NOT be silenced as an "external" write.** The guard
  exists so a write that came FROM the parent does not echo back; a replace is a
  user edit, so suppressing it left the parent holding the pre-replace buffer —
  the autosave never saw the change, and the next render compared the stale
  `value` against the document and wrote the OLD text back. Measured: replace-all,
  switch tab, come back → the original text and nothing on disk. `find.e2e.ts`
  now asserts both the bytes on disk and the buffer after a tab switch.

### What shipped, in one list

- `code-surface/` is seven modules: `index.tsx` (mount, handle, external sync),
  `extensions.ts` (the extension stack and the two compartments), `shiki.ts` (the
  viewport decoration plugin), `keymap.ts` (CM6 bindings generated from
  `EDITOR_KEY_BINDINGS`), `theme.ts`, `documents.ts` (the per-tab `EditorState`
  cache), `marks.ts` (find marks as a state field).
- Deleted: `code-editor/`, `code-surface/measure.ts`, `use-code-window`,
  `use-editor-history`, `use-occurrences`, `scroll-container`,
  `shared/lib/code/{lazy-window,windowed-highlight}`,
  `shared/lib/code/editor/{history,layers,edits,text-commands,occurrences,reset-css}`,
  `diff-panel/{UnifiedView,SplitView}`, `shared/lib/fs/diff-parser`.
- Split: `find.ts` → `find-scan.ts` (the `RegExpCursor` walk) +
  `find-replace.ts` (template expansion), because a caller that only paints
  matches should not carry the replacement grammar.
- New specs: `find.e2e.ts`, `diff-panel.e2e.ts`, `mobile-editor.e2e.ts`; and
  `keymap.test.ts`, `documents.test.ts`, `patch-sides.test.ts` for the parts a
  browser is not needed to prove.
