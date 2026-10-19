# Tool renderer audit — 2026-10-13

Audit of the chat timeline's tool cards against the **installed omp 18.10.3**
(the repo pins `OMP_VERSION=18.10.0` in `.github/scripts/install-omp.sh`; repo
HEAD `fbb04ab`). Everything below was measured, not read off a changelog. This
file is the record of what was found and how each finding was closed.

Status: **fixed.** F1, F2, F3 and F4 are closed; see "Resolution" below.

## How this was measured

- A real `omp --mode rpc-ui --no-session --no-lsp` child was spawned and driven
  over its NDJSON RPC (`{type:'prompt', message:'run: echo hi'}`); every frame
  was captured verbatim.
- The captured frames were replayed through Kabmo's own
  `foldAgentEvent` (`src/shared/lib/chat/omp/agent-events.ts`) to observe what
  the live timeline actually receives.
- The JSONL reload path was exercised through `loadSessionMessages`
  (`src/server/lib/omp/session/messages.ts`) against the author's real sessions.
- The wire schema shipped in the package
  (`@oh-my-pi/pi-coding-agent/src/modes/rpc/wire/rpc-wire.schema.json`) was read
  for the authoritative frame shape.

---

## F1 — Live tool cards lose `details` (root cause of most card regressions)

**Severity: high. Affects every live tool card; the reload path is correct.**

`tool_execution_end` nests the tool result's `details` inside `result`:

```json
{"type":"tool_execution_end","toolCallId":"call_00_…","toolName":"bash",
 "result":{"content":[{"type":"text","text":"hello-world\n"}],
           "details":{"wallTimeNoticeEmitted":false,"timeoutSeconds":300,"wallTimeMs":85.48}},
 "isError":false}
```

This matches omp's own wire schema — `ToolExecutionEndEvent` declares only
`type / toolCallId / toolName / result / isError`; `details` lives on
`$defs/ToolResultMessage`, i.e. inside the result, never at the top level.

But the live fold reads the top level:

```ts
// src/shared/lib/chat/omp/agent-events.ts:165
details: (data.details && typeof data.details === 'object' ? data.details : undefined)
```

`data.details` is **always `undefined`**, so the running card is stored with no
details.

### Measured

Replaying the exact recorded frame sequence through `foldAgentEvent`:

```
LIVE card.details = undefined
LIVE summary      = "hi · 2 lines"                         ← wrong chips
stored record     = {"details":{"wallTimeMs":61.6,…}}      ← details WERE captured
```

The `details` are present in `toolResultsRef` (they arrive later on the
`message_end` toolResult, whose top-level `details` **is** correct — see
`recordToolResult`, `src/shared/lib/chat/omp/tool-results.ts:80`), but the card
on screen is never re-paired with them: `refreshToolMessage` only re-emits when
the call id belongs to `lastToolMessageRef`, and the `message_start` /
`message_end` toolResult branches never call `pairToolOutputs` for a card that
already exists. `tool-results.ts:94` (`tc.details || res.details`) only runs on
the reload path.

### Consumer impact (live only)

- `toolSummary` (`src/shared/lib/chat/tool/summary.ts`) falls through to its
  fallback branch: the collapsed card shows `"<first output line> · N lines"`
  instead of `exit N`, `wallTime`, `service`, `+n/−n`, `N matches`, `N lines`
  from `totalLines`, …
- `diffTextOf` (`shared/card-helpers.tsx:155`) reads `details.diff`/`patch` →
  the diff view never appears for a live `edit`/`write`.
- Every panel that reads `tool.details` renders its fallback: Bash service
  strip, Edit diff, TaskResult, WebSearch, Github, Todo (`details.phases`), Read
  (`displayContent` / `contentType`), Proc, Lsp, AstEdit, SecurityScan,
  ManageSkill, Memory, ContextNotes, Debug, Resolve, SearchFs, SearchTool.
  (19 panel files read `tool.details`.)

### Why it was not caught

The reload path is correct, and the two paths look identical in a screenshot
once a session is reloaded. A card that was just streamed is the only one that
shows the regression, and no test replays a real `tool_execution_end` frame
through the live fold — `agent-events.test.ts` folds frames without `details`,
and `fold.test.ts` calls `putToolResult` directly with details already present.

### Proposed fix

Read `result.details` (keep the top-level read as a fallback for a build that
sends it):

```ts
const details = data.details ?? (data.result as { details?: unknown } | undefined)?.details;
```

plus either re-pair on the `message_end` toolResult branch or rely on
`tool_execution_end` (which always carries the full result, measured).

**Verified the fix restores the facts:** replaying the recorded frame with
`details` read from `result` yields `srv · ready · pid 1 · exit 0 · 86ms`
instead of `hi · 2 lines`.

---

## F2 — `read` excerpts leak their first code line into the card's subject chip

**Severity: medium. Independent of F1; also fires when a file `read` carries no
`fileSize`/`totalLines`.**

`toolSummary`'s fallback names the card's subject from the first output line
that is not "excerpt furniture". `isExcerptFurniture`
(`src/shared/lib/chat/excerpt.ts:63`) recognises a colon gutter (`ROW_RE =
/^\s*\d+:/`), a `[path]` header and an elision notice — but **not a pipe
gutter** (`1|code`).

`read` results use the pipe gutter: **981 of 994** read results in the author's
sessions begin `1|…` (`edit`/`write` use the colon gutter, 632/634). So the
first line of a read excerpt is treated as content:

```
LIVE (details undefined):  "import { jsPDF } from \"jspdf\"; · 3 lines"
RELOAD (details present):  "2.0 KB · 60 lines"
```

Because the collapsed card draws the subject chip on the **same row** as the
path subtitle (`ToolCardShell.tsx:179`), the reader sees the file's first line
of code sitting where a path should be — "read reads line 1 as the subtitle".

### Measured (rendered)

Mounting the real `ToolCallCard` for one `read` call, live vs reloaded:

```
LIVE     (details absent):  Read src/services/laporanCetak.ts:1-60  1|import { jsPDF } from "jspdf";  3 lines  Done
RELOADED (details present): Read src/services/laporanCetak.ts:1-60  2.0 KB  60 lines  Done
```

The subtitle (the path) is correct in both; the chip row after it is where the
first line of code appears, on the same row as the path.

Pure-function checks:

- `isExcerptFurniture('1|import { jsPDF } …')` → `false`
- `isExcerptFurniture('1:import { jsPDF }')` → `true`
- `parseEditOutput('1|import …\n2|export …')` → one section whose `notes` are
  the code lines (no group parsed).

`edit` is largely spared on reload because its rows are colon-gutter; on the
**live** path F1 drops the diff chip and the same fallback runs, so an edit
whose excerpt contains a non-row line (prose, or a row that fails the regex) can
leak too — matching the "edit juga sepertinya" report.

### Proposed fix

Teach `isExcerptFurniture` (and `parseEditOutput`'s `ROW_RE` usage) the pipe
gutter, or give the fallback a path-shaped guard. Fixing F1 removes the leak for
the common case; the pipe-gutter gap is what makes it leak even when details are
present but lack size/line metadata (URL reads, image reads, ~5% of file reads).

---

## F3 — Settings schema is stale against the installed omp

**Severity: low. CI gate `omp:schema:check` fails.**

The installed binary is 18.10.3; the generated schema
(`src/client/data/settings/omp-schema.json`) was regenerated from 18.10.0.
`bun run omp:schema:check` exits non-zero. Regenerating adds:

- `task.structured` (boolean, tab `tasks`, group `Subagents`) — new in 18.10.2.
- `snapcompact.toolResults` description updated.
- `task.softRequestBudget` description updated.
- `source` line `548 settings` → `550 settings`.

Proposed fix: `bun run omp:schema` and commit the result (this is the documented
release-time flow; do not hand-edit the file).

---

## F4 — New omp frames Kabmo does not handle (reviewed; named as ignored)

Enumerated against the 18.10.3 wire schema and the live capture. All are
currently inert (they fall through to `transport-frames.ts`'s `default`):

- `tool_stream_update` — a streaming variant of `tool_execution_update` for a
  tool that streams its own output; Kabmo reads only
  `tool_execution_update`. No regression observed (no tool emitted one in the
  sampled sessions).
- `advisor_yielded`, `advisor_cost_changed` — advisor surface Kabmo does
  not render.
- `live_start/phase/levels/end/transcript` — GPT live-voice sessions, not a
  Kabmo surface.
- `queue_update` — Kabmo's queue panel reads client state, not this frame.
- `config_update` — a builtin slash command changed model config; Kabmo
  already reacts to `model_changed` and `thinking_level_changed`.

Proposed: leave as-is; the ignored set in `transport-frames.ts` should name
`tool_stream_update` explicitly if it is confirmed inert.

---

## Resolution

**F1 — live `details`.** `resultDetails()` (`tool-results.ts`) reads the nested
`result.details` first, then a top-level `details`, and is used by both
`tool_execution_end` (via `agent-events.ts`) and `recordToolResult`. The
`message_end` toolResult branch now also calls `refreshToolMessage`, so a result
that arrives before (or without) the `_end` frame still reaches the row on
screen; `recordToolResult` now carries `isError` too. Verified by replaying the
verbatim 18.10.3 frames: a `bash` card reads `85ms`, a service launch reads
`kabmo · ready · pid 43148`, and a `read` reads `2.0 KB · 60 lines` —
identical to the reload path. Pinned by `tool-details.test.ts` (nested-wins,
top-level fallback, the toolResult re-pair, the error status).

**F2 — pipe gutter.** `PIPE_ROW_RE` (`/^\s*\d+\s*[|│]/`) joined
`isExcerptFurniture`, so a `read` result's `1|code` rows are furniture like an
`edit`'s `1:code` rows. `ROW_RE` / `parseEditOutput` were deliberately left
colon-only — they back the `edit`/`write` panel, whose rows are colon-gutter
(632/634 measured), and treating a pipe row as an excerpt row there would split
`|`-bearing prose.

A second gap was found while verifying in the browser: a file-body tool
(`read`, and the legacy `read_file`/`view_file`) whose output carries **no**
recognisable gutter — a raw-JSON read, the 13 of 994 read results with no gutter
— still named its first line as the subject, so a `read_file package.json` card
drew `{` on the same row as the path. `toolSummary`'s fallback now suppresses the
subject for a file-body tool (the subtitle already names the path), while a
FAILED read keeps it: its output is a prose reason ("Path 'src/gone.ts' not
found"), not the file, and that IS the one thing worth saying (`isError`,
measured true on real failed reads). The `N lines` count is kept in both cases.

Pinned by three `summary.test.ts` cases (a pipe-gutter read names no subject; a
raw-JSON read names no subject; a failed read names its reason).

**Demo data.** Two MOCK samples were shapes the product never receives and were
corrected so the demo exercises the fixed paths: `read` used a colon gutter with
no `details` (now a pipe gutter plus a `details` bag), and `grep` put its pattern
in the title with `input.query` (now the scope is the subtitle, `input.pattern`
is the subject chip, with a `details` match count) — both verified in the browser
at 1440px and 390px.

**F3 — schema.** `bun run omp:schema` regenerated `omp-schema.json` from 18.10.3
(adds `task.structured`, two description updates, 548 → 550 settings);
`omp:schema:check` now passes.

**F4 — new frames.** `tool_stream_update`, `advisor_yielded`,
`advisor_cost_changed`, `queue_update` and `config_update` are named in
`transport-frames.ts`'s ignored set, so the omission is a decision rather than a
fall-through. None carries a Kabmo-side effect (see the F4 notes above).

**Gates.** `bunx tsc --noEmit`, the `--noUnusedLocals --noUnusedParameters`
pass, the 350-line ceiling and the relative-import check all pass; 626 chat-lib
tests and 660 timeline/omp tests are green.

## Files touched

- `src/shared/lib/chat/omp/tool-results.ts` — `resultDetails`, `recordToolResult`.
- `src/shared/lib/chat/omp/agent-events.ts` — `resultDetails` at the `_end`
  branch, re-pair at the toolResult `message_end`.
- `src/shared/lib/chat/excerpt.ts` — `PIPE_ROW_RE`.
- `src/shared/lib/chat/tool/summary.ts` — the file-body subject gate.
- `src/shared/lib/chat/omp/transport-frames.ts` — the ignored set.
- `src/client/data/settings/omp-schema.json` — regenerated.
- `src/client/data/samples/sample-tools/built-in-part1.ts` — real read/grep shapes.
- `src/shared/lib/chat/omp/tool-details.test.ts` — new (F1 regression).
- `src/shared/lib/chat/tool/summary.test.ts` — three F2 cases.
