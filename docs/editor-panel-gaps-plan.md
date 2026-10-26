# Editor panel — missing features and fixes, with the tradeoff for each

Research + plan for the code editor panel (`src/client/components/workspace/editor/`,
the shared surface in `src/client/components/common/code-surface/`, and the phone's
full-screen editor in `src/client/components/mobile/mobile-right-sidebar/FullEditor.tsx`).

Status: **P0–P5 implemented and verified**, with two items deliberately not built (§5:
Save As, split editor) and one rejected (format-on-save). Every claim was read out of the
tree at `ae318411` or measured with a throwaway script; the measurements that changed the
plan are recorded verbatim in *Appendix A*, and *Appendix B* lists what shipped and what
was found while building it.

Two things to read first, because they invalidate the obvious version of this document:

1. **The surface already auto-indents for most languages.** `ae318411` installed a
   `StreamLanguage` per Shiki id, and a legacy stream mode ships its own `indent()`.
   Measured (A.2): 34 of the 48 mode-backed languages answer `getIndentation`, and Enter
   after `{` already indents. The gap is narrower than "no auto-indent" — it is the 14
   modes that answer nothing plus the 12 languages with no mode at all.
2. **`indentOnInput` is missing, and that is the one-line fix with the widest reach.**
   Measured (A.3): with the stream mode installed, adding `indentOnInput()` alone makes a
   typed `}` dedent in every language whose mode ships an `indentOnInput` regexp (27 of
   48). Without it, nothing dedents anywhere.

Scope excluded by request: LSP. Also out of scope because they are different products:
the diff panel (merge view, staging, conflict resolution) and the wiki/markdown readers.

---

## 1. What exists today (verified inventory)

`surfaceExtensions` (`code-surface/extensions.ts:118-201`) installs: `lineNumbers`,
`history`, `drawSelection`, `dropCursor`, `rectangularSelection`, `crosshairCursor`,
multi-selection, `indentUnit('  ')`, a `languageCompartment` payload (the stream mode),
a manual `commentTokens` languageData table, `findMarksField`, `bracketMatching`,
`bracketGuide`, `indentFoldService` + `foldGutter`, `shikiHighlight`, `surfaceTheme`,
compartments for wrap/read-only/theme, content attributes, an update listener, and
`surfaceKeymap` with CM6's `defaultKeymap` appended.

| Area | Present |
|---|---|
| Find/replace | ⌘F / ⌥⌘F, case, whole-word, regex, `N of M` with a 5 000 cap, replace one/all as one undo step |
| Multi-cursor | ⌘D next occurrence, ⇧⌘L all occurrences, ⇧⌘D cursor below |
| Line ops | move/copy/delete line, insert above/below, indent/outdent, toggle LINE comment |
| Folding | indent-based `foldService` + fold gutter + fold/unfold/all |
| Brackets | `bracketMatching` (token-aware where a stream mode is loaded, textual elsewhere) + the vertical pair guide |
| Parsing | `StreamLanguage` per Shiki id, lazy, 48 of 59 languages; 12 textual-only |
| Auto-indent | **partial** — whatever the stream mode's own `indent()` answers (34 of 48); nothing on input |
| Palette | ⌘⇧P, entries derived from the keymap table |
| View | word wrap, zoom 8–24px, editor font, 65 editor themes, full screen, compact/full modes |
| Files | tabs with missing-file strike-through, diff→editor conversion, drop-to-open, 32 MiB ceiling, byte viewers |
| Persistence | debounced autosave 800 ms, explicit Save, deleted-file confirmation, per-tab undo (LRU 12), per-tab scroll restore |

---

## 2. Gaps, with the evidence for each

### 2.1 Data-loss class (the reason this plan exists at all)

**G1 — No `indentOnInput`, so a typed closer never dedents in 21 languages, and never
dedents by the surface's own rule anywhere.** `rg indentOnInput` over
`code-surface/*.ts` → **0 occurrences**. Measured (A.3): the same keystroke, with and
without it —

```
typescript  off="if (x) {\n  }"   on="if (x) {\n}"
go          off="func f() {\n  }" on="func f() {\n}"     // mode regexp differs from ours
perl        off="if ($x) {\n  }"  on="if ($x) {\n  }"     // mode ships NO regexp
yaml        off="a:\n  }"         on="a:\n  }"            // no mode at all
```

**G2 — A file changed outside the editor is never noticed.** The editor subscribes to no
realtime topic (`rg useRealtimeTopic` over `client/hooks/editor` and
`client/components/workspace/editor` → 0 hits). The only re-read is `refreshKey`
(`editor/index.tsx:153-156`), bumped by a manual Refresh and by `onFileSaved`. The server
already publishes what is needed: `fs:<scope>` resolves a directory listing
(`realtime/topics/workspace.server.ts:61-71`), and `workspace-dirty` republishes every
watched `fs:`/`git:` topic (`topics.server.ts:136-140`), fired from `tool_execution_end`
and `agent_end`. With the 800 ms autosave (`use-file-writes.ts:159-163`) the failure is
concrete: the agent writes a file, the user's stale buffer autosaves over it.

**G3 — A save has no conflict check.** `actionType=save` (`routes/fs/action.ts:94-106`)
writes unconditionally: no mtime, no ETag, no `If-Match` (`rg baseMtime|mtimeMs` over the
fs routes and the editor hooks → 0). Two tabs, or one tab plus a tool call, silently
last-writer-wins.

**G4 — No unsaved-changes guard anywhere.** `isDirty` is computed
(`use-file-editor.ts:164`) and consumed by **nothing** in the editor panel
(`rg isDirty` over `components/workspace/editor` and `components/mobile` → 0).
`handleCloseFile` filters the tab out immediately (`file-tabs.ts:158-167`). There is no
`beforeunload` in `src/` at all. The tab strip has no dirty mark to warn with.

**G5 — No revert / reload from disk.** `rg 'revertFile|reloadFromDisk|discardChanges'`
→ 0. `editor.reset()` exists but is the workspace-refresh path, is not in the UI, and
deliberately refuses a dirty buffer.

### 2.2 Indentation, precisely (this is the corrected version of the obvious claim)

Measured over the whole mode table (A.1, A.2):

| Bucket | Count | Behaviour today |
|---|---|---|
| Mode answers `getIndentation` | 34 | Enter indents correctly; typed closer dedents only in the 27 whose mode ships an `indentOnInput` regexp |
| Mode present, answers nothing | 14 | `bash, dockerfile, haskell, hcl, ini, makefile, ocaml, perl, powershell, properties, protobuf, sql, toml, yaml` — Enter does NOT indent |
| No mode at all | 12 | `markdown, html, diff, graphql, nix, svelte, astro, vue, zig, solidity, php, text` — same |

So the honest statement is: **Enter already works in 34 languages and fails in 26**; and
**a typed closer dedents in 27 and fails in 32**. Both numbers are worth fixing, and both
are cheap.

### 2.3 Standard editor features that are absent

| # | Gap | Evidence |
|---|---|---|
| G6 | **Go to line** (⌘G) | `rg gotoLine` → 0 |
| G7 | **Quick open by filename** (⌘P) | `palette.ts:30-68` lists editor commands only; `/api/fs/list` (flat index, 3 000 cap, `SKIP_DIRS`) already exists and feeds the composer's `@` picker |
| G8 | **Tab management**: drag-reorder, Close Others/All, Reopen Closed, ⌘1..9, ⌃Tab | `Tabs.tsx` renders select + close only (`rg draggable|onDragStart` → 0) |
| G9 | **Desktop status bar** (Ln/Col, indent, EOL) | `rg StatusBar` over `components/workspace/editor` → 0; the phone's strip prints only `N lines · N chars · LANG` |
| G10 | **Highlight active line** | `rg highlightActiveLine` → 0 |
| G11 | **Highlight other occurrences of the selection** | `rg highlightSelectionMatches` → 0 |
| G12 | **Whitespace / special chars / INDENT guides** | `highlightSpecialChars`, `indentGuide` → 0. Note the bracket pair guide that shipped in `ae318411` is a different feature: it connects a brace to its pair, not each nesting level |
| G13 | **Tab size / indent width** (hardcoded 2 spaces, no setting, no detect) | `extensions.ts:56` `const INDENT = '  '`; `rg tabSize` → 0 |
| G14 | **Toggle BLOCK comment** | `toggleBlockComment` exported by `@codemirror/commands`, unused; only line comments are bound |
| G15 | **Line transforms**: join, sort, case, trim trailing, final newline | all 0 |
| G16 | **Formatter / format on save** | no prettier/biome in `package.json`; `rg formatDocument` → 0 |
| G17 | **Manual language override** | language comes from the extension only |
| G18 | **EOL / encoding UI** | EOL is detected and preserved on write, never switchable; UTF-8 only, no BOM handling |
| G19 | **Git gutter / blame in the editor** | only the diff panel has gutter marks |
| G20 | **Find in selection, find history, "find in workspace" from the editor** | `FindWidget.tsx` has neither |
| G21 | **Find on the phone** | `FullEditor.tsx` imports neither `FindWidget` nor `useEditorFind` |
| G22 | **Ctrl+wheel zoom** | zoom is button-only (`Toolbar.tsx:254-282`) |
| G23 | **Split editor** | one column, one `activeFileId` |
| G24 | **Breadcrumbs / sticky scroll / minimap** | 0 |
| G25 | **Save As** | only save-to-own-path |
| G26 | **Auto-close brackets/quotes** | `@codemirror/autocomplete` is not a dependency (installed: `commands, language, legacy-modes, merge, search, state, view`); `closeBrackets` lives there |
| G27 | **Autocomplete** | same missing package |
| G28 | **Auto-save on/off** | autosave is unconditional |
| G29 | **`scrollPastEnd`** | `rg scrollPastEnd` → 0; the last line cannot be centred |

### 2.4 Features that exist but are unreachable

| # | Finding |
|---|---|
| G30 | `selectWord` and `selectLine` are implemented in `BUFFER_COMMANDS` (`code-surface/keymap.ts:148-149`) but have no row in `EDITOR_KEY_BINDINGS`, so no chord and no palette entry — and `palette.test.ts:50-52` asserts `selectWord` must not be listed |
| G31 | `addCursorAbove` is reachable only through CM6's `defaultKeymap`; its sibling `addCursorBelow` has a Kabmo row, so the palette lists one of a pair |
| G32 | Per-tab undo history is capped at 12 documents (`documents.ts:35`) — the 13th open tab silently loses its undo stack |

---

## 3. Plan

Ordering: **data-loss first, then indentation (the visible quality gap), then cheap
ergonomics, then view aids, then the items that need a dependency.** Each phase ships
alone and is verified alone.

### P0 — Stop losing work (G2, G3, G4, G5)

**P0.1 External-change detection** (`hooks/editor/use-external-change.ts`, new)

- Subscribe to `fs:<scope>` for the ACTIVE tab's scope only, via `useRealtimeTopic`. The
  topic resolves a directory listing, so on a frame the editor asks a cheap probe for the
  one file's mtime (P0.2 adds it) instead of re-reading the bytes.
- Three verdicts, and the difference IS the feature: buffer clean → re-read silently;
  buffer dirty and the disk copy moved → inline strip *"This file changed on disk.
  **Reload** / **Keep mine**"*; file gone → the existing strike-through already covers it.
- A refused probe is not a verdict — the same rule `useMissingFiles` documents.
- Deliberately NOT a server-side `fs.watch`: `workspace-dirty` already republishes after
  every tool call and run end, and a per-file watcher is a new process-wide resource for
  one decoration.

**P0.2 Write conflict guard** (`routes/fs/action.ts` + `save-file.ts` + `read.ts`)

- `/api/fs/read` returns `mtimeMs` beside `content`; `saveEditorFile` sends it back as
  `baseMtime`; the save route stats first and answers `409` with the current mtime when
  they differ. The client turns a `409` into the same Reload/Keep strip as P0.1.
- A save with no `baseMtime` (handle-backed file, older client) keeps today's behaviour —
  the guard must never turn a legitimate write into a refusal.
- `missing`/`allowMissing` stay the outer gate.

**P0.3 Dirty marks + close guard** (`Tabs.tsx`, `file-tabs.ts`, `index.tsx`)

- `OpenedFile.isDirty` already exists (`shared/types/fs.ts:19`) and is never written.
  Publish per-tab dirtiness through the store the outline already uses
  (`client/lib/editor-document.ts`), so a background tab keeps its dot.
- A dirty tab draws `●` in the close `×` slot (the VS Code convention: the dot becomes
  the × on hover) — no extra column, no layout shift.
- Closing a dirty tab asks: *Save & close* / *Discard* / *Cancel*. Closing a CLEAN tab
  stays instant — a guard that fires on every close is one people learn to dismiss.
- `beforeunload` is armed only while some tab is dirty, and removed when none is.

**P0.4 Revert** — a `Revert` row in the toolbar's `⋯` cluster (never pinned; it is
destructive), enabled only for a dirty buffer, asking first. It reuses `reset()` plus the
P0.2 read, so there is no second read path.

**Acceptance**: with an agent writing a file under an open dirty tab, the strip appears
and no bytes are lost either way; a dirty tab survives a reload prompt.

### P1 — Indentation (G1, G13, plus the 26 languages Enter fails in)

**P1.1 `indentOnInput` + a per-language fallback rule** (`code-surface/indent.ts`, new)

Two separate pieces, and the order matters.

1. **`indentOnInput()` plus the surface's own regexp table.** One line of extension plus
   the languageData entry the manual table already knows how to carry. Measured (A.3):
   this alone fixes the typed-closer dedent in 27 languages, and it is what makes the
   mode's own `indent()` reach the input path at all.
2. **A fallback `indentService` that stands DOWN where the mode answers.** Measured (A.4):
   an `indentService` returning a number OVERRIDES the mode (`js: 11 → 0` with a crude
   service); returning `undefined` falls through to the mode (`11 → 11`). So the service
   is a table keyed by language, and it returns `undefined` for every mode that answers —
   only the 26 blind languages get a rule.

The rule table, per family (measured in A.5):

| Family | Opens a level | Closes |
|---|---|---|
| `yaml` | line ends with `:` (and `- ` blocks) | — |
| `toml`, `ini`, `hcl`, `protobuf` | line ends with `{` or `[` | matching closer |
| `dockerfile` | line ends with `\` (continuation) | — |
| `bash`, `powershell`, `perl` | `then`/`do`/`{` | `fi`/`done`/`esac`/`}` |
| `haskell`, `ocaml` | `=`/`where`/`do`/`then` | — |
| `sql`, `makefile`, `properties` | nothing (no reliable textual rule) | — |
| `markdown` | nothing — a list item keeps its indent | — |
| `html`, `graphql`, `nix`, `svelte`, `astro`, `vue`, `zig`, `solidity`, `php` | line ends with `{` or an open tag | matching closer |

Verified effect (A.5): `yaml a:` → indents, `toml a = {` → indents, `bash if true; then`
→ indents, `dockerfile RUN … \` → indents, `hcl resource … {` → indents, `markdown - item`
→ unchanged (correct), `sql SELECT … WHERE` → unchanged (correct).

**Why a table and not one bracket rule.** Measured (A.6): a single bracket-depth rule
gives `markdown > quote` and `yaml a:` nothing, and over-indents a string containing `{`.
A table of eight shapes is smaller than the special cases a single rule accumulates, and
each row is one line a reader can check.

**Files**: `code-surface/indent.ts` (~80 lines: the table + the service), a new
`shared/lib/code/editor/indent-rules.ts` (pure `indentForLine(language, text)` so it is
unit-testable without a DOM), `extensions.ts` (+3 lines). The mode-aware gate reads
`readyStreamMode(language)` from `stream-language.ts`, which already exists.

**P1.2 Tab size / indent width** — `editor.tabSize` (2/4/8) in the settings blob, applied
as `EditorState.tabSize` + `indentUnit`, with detection from the file's own leading
whitespace on first open and the detected value shown in the status bar (P2.1). This is
what makes P1.1 correct outside a 2-space repository: every rule above emits `indentUnit`,
so the setting propagates with no second table.

**Cons, stated plainly**: with no grammar, `yaml` cannot tell a `:` inside a string from a
key, `bash` cannot tell `then` in a comment, and `markdown` gets nothing at all (correct —
a `- item` that indented would be wrong). Each of those is a documented row, not a bug
report, and every one of them only affects Enter's initial indent, which the user can
immediately change.

### P2 — Daily ergonomics (G9, G6, G7, G10, G11, G29, G30, G31)

**P2.1 Desktop status bar** (`editor/StatusBar.tsx`, new; mounted in `FilePane.tsx`) —
`Ln 12, Col 34` · `Spaces: 2` · `UTF-8` · `LF` on the left, the save state on the right
(reuse the phone strip's wording so the two layouts agree). Ln/Col comes from a new
`getSelectionInfo()` on `CodeSurfaceHandle`, not from the DOM attributes the update
listener writes. Hide below a container HEIGHT, the way `ToolbarRow` hides by width.

**P2.2 Go to line** — ⌘G, one-field dialog, clamp to `doc.lines`, then
`handle.select(offset, offset)` + `revealOffset`. The chord must also be added to
`EDITOR_KEY_BINDINGS` and `PALETTE_ORDER`, or the palette lists a command with no chord.

**P2.3 Quick open** — ⌘P, fuzzy match over `/api/fs/list`, Enter opens through the
existing `handleOpenFile`. Cache the index per `root\0repo` for the session and invalidate
on `workspace-dirty`; share that cache module with the composer's `@` picker so the two
do not grow two budgets.

**P2.4 `highlightActiveLine` + `highlightSelectionMatches`** — two extensions, both themed
from the palette (the package defaults are hardcoded hex — the trap `matchingBracket`
already documents). Cap the selection-match count or a common word paints the viewport.

**P2.5 `scrollPastEnd()`** — one line; without it the last line cannot be centred, which
is what makes a long file feel cramped at the bottom.

**P2.6 Close the dead ends** — bind `selectLine`, delete `selectWord` (⌘D on a bare caret
already selects the word, which is what people reach for), add `addCursorAbove` to the
keymap table so the pair is symmetric. `palette.test.ts` flips from asserting its absence
to asserting it is gone from the union.

### P3 — Tab management (G8, G25)

**P3.1 Tab actions** — a context menu (the panel already has that pattern in
`file-explorer/ContextMenu.tsx`): Close, Close Others, Close All, Close Saved, Copy Path,
Reveal in Files. Reopen Closed as a bounded stack (10) in session UI state, `⌘⇧T`; it
needs the closed `OpenedFile` kept whole, so it lives next to `handleCloseFile`.
Drag-reorder is HTML5 drag on the strip; the array IS the order, so reordering is an array
move with no new field — but it must cooperate with the existing `maxVisibleTabs` +
`Older Tabs` overflow computation, so ship the menu first and treat drag as optional.

**P3.2 Save As** — SHIPPED (Appendix D). A destination folder plus a name, a collision guard
that REFUSES rather than overwrites, and the original tab left open beside the new file's.

### P4 — View aids (G12, G18-partial, G22)

**P4.1 `highlightSpecialChars()`** — a stray control character currently renders as
nothing, which makes a corrupted file look fine.

**P4.2 Indent guides** — a `ViewPlugin` drawing a left border per nesting level for the
viewport, capped by line length. Grammar-free for the same reason `fold.ts` is. Must be
visually distinct from `bracket-guide.ts`'s pair rule (that one sits under the opening
brace; this one at each level's column) — otherwise two lines that mean different things
look identical.

**P4.3 EOL switch** — a status-bar control that sets `eol` for the NEXT save. The write
path already carries the field; this is a UI over an existing capability.

**P4.4 Ctrl+wheel zoom** — a wheel listener with `ctrlKey` + `preventDefault`, clamped to
the shared 8–24px bounds, inert over nested scrollers.

### P5 — Needs a dependency or a new surface (G14, G15, G26, G27, G19, G20, G21)

**P5.1 Toggle block comment** — free: the command is installed and `commentTokens` already
returns block tokens for CSS/HTML/Markdown. One keymap row. Inert where the language has
only line comments, which is honest.

**P5.2 Line transforms** — join lines and trim-trailing-whitespace-on-save first (no
options); sort/case behind a dialog if anyone asks.

**P5.3 Auto-close brackets** — needs `@codemirror/autocomplete` (~40 KB gz, in the lazy
editor chunk) purely for `closeBrackets`. Behaviour change for every user, so behind a
setting defaulting ON. Interacts with P1.1: typing `{` and getting `}` must then indent
between them.

**P5.4 Document-words autocomplete** — same package. The honest scope is "words from the
viewport ± 500 lines, capped, debounced"; anything beyond is LSP, which is out of scope.

**P5.5 Find in selection / find history** — small, low-risk filler.

**P5.6 Find on the phone** — the phone editor has no way to search a file at all. The
330px floating card must become a full-width row under the header. No palette on the
phone (it would need a button and a touch-shaped list).

---

## 4. Pros and cons, per item

### P0.1/P0.2 External change + conflict guard

**Pros** — removes a data-loss path that exists today whenever an agent edits an open
file. Uses the realtime plumbing already there; no polling, no new server resource. The
`409` is the honest contract that makes multi-tab editing safe.
**Cons** — one more field on the write path (`baseMtime`) that a handle-backed file cannot
supply, so that path keeps old semantics; a `409` needs UI or it reads as "save failed".
The `fs:` payload is a directory listing, so the editor needs a small probe per frame —
bounded by subscribing only to the active tab's directory.

### P0.3 Dirty marks + close guard

**Pros** — `isDirty` already exists and is dead; wiring it is mostly plumbing. The dot
costs no layout. Guarding only dirty tabs is what keeps it bearable.
**Cons** — `beforeunload` is the browser's own modal, unstyleable. Mitigation: armed only
while dirty. Per-tab publishing needs a store write per keystroke — debounce it, or key it
off the autosave's 800 ms boundary.

### P1.1 Indentation

**Pros** — the largest visible quality jump available for the least code. `indentOnInput`
alone is one line and fixes 27 languages' dedent. The fallback table is ~80 lines and
fixes Enter in the 26 that currently do nothing. Grammar-free, so it covers all 59 ids.
Measured to stand down correctly where a mode answers (A.4).
**Cons** — a per-language table is a thing to maintain when a mode later grows its own
`indent()`; mitigate by gating each row on `readyStreamMode(language)` and having a test
assert that a language whose mode answers is NOT in the table. The rules are textual:
`yaml` cannot see a `:` inside a string, `bash` cannot see `then` in a comment, and
`markdown`/`sql`/`makefile` deliberately get nothing.

### P1.2 Tab size

**Pros** — required for P1.1 to be right outside a 2-space repo; one setting, one facet.
**Cons** — detection is a heuristic; a file indented with aligned continuation lines
detects wrong. Show the detected value and let the override stick per session.

### P2.1 Status bar

**Pros** — makes indent/EOL/position discoverable and is the anchor every later view
setting needs. Reuses the phone's vocabulary so the layouts agree.
**Cons** — ~20px of vertical space in a panel that is 320px wide on a 1440px screen;
hide below a container height or it competes with the toolbar.

### P2.2 Go to line / P2.3 Quick open

**Pros** — pure UI over existing capabilities (`select` + `revealOffset`; `/api/fs/list`).
Quick open is the fastest route to a file the reader has not expanded.
**Cons** — Quick open duplicates a little of the composer's `@` picker; share one index
cache. Go to line is nearly free but rarely used by people who already use the outline.

### P2.4/P2.5 Active line, selection matches, scrollPastEnd

**Pros** — three one-liners with a large readability payoff; all need palette theming.
**Cons** — `highlightSelectionMatches` on a common word paints a lot of the viewport; cap
it and keep the colour subtler than the find bar's.

### P3.1 Tab actions

**Pros** — Close Others/All and Reopen Closed are the two operations people miss most
once they keep ten tabs; both are array operations over existing state.
**Cons** — drag-reorder is real work (pointer events, autoscroll, keyboard accessibility)
and must cooperate with the width-driven overflow menu. Ship the menu first.

### P4.2 Indent guides

**Pros** — what makes 4-space YAML and 2-space TS readable side by side.
**Cons** — a viewport heuristic: an alignment-indented continuation line gets a guide it
should not have. Also must be visually distinct from the bracket pair guide.

### P5.3 Auto-close brackets

**Pros** — expected by anyone who has used an editor; prevents the most common typo.
**Cons** — a dependency purely for `closeBrackets`, plus a behaviour change for people who
do not want it (hence a setting), plus an interaction with P1.1.

### P5.4 Autocomplete

**Pros** — a document-words completer is genuinely useful and needs no server.
**Cons** — a naive one is a scan per keystroke on a large file; the honest scope is a
bounded viewport window. Anything more is LSP.

### P5.6 Find on the phone

**Pros** — the phone editor currently cannot search a file at all.
**Cons** — a second shape of the same widget (full-width row, not a floating card).

---

## 5. Explicitly rejected / deferred

| Item | Verdict | Why |
|---|---|---|
| LSP | out of scope by request | a language server per language plus a process model |
| Formatter / format on save | rejected | needs Prettier (~2 MB + plugins) or a spawn per save; the terminal and the agent already do this |
| `git blame` in the editor | rejected | a `git blame` per file per open, for one line of metadata |
| Git gutter | deferred, bounded | only worth it for the active tab, on save and on `workspace-dirty`, cached by mtime |
| Minimap | rejected | a canvas redrawing on every edit for a 320px panel; the outline answers "where am I" |
| Sticky scroll | deferred | needs scope headers, i.e. a grammar, or a heuristic over the indent fold |
| Breadcrumbs | deferred | duplicates the outline panel that is already open |
| Save As | **shipped** | Appendix D — `saveAs` action, collision refused with 409, new file gets its own tab |
| Split editor | **shipped** | Appendix D — divides the editor panel's own width, so `panel-widths.ts` is untouched |

---

## 6. Cross-cutting constraints

1. **No grammar.** `extensions.ts` and `fold.ts` state the decision, and `stream-modes.ts`
   now reinforces it: a lezer grammar covers 24 of 59 ids for +439 KB gzip and is wrong
   until its lazy parse catches up, while a stream mode is ~1 KB and correct at mount.
   Every structural feature here is therefore textual, and each must say what it gets wrong.
2. **A stream mode's answer WINS.** Measured (A.4): an `indentService` returning a number
   overrides the mode. So any fallback must return `undefined` for a language whose mode
   answers, and a test must assert that gate — otherwise the fallback silently degrades 34
   languages that currently work.
3. **350 lines per file.** `index.tsx` 326, `editor/index.tsx` 338, `Toolbar.tsx` 336,
   `FullEditor.tsx` 342, `code-surface/keymap.ts` 272. Every new feature lands in its own
   module and is wired by 2–5 lines.
4. **`CodeSurfaceHandle` is the contract.** New capabilities go through the handle, not a
   second CM6 import in a component.
5. **One source per fact.** A chord lives in `EDITOR_KEY_BINDINGS`; the palette derives
   from it; the tooltip prints the same string.
6. **Mobile parity is a decision, not an afterthought.** State per feature whether the
   phone gets it (status bar: yes; palette: no; find: yes, phone-shaped).

---

## 7. Verification plan

| Phase | Unit | Browser (Playwright) | Manual |
|---|---|---|---|
| P0.1/P0.2 | `use-external-change.test.ts` (clean/dirty/gone/refused), `action.test.ts` 409 | new `editor-conflict.e2e.ts`: two writers, one file | agent edits an open file |
| P0.3/P0.4 | `file-tabs.test.ts`: dirty survives, close asks | `editor.e2e.ts`: dot appears, confirm on close | close a dirty tab |
| P1.1 | `indent-rules.test.ts`: the table per language + the mode gate (a language whose mode answers must return `undefined`) | `editor-commands.e2e.ts`: Enter after `{` in TS, YAML, bash; typed `}` dedents | type a block in YAML and TS |
| P1.2 | `tab-size.test.ts` | `editor-theme.e2e.ts` extension | a 4-space repo |
| P2 | `status-bar.test.tsx`, `palette.test.ts`, `go-to-line.test.tsx` | `editor-commands.e2e.ts` | ⌘G on a 3 000-line file |
| P4 | `whitespace.test.ts`, `indent-guide.test.ts` | `editor-theme.e2e.ts` extension | YAML with 4-space indent |

Gates, unchanged: `bun run lint`, `bunx tsc --noEmit --noUnusedLocals
--noUnusedParameters`, the 350-line check, the relative-import check, `bun run build`.

---

## 8. Open questions

1. **Auto-close brackets ON by default?** For: every editor does it. Against: it changes
   typing and a wrong auto-close is more annoying than a missing one. My default: ON, with
   a setting.
2. **Tab size per session or per file?** My default: detect per file, override per session.
3. **Should the phone get the command palette?** It has no keyboard. My default: no.
4. **Do the 14 blind modes deserve their own upstream fix?** `yaml`/`bash`/`toml`/`sql` ship
   no `indent()` in `@codemirror/legacy-modes`. Our table covers them locally; a patch
   upstream would cover every consumer. My default: local table now, upstream later.

---

## Appendix A — measurements (2026-10-25, at `ae318411`)

Run with `bun run` against the installed `@codemirror/{state,language,commands,legacy-modes}`
(`6.7.6` / `6.13.1` / `6.11.1` / `6.5.5`). Blocks are literal output.

**A.1 Which modes ship an `indent()` at all.** All 48 mode-backed ids have
`typeof streamParser.indent === 'function'`, so "has a function" is not the useful
question — A.2 is.

**A.2 Which modes actually ANSWER `getIndentation`** for a "block just opened" snippet:

```
ANSWERED (34): c, clojure, cpp, csharp, css, dart, elixir, erlang, go, groovy, java,
  javascript, json, json5, jsx, julia, kotlin, less, lua, objective-c, python, r,
  racket, ruby, rust, sass, scala, scheme, scss, stylus, swift, tsx, typescript, xml
NULL (14): bash, dockerfile, haskell, hcl, ini, makefile, ocaml, perl, powershell,
  properties, protobuf, sql, toml, yaml
NO MODE (12): astro, diff, graphql, html, markdown, nix, php, solidity, svelte, text,
  vue, zig
```

**A.3 What `indentOnInput()` changes.** Same keystroke, extension set varied:

```
typescript  off="if (x) {\n  }"   on="if (x) {\n}"
go          off="func f() {\n  }" on="func f() {\n}"
rust        off="fn f() {\n  }"   on="fn f() {\n}"
java        off="void f() {\n  }" on="void f() {\n}"
css         off="a {\n  }"        on="a {\n}"
json        off="{\n  }"          on="{\n}"
ruby        off="def f\n  end"    on="def f\nend"
lua         off="if x then\n  end" on="if x then\nend"
perl        off="if ($x) {\n  }"  on="if ($x) {\n  }"     // no mode regexp
yaml        off="a:\n  }"         on="a:\n  }"            // no mode at all
```

27 of the 48 modes ship their own `indentOnInput` regexp
(`c, cpp, csharp, css, dart, go, groovy, java, javascript, json, json5, jsx, julia,
kotlin, less, lua, objective-c, python, ruby, rust, scala, scss, stylus, swift, tsx,
typescript, xml`); 21 ship none. `indentOnInput` is **absent from the surface entirely**
(`rg` → 0).

**A.4 A fallback service must return `undefined`, not `null`, and must stand down where a
mode answers.**

```
js, service returns a number   -> 0    (the service OVERRIDES the mode's 11)
js, service returns undefined  -> 11   (falls through to the mode)
js, service returns null       -> null (SWALLOWS the mode's answer — a bug)
```

**A.5 The per-language table, measured.**

```
yaml        "a:"                      today="a:\n"                     with rule="a:\n  "
toml        "a = {"                   today="a = {\n"                   with rule="a = {\n  "
bash        "if true; then"           today="if true; then\n"           with rule="if true; then\n  "
dockerfile  "RUN apt-get install \"   today="RUN apt-get install \\\n"  with rule="…\\\n  "
hcl         "resource \"a\" \"b\" {"  today="resource … {\n"            with rule="…{\n  "
markdown    "- item"                  today="- item\n"                  with rule="- item\n"   (correct)
sql         "SELECT * FROM t WHERE"   today="…WHERE\n"                  with rule="…WHERE\n"   (correct)
```

**A.6 Why one bracket rule is not enough.** A single "depth of `{[(` on the line" rule
gives `yaml a:` and `markdown > quote` nothing (no bracket), and over-indents
`const s = "{"` (a brace inside a string). The table in P1.1 exists because each family
states its own opener.

---

## Appendix B — what shipped (2026-10-25)

Verified: `bun test` 7783 pass / 0 fail, `bun run lint`, the `--noUnusedLocals` pass, the
350-line check, the relative-import check, `bun run build`, and the browser layer
(`editor.e2e.ts` 6/6 and `editor-commands.e2e.ts` 5/5 on chromium).

### P1.1 Indentation

| File | What |
|---|---|
| `shared/lib/code/editor/indent-rules.ts` | The per-language table, split into INDEPENDENT `opens` / `closes` halves |
| `client/components/common/code-surface/indent.ts` | The `indentService` + `indentOnInput` + language data |
| `extensions.ts` | Wires both into the stack |

Measured before shipping: Enter indented in 34 languages and did nothing in 26; a typed
closer dedented in 27 and nowhere else. After: Enter indents in all 60 ids the surface can
open, and a closer dedents wherever a closer is a closer (YAML's `}` is content and is
left alone).

**Two findings that changed the design, both in the plan's own measurements:**

1. **`opens` and `closes` had to be separate fields.** `go`'s own mode regexp is
   `/^\s([{}]|case |default\s*:)$/` — it demands EXACTLY one space, so it indents
   correctly and never dedents `  }`. A single combined entry would have had to override
   the working half to fix the broken one. With the split, `go`, `tsx` and `jsx` carry a
   closer rule and NO `opens` rule.
2. **A generic bracket closer pattern is wrong outside the bracket families.** It turned
   `a:\n  }` into `a:\n}` in YAML — it moved the user's content. The `indentOnInput`
   pattern is now the rule's own `closes`, so a language with no bracket closers gets no
   pattern at all.

The gate is re-derived, not asserted: `indent-rules.test.ts` probes the installed
`@codemirror/legacy-modes` and fails if a language whose mode answers gains an `opens`
rule.

### P0 Data loss

| File | What |
|---|---|
| `server/lib/fs/write-conflict.ts` | The verdict + `parseBaseMtime` + `stableMtime` |
| `server/routes/fs/action.ts` | 409 on a moved base; the written mtime comes back |
| `server/routes/fs/read.ts`, `exists.ts` | Report the file's mtime |
| `client/hooks/editor/save-file.ts` | `SaveOutcome` (`written` / `conflict` / `failed` / `needs-permission`) |
| `client/hooks/editor/use-write-conflict.ts` | The three answers, with the mtime bookkeeping |
| `client/hooks/editor/use-external-change.ts` | The probe, with `unknown` as its own outcome |
| `client/lib/editor-dirty-tabs.ts` | Per-tab dirty set (a store, because the editor is the only component that caches buffers) |
| `client/hooks/editor/use-close-guard.ts`, `use-unload-guard.tsx` | Close confirmation + `beforeunload` |
| `editor/ConflictStrip.tsx`, `ExternalChangeStrip.tsx`, `Notices.tsx` | The strips |

**Three findings, each measured:**

1. **`mtimeMs` has a fractional part, and `node:fs` and `Bun.file()` disagree on it.**
   Comparing the raw values answered "conflict" for a file nobody had touched — a save
   loop with no way out. `stableMtime` rounds to whole milliseconds on every side that
   reports or compares one.
2. **The guard's blind spot is one millisecond.** Two writes inside the same millisecond
   leave `mtimeMs` identical, so they cannot be told apart. Documented in the module
   rather than widened with a tolerance (which would enlarge the hole) or closed with a
   content hash (a full read per save, for a case that no tool call or `git checkout`
   produces).
3. **The external-change strip and the conflict strip must not both render.** A conflict
   IS the later state of an external change, so `Notices.tsx` picks one — two strips would
   be two controls for one decision.

### P1.2 / P2

| Item | Where |
|---|---|
| Indent width setting (2/4/8), live via `omp:editor-indent-changed` | `hooks/editor/indent-settings.ts`, `appearance-settings/EditorIndentSection.tsx`, the `indentCompartment` |
| Desktop status bar (`Ln, Col` · indent · EOL · lines · language) | `editor/StatusBar.tsx`, fed by a new `onCaret` channel |
| Go to line (⌘G) | `editor/GoToLineModal.tsx` + a keymap row |
| Quick open (⌘P) over `/api/fs/list` | `hooks/editor/quick-open.ts`, `editor/QuickOpenModal.tsx` |
| `highlightActiveLine` + `highlightActiveLineGutter` + `highlightSelectionMatches` + `scrollPastEnd` | `extensions.ts`, themed in `theme.ts` |
| Dead ends closed | `selectWord` DELETED; `selectLine` and `insertCursorAbove` given rows |

**One bug the browser layer caught that no unit test could:** the status bar shipped with
`hidden @[240px]:flex`, and its own root has no `@container` ancestor — so the row was
`hidden` at every width while every unit test passed. It does not hide at all now, which
is right: the panel has a 320px floor, so one 24px row always fits.

**A second one, same layer:** the caret is reported by the surface's UPDATE listener, so a
freshly mounted document reported nothing and the strip printed `Ln —, Col —` over a file
with a visible caret. The surface now seeds the caret on mount AND after a document
switch (or a tab switch would keep the previous file's line number).

### Not done

P4 (whitespace/indent guides, EOL switch, Ctrl+wheel zoom) and P5 (block comment, line
transforms, auto-close brackets, autocomplete, find-in-selection, phone find) are unchanged
from the plan. The two that are worth doing next are
`toggleBlockComment` (free — the command is installed and `commentTokens` already returns
block tokens) and the phone's find bar, which is the only surface with no way to search a
file at all.

---

## Appendix C — P3, P4 and P5 (second pass)

Verified: `bun test` 7876 pass / 0 fail, `bun run lint`, the `--noUnusedLocals` pass, the
350-line check, the relative-import check, `bun run build`, and the browser layer —
`editor.e2e.ts` **8/8** on chromium, including the two specs added in this pass.

### P4 — view aids

| Item | Where | Note |
|---|---|---|
| `highlightSpecialChars` | `extensions.ts` | A stray control character was invisible, which made a corrupted file look fine |
| Indent guides | `code-surface/indent-guide.ts` + `shared/lib/code/editor/indent-guide-rule.ts` | Grammar-free: a `ViewPlugin` over the visible ranges, one rule per indented line |
| EOL switch | `editor/StatusBar.tsx` + `setEol` on the contract | A UI over a capability the write path already had |
| Ctrl/⌘ + wheel zoom | `hooks/editor/wheel-zoom.ts` | Also gives trackpad pinch (macOS reports it as `ctrlKey + wheel`) |

**Two decisions worth stating.** The indent guide is NOT the bracket pair guide: that one
draws ONE line between a brace and its match, at the opening brace's column; this draws one
rule per LEVEL, and making them look alike would teach the reader that the marks mean the
same thing. And the guide rule lives in `shared/lib` as a pure function so the three cases
a naive version gets wrong (one guide per level, none on a blank line, none past the column
cap) are testable without a mounted editor.

**The wheel handler must stand down over a nested scroller.** The find bar and a popup are
real scroll containers inside the panel, so the handler walks from the event target to the
surface's host and refuses for any ancestor that actually scrolls — otherwise scrolling a
list of search hits would resize the code underneath it. Measured in the test: a
`overflow-y: auto` box whose content FITS is not a scroller in any sense the user can feel,
and it must not claim the wheel either.

### P3 — tab management

| Item | Where |
|---|---|
| Context menu (Close / others / all / saved, Copy path, Reveal in Files) | `editor/TabContextMenu.tsx` + `client/lib/editor/tab-menu.ts` |
| Reopen closed (`⌘⇧T`) | `useFileTabs`'s stack + the panel's key hook |

**`Close saved` keeps the DIRTY tabs** — the only reading that cannot lose an edit — and a
row that would do nothing is ABSENT rather than disabled, which is the same rule the Files
panel's own row menu follows. The reopen stack keeps the closed `OpenedFile` WHOLE: a diff
tab has no file to re-derive from, and an attachment chip has no path at all. It is bounded
at ten, because past that it is a log rather than an undo.

**The browser spec corrected two of my own assumptions.** The tab strip shows only the
ACTIVE tab at the panel's width and folds the rest into `More open files`, so a spec that
addressed a middle tab by title timed out; the observable is now that overflow button. And
`Close others` is asserted by the overflow disappearing, not by counting rows that may not
be rendered.

### P5 — the dependency, and the rest

`@codemirror/autocomplete` is the ONE new package the editor has taken since the CM6
migration (`closeBrackets` and `autocompletion` live in it and nowhere else), pinned like
its siblings. Both features are SETTINGS defaulting ON, because both change what typing
does and a user who does not want an auto-inserted `}` cannot work around one.

The completer is bounded to `COMPLETION_WINDOW_LINES` around the caret — not the document.
Measured context for the bound: `const` in this repository matches 19 376 times, and a
whole-document scan per keystroke is exactly the cost the migration removed. It is
deliberately not LSP: it suggests words already near the caret, which works in every
language with no server.

Also shipped: `toggleBlockComment` (the command was already installed and `commentTokens`
already returned block tokens — one keymap row), `joinLines` and
`trimTrailingWhitespace` (CM6 ships no join, so both are written and unit-tested),
find-in-selection, find history, and the find bar on the PHONE — the one surface that had
no way to search a file at all.

**`selectWord` was DELETED.** It was implemented and unreachable for two releases: no
chord, and a test that asserted its absence from the palette. `selectLine` and
`insertCursorAbove` got the rows they were missing instead.

---

## Appendix D — Save As and the split editor

The two items §5 carried as deferred and not-planned, both now shipped. They are recorded
together because the same decision made them cheap: **neither touches the panel-width model.**

### Save As

`actionType: 'saveAs'` on `POST /api/fs/action` (`src/server/routes/fs/action.ts`), the
client in `src/client/hooks/editor/save-as.ts`, the dialog in
`editor/SaveAsModal.tsx`, and the `save-as` toolbar cluster.

Three decisions, each of which is what makes the operation safe:

- **A collision is REFUSED, never overwritten.** Overwriting is what `save` is for; a dialog
  that silently replaced a file the user did not name is the worst outcome of a mis-click.
  The server answers `409` and the dialog stays open with the name intact.
- **No `baseMtime` is sent.** A file that did not exist a moment ago has nothing to compare
  against, and sending the ORIGINAL's mtime would refuse every Save As.
- **The original tab stays open and the new file gets its own.** That is what makes the
  operation reversible by closing one tab, rather than by remembering where a file used to
  live. The suggested name keeps the extension (`notes.ts` → `notes copy.ts`) because losing
  it would change the language the surface resolves.

The name is validated with `isSinglePathSegment` — the same predicate the folder routes use —
so `join(directory, name)` cannot resolve outside the destination.

### Split editor

`shared/lib/workspace/split-editor.ts` holds the rules (pure, 14 tests);
`use-split-editor.ts` is the session-backed wrapper (8 tests through the real provider);
`SplitColumn.tsx` draws the two panes and the divider; `SplitPane.tsx` is the right pane's
header.

**It does not touch `panel-widths.ts`.** The plan's reason for rejecting it — "conflicts with
the coupled editor/right-panel width model" — was wrong: the split divides the width the
editor panel ALREADY has, so there is no new slot, no second pair and no re-derivation of the
0.7 cap. Splitting a column is a different decision from how wide the column is.

- **The right pane is a second `<Editor>` with a forced active tab**, not a second tab list.
  One list stays authoritative; the pane is told which id to render. A split therefore cannot
  lack a feature the unsplit editor has, and `EditorPane` is shared so the two panes cannot
  drift in what a pane contains.
- **`canSplitTo` refuses the left pane's own tab** — one file twice is a wide pane with a
  divider through it — and refuses an id that names no open tab, which is how a persisted
  value survives a reload in which that tab was closed elsewhere.
- **Activating the tab the right pane shows COLLAPSES the split** (`splitAfterActivate`): the
  user asked to look at that file, and the whole column showing it is the honest answer.
- **Closing the pane closes the VIEW, not the tab.** Splitting is a layout decision.
- **The divider persists a FRACTION, clamped to 0.2–0.8**, for the same reason the panel
  widths do: a pixel value is only right on the display it was dragged on.
- **The entry point is a strip BUTTON, not only a menu row.** The strip folds every
  non-active tab into the overflow at panel width, so a split reachable only by right-clicking
  another tab is unreachable in the common case. The button splits to the newest other tab
  (`splitCandidate`); the context menu keeps `Split right` for naming a specific one.

### Verified

`bun test` 7933 pass / 0 fail (766 files); `bun run lint`, the unused pass, the 350-line
check and the relative-import check all clean; `bun run build` clean; `bun run
typecheck:e2e` clean. `tests/e2e/specs/editor.e2e.ts` is **10/10** in chromium, including the
two added here: Save As writing a second file while the original's bytes do not move, and a
split showing two documents with both tabs still open after the pane closes.
