# M23 — The Kabmo change journal: every write, not only the edit tool's

Status: **partial** — the writer, reader, `bash` classifier, git scan pass and their tests shipped
(2026-11-16); the parity test against a real session and the retention prune remain. This document
measures what omp 18.20.3 journals, what Kabmo reads today, and what the Kabmo-owned JSONL journal
captures.

Terminology: the **omp journal** is `<sessionFile minus .jsonl>/changes.jsonl` plus its `blobs/`
directory, written by omp. The **Kabmo journal** is the proposed `~/.kabmo/changes/<sessionId>/`
equivalent, written by Kabmo's server.

---

## 1. The question

The chat's per-run file list, its `+`/`−` totals and its diff tabs all read one source: omp's
`changes.jsonl`. That source is honest about what it covers and silent about everything else.

> Can Kabmo write its own change journal that records **every** mutation a run makes — `edit`,
> `write`, `ast_edit`, `apply_patch`, and the `bash` commands that bypass all of them (`rm`, `mv`,
> `sed -i`, `>`, `git restore`) — with enough identity to attribute each write to a tool call, an
> agent and a run, and can it replace the omp journal without changing the client contract?

The answer is yes, with one hard constraint: the shell trace omp already emits gives exact `argv`
and exit status per simple command, but **not** redirections, so a bash mutation detector needs a
small script tokenizer plus a filesystem reconciliation pass. Everything else is a tap Kabmo
already owns.

---

## 2. What exists today, measured in this tree

| Fact | Evidence |
|---|---|
| The journal is read from `<sessionFile minus .jsonl>/changes.jsonl` | `src/server/lib/omp/session/changes.ts:48`, `:130` |
| Blobs are gzip files under `blobs/`, keyed by content | `changes.ts:49`, `:155-164` |
| A blob over 8 MB is not stored; the record carries `undefined` | `changes.ts:15`; omp binary `m = 8 * 1024 * 1024` |
| The parse is cached by size+mtime on `globalThis` | `changes.ts:62-82`, `:137-151` |
| The list drops a creation whose file is gone, because `bash rm` is never journaled | `changes.ts:193-223` |
| The diff is the first record's `before` to the last record's `after` in a run window | `changes.ts:230-273` |
| Stats are the same net pair as `+`/`−` counts | `changes.ts:283-313` |
| Three routes: list, diff, stats | `src/server/routes/sessions/changes.ts:35`, `:43`, `:64` |
| The client reads the list once per settled run | `src/client/hooks/chat/timeline/session-changes.ts` |
| Runs are bucketed by wall-clock window, not by tool call | `src/shared/lib/chat/timeline/changed-files.ts:33-60` |
| The diff tab reads the journal, not the worktree | `src/client/hooks/workspace/journal-diff.ts` |
| The summary prints `+`/`−` from the same net pair | `src/client/components/workspace/chat-timeline/ChangedFilesSummary.tsx` |
| A session delete removes the transcript and its sibling artifacts directory | `src/server/lib/omp/session/delete.server.ts:1-30` |

The client contract is small and stable: `SessionChangeRecord[]`, `SessionChangeDiff`,
`SessionChangeCounts` (`src/shared/types/session-changes.ts`). A replacement journal only has to
answer those three shapes.

---

## 3. What omp 18.20.3 actually journals

Measured from the installed binary (`~/.bun/bin/omp`, 18.20.3) and from 30 real journals on this
machine (716 KB total; the largest sampled session: 99 lines, 20 KB journal, 7 blobs, 128 KB).

The writer is `packages/coding-agent/src/commit/selective/journal.ts` (embedded in the binary). It
appends three record types:

```json
{"type":"change","at":1794728076728,"agent":"Main","tool":"edit","path":"/abs/a.css",
 "before":"172-vuwr4z2ab8un","after":"1xq-10whcnp369b9i","beforeMtimeMs":1793226452803.2378}
{"type":"call","agent":"Main","tool":"bash","start":1794727996231,"end":1794727996286,
 "label":"rg -n \"font-mono\" --glob '!node_modules' …"}
{"type":"commit","at":1794728476746,"agent":"Main","sha":"8739550…","paths":["src/…/a.css"]}
```

`change` is written by exactly these call sites in the binary:

| Tool | What it records | Evidence (binary offset) |
|---|---|---|
| `edit` | before/after full text, `beforeMtimeMs` | `recordFileChange` at 866673, 866827, 904193 |
| native edit ops | `delete` → `after:null`; `move` → two records; `create`/`update` | 904780-904900 |
| `write` | before/after full text | 962123-962145 |
| `ast_edit` | one record per changed file, after a dry-run-free apply | 952442-952480 |
| `task` | one record per patched file, attributed to the child agent | 1004105-1004130 |

`call` is written for **every** tool call, but carries only a label truncated to 80 characters
(`wmt` in the binary) — no arguments, no result, no `toolCallId`. `commit` carries a sha and the
paths it touched.

### 3.1 The gaps that matter

1. **`bash` mutations are invisible.** `rm`, `mv`, `sed -i`, `>`, `tee`, `git restore`, `git clean`
   never reach `changes.jsonl`. Kabmo already compensates for one symptom — a creation whose file is
   gone is dropped (`changes.ts:193-223`) — but a `bash` edit to an existing file is not even
   visible as a change, and a `bash` delete of a tracked file is invisible entirely.
2. **No tool-call identity.** A `change` record has `at`, `agent`, `tool`, `path` — no
   `toolCallId`, no message id, no run id. The client buckets by wall-clock window
   (`changed-files.ts:33`), which is why a run that starts mid-session needs the
   `firstStartMs` fallback (`src/shared/lib/chat/duration.ts:92-107`).
3. **No rename.** A `move` is two records with no link; the list shows a delete and an add.
4. **8 MB cap, silently.** A large file's two sides are `undefined`; the diff tab says "over 8 MB"
   (`journal-diff.ts`), which is honest but is a hard ceiling on what the journal can answer.
5. **No exit status, no command.** A `bash` call's `call` record has a label, not the command, and
   no exit code.
6. **Subagent attribution is a string.** `agent`/`parent` are registry ids; there is no
   `toolCallId` to join a change to the child's own transcript.
7. **ACP sessions have no journal at all.** The ACP mapper emits `tool_execution_start` with
   `args` (`src/server/lib/harness/acp/tool-calls.ts:119-130`), but nothing writes a journal.

---

## 4. Where Kabmo can observe a mutation

Three taps exist, and they are complementary rather than alternatives.

### 4.1 The live frame tap (authoritative for tool calls)

Every omp child's frame passes through `AgentSessionWrapper.handleFrame`
(`src/server/lib/omp/rpc/manager.ts:239`) and then `EventFanout.emit`
(`src/server/lib/omp/rpc/event-fanout.ts:33`). The frames carry:

- `tool_execution_start`: `toolCallId`, `toolName`, `args`, `intent` — measured in a real
  transcript: `{"toolName":"bash","args":{"command":"rm -rf /tmp/kabmo-fontcheck; echo cleaned"}}`
  and `{"toolName":"edit","args":{"path":"src/…/fira-code-fonts.css"}}`. The transcript's
  `tool_execution_start` custom entry trims `old_string`/`new_string`, but the assistant message's
  `toolCall` block keeps them (measured: the same session's `edit` call carries both), and the live
  frame carries them too — the client's `Edit.tsx:104-116` reads them.
- `tool_execution_end`: `result`, `isError`, `details` — including `details.trace` for `bash`.
- `subagent_event`: the child's own session event, so a subagent's tool calls are visible live
  (omp binary: `handleEvent` → `{type:"subagent_event", payload:e}`).

**The trace is stripped before subscribers see it.** `EventFanout.emit` calls `stripShellTrace`
first (`event-fanout.ts:34`), because the trace is ~a second copy of the output
(`src/shared/lib/omp/session/shell-trace.ts:1-30`: 192 KB of frames for a 40-line command). A
journal writer that needs the trace must therefore run **before** the strip, or read the trace from
the transcript JSONL (omp persists it: `details.trace` is in the `toolResult` message).

### 4.2 The shell trace (authoritative for `bash` argv)

Measured on a real `rm`:

```json
{"k":"simple","lo":0,"hi":27,"p":1,"state":"ok","runs":1,"st":0,"ns":2046083,"at":25083,
 "argv":["rm","-rf","/tmp/kabmo-fontcheck"],"res":"native","end_ns":2071166,"end_seq":5}
```

`units[].nodes[]` gives one `simple` node per command with `argv` and `st` (exit status), plus
`and_or`/`pipeline` structure. That is enough to classify `rm`, `mv`, `cp`, `sed -i`, `tee`,
`truncate`, `touch`, `git restore|checkout|clean|reset` without writing a shell parser.

**What the trace does not give: redirections.** Measured on a real `bun test > /tmp/n1.log 2>&1`:
the node kinds are `and_or`, `pipeline`, `simple`, `word` — the `>` and `2>&1` are not nodes, and
the `simple` node's `argv` is `["bun","test"]`. A redirect target must be parsed from the script
text or caught by the reconciliation pass.

### 4.3 The filesystem reconciliation pass (the safety net)

For a `bash` call whose command is not provably read-only, or whose adapter is unknown (an ACP
agent's `replace`, a script, a build), take a cheap snapshot of the session cwd before and after:

- `git status --porcelain=v1 -z` for tracked changes (fast, exact for tracked files);
- an mtime+size scan of the cwd for untracked files, bounded by a file count and a time budget.

The delta is journaled with `source:"scan"`. This is the only layer that can see a mutation made by
a command Kabmo does not understand, and it is the layer that makes the journal "more powerful"
than omp's rather than merely equal.

---

## 5. The proposed journal

### 5.1 Storage

```
~/.kabmo/changes/<sessionId>/
  changes.jsonl      append-only, one JSON object per line
  blobs/             content-addressed gzip, key `<byteLength base36>-<Bun.hash base36>`
```

`<sessionId>` is the real omp id (the one `registry.set(realSessionId, wrapper)` uses,
`session-registry.ts:339`), not the pre-spawn alias. The root is `getDataDir()`
(`src/server/lib/lifecycle/paths.ts:76`) — the same root `btw/` uses
(`src/server/lib/btw/session-copy.server.ts:47`). Created `0700`, like `getRunDir`.

Deleted with the session in `delete.server.ts`, beside the transcript and the sibling artifacts
directory.

### 5.2 Records

```jsonc
// line 1, once
{"v":1,"type":"session","at":1794727996000,"sessionId":"01a1…","cwd":"/Users/…/kabmo",
 "omp":"18.20.3","kabmo":"0.37.0"}

// one per tool call, before the tool runs
{"v":1,"type":"call","at":1794727996231,"toolCallId":"call_…","agent":"Main","parent":null,
 "tool":"bash","intent":"…","args":{"command":"rm -rf /tmp/x"},"argsTruncated":false}

// one per path mutation
{"v":1,"type":"change","at":1794727996286,"toolCallId":"call_…","agent":"Main","parent":null,
 "tool":"bash","op":"delete","path":"/tmp/x","displayPath":"/tmp/x",
 "before":"1xq-10whcnp369b9i","after":null,"beforeMtimeMs":1794727996000.1,
 "source":"trace","command":"rm -rf /tmp/x","exit":0}

// a rename is one record, not two
{"v":1,"type":"change","op":"rename","path":"/abs/new","from":"/abs/old", …}

// a commit the agent made
{"v":1,"type":"commit","at":…,"sha":"…","paths":["src/…"]}

// a mutation the journal could not capture, stated rather than guessed
{"v":1,"type":"note","at":…,"toolCallId":"call_…","reason":"too-large"|"opaque-command"|"scan-budget"}
```

`op` is `create | update | delete | rename`. `source` is `tool | trace | scan | omp-import`.
`before`/`after` are blob keys; `null` means the file did not exist; a missing blob with a `note`
means the content was not stored.

### 5.3 Writer

A `ChangeJournal` object per live session, attached where the wrapper is registered
(`session-registry.ts:339` and the prewarm path at `:326-339`), not in the realtime topic — the
topic only subscribes when a client subscribes (`src/server/lib/realtime/topics/session.server.ts:107`),
so a journal there would miss every run nobody watched.

It needs the trace, so it registers a **pre-strip** listener. The smallest change to the existing
fanout is a second listener list that runs before `stripShellTrace`:

```ts
// event-fanout.ts
emit(event) {
  for (const listener of this.#rawListeners) { try { listener(event); } catch {} }
  stripShellTrace(event);
  for (const listener of this.#listeners) { … }
}
```

The journal extracts what it needs synchronously (argv, exit, args) and never holds the frame.

Appends are serialized through one promise chain per session (the same rule omp's writer follows),
so two parallel subagents cannot interleave a half line. A torn final line is skipped on read, not
fatal — the same rule `parseJournal` already follows (`changes.ts:99-123`).

### 5.4 Capture adapters

| Tool | Before | After | Source |
|---|---|---|---|
| `edit` | read `args.path` at start | read again at end; if equal, use `old_string`/`new_string` to prove the write | `tool` |
| `write` | read `args.path` at start | `args.content` (or read back) | `tool` |
| `ast_edit` | read every path in `args` | read again; skip unchanged | `tool` |
| native edit ops (`delete`/`move`/`create`/`update`) | read source and destination | read both | `tool` |
| `apply_patch` / `task` | read every path in the patch | read again | `tool` |
| `bash` | classify `argv` from the trace | snapshot the named targets | `trace` |
| `bash` with a redirect or an unknown verb | cwd snapshot | cwd snapshot | `scan` |
| ACP `replace`/`str_replace_editor`/`create_file` | read `rawInput.path` | read again | `tool` |
| anything else | — | — | `note` |

The adapter table is the one place a new tool is added; a tool with no adapter is a `note`, never a
silent miss.

### 5.5 Reader

`readSessionChangeIndex/List/Diff/Stats` keep their signatures and return types
(`src/shared/types/session-changes.ts`), so the routes and the client do not change. The reader:

1. reads the Kabmo journal when it exists;
2. falls back to the omp journal for a session that predates the feature (read directly, no
   import — an import would duplicate the blobs and the lines);
3. caches by size+mtime on `globalThis`, the same rule as today.

The list no longer needs the "creation whose file is gone" heuristic: a `bash rm` is a `delete`
record, so the net change is computed from the journal, not inferred from the filesystem.

### 5.6 Retention

- Per-session cap: 20 MB journal, 100 MB blobs. Prune oldest blobs first, keep the lines, mark the
  pruned key with a `note` so a diff says "pruned" rather than "unknown".
- Delete with the session.
- A `change` record whose `before === after` is not written (the same rule omp's writer follows).

---

## 6. Migration

1. Ship the writer and the reader behind the existing routes; the client is untouched.
2. Run both journals for one release: the Kabmo journal is the answer, the omp journal is the
   fallback for sessions that predate it.
3. Parity test: for a real session, the Kabmo journal's `edit`/`write` records must name the same
   paths and the same before/after hashes as the omp journal's. A mismatch is a bug in the adapter,
   not a reason to keep both.
4. Delete the omp reader (`changes.ts`) once every session on the machine has a Kabmo journal, or
   keep it as the fallback forever — it is ~300 lines and it is the only reader for old sessions.

---

## 7. Risks and open questions

| Risk | Why it bites | Mitigation |
|---|---|---|
| Double I/O on every edit | a snapshot before and after doubles the read cost of a large file | cap at 32 MB; skip a file whose `beforeMtimeMs` is unchanged and whose tool reported success |
| Snapshot races the tool's own write | `tool_execution_start` may arrive after the tool began | read at start; for `edit`, reconstruct from `old_string`/`new_string` when the read is already the new content |
| Parallel subagents | two appends interleave | one promise chain per session; per-path lock for snapshots |
| Redirects are not in the trace | `> file` is invisible to the argv classifier | tokenize the script for `>`/`>>`/`2>`; otherwise the scan pass |
| ACP has no trace | an ACP agent's bash is opaque | scan pass; `note` when the budget is exceeded |
| Storage growth | 3 GB of omp sessions already on this machine | caps + prune; the journal is per-session, so a delete reclaims it |
| Contents on disk | the journal holds file text | `0700` root; the same trust boundary as `~/.kabmo/db.sqlite` |
| Windows | `rm` vs `del`, `\` vs `/` | classify both; normalize `displayPath` to `/` (the rule `displayPathFor` already follows, `changes.ts:92-97`) |

Open:

- **Run linkage.** The journal records `toolCallId`; the client still buckets by wall-clock window.
  Moving the client to `toolCallId` would delete `runWindowMs`'s fallback, but it is a separate
  change and not required for parity.
- **Checkpoints.** omp has a checkpoint/rewind path; Kabmo does not. A journal with full before/after
  blobs is the substrate for "restore this run", but that is a feature, not this milestone.
- **A global journal.** "What changed today across sessions" would need a cross-session index. Not
  now; the per-session file is the unit the UI reads.

---

## 8. Verification plan

- **Unit — argv classifier.** A table of real commands (`rm -rf x`, `mv a b`, `sed -i 's/a/b/' f`,
  `tee f`, `git restore -- f`, `bun test > f`) → expected ops and paths. The redirect case is the
  one that must fail loudly if the tokenizer is missing.
- **Unit — journal writer.** Append order, dedupe by content hash, `before === after` skipped, a
  torn final line tolerated, two concurrent appends serialized.
- **Unit — reader.** Net diff and stats over a multi-write path; a create-then-delete in one run is
  not a change; a pruned blob is `unavailable`, not zero.
- **Integration — fake child.** A stub that emits `tool_execution_start`/`_end` for `edit`, `write`
  and `bash rm`; assert the journal lines and the three route responses.
- **Parity — real session.** Run one session that edits, writes and `rm`s; compare the Kabmo
  journal's `edit`/`write` records with the omp journal's for the same paths and hashes.
- **Smoke.** Open a chat, edit a file, `rm` a file through `bash`, confirm the run footer lists both
  and the diff tab opens the right two sides.

---

## 9. Decision

Build the Kabmo journal as a per-session append-only JSONL with three capture layers (tool adapter,
shell trace, filesystem reconciliation), a pre-strip listener on the existing fanout, and a reader
that keeps the current route and client contract. The omp journal stays as the fallback for
sessions that predate the feature, and is deleted only when the parity test has run on a real
session.

---

## 10. What shipped

| Piece | File | Rule it owns |
|---|---|---|
| Writer | `src/server/lib/changes/journal.server.ts` | one promise chain per session; lazy directory; 20 MB rotation; 4 KB args cap |
| Blobs | `src/server/lib/changes/blobs.server.ts` | content-addressed gzip, 32 MB cap, dedupe by key |
| Records | `src/server/lib/changes/records.ts` | `session`/`call`/`change`/`commit`/`note`, torn-line tolerant |
| Paths | `src/server/lib/changes/paths.server.ts` | `~/.kabmo/changes/<sessionId>/`, single-segment guard |
| Classifier | `src/server/lib/changes/classify-command.ts` | the verb table and the two entry points |
| Tokenizer | `src/server/lib/changes/classify-tokenize.ts` | words, operators, `2>&1` as a fd dup |
| Operands | `src/server/lib/changes/classify-paths.ts` | path resolution, glob refusal, flag parsing |
| `git` branch | `src/server/lib/changes/classify-git.ts` | read-only vs path restore vs opaque |
| Capture | `src/server/lib/changes/capture.server.ts` | tool adapters, before snapshot, subagent attribution |
| Capture types | `src/server/lib/changes/capture-types.ts` | the shared `PendingCall`/`ShellTrace`/`CaptureDeps` shapes |
| Capture fs | `src/server/lib/changes/capture-fs.server.ts` | read/stat, display path, trace extraction, the note/scan predicates |
| Capture bash | `src/server/lib/changes/capture-bash.server.ts` | trace merge, rename as two records, scan reconcile |
| Scan | `src/server/lib/changes/scan.server.ts` | `git status` + `git show HEAD:path`, bounded |
| Reader | `src/server/lib/changes/reader.server.ts` | Kabmo journal first, omp journal as fallback |
| Attach | `src/server/lib/changes/attach.server.ts` | raw-frame subscription, flush on detach |
| Purge | `src/server/lib/changes/purge.server.ts` | delete with the session |

Wiring: `EventFanout.onRaw` runs before `stripShellTrace`; `AgentSessionWrapper.onRawEvent` exposes
it; `registerSpawnedSession` and `registerAcpSession` attach the journal; the prewarm path now uses
`registerSpawnedSession` instead of its own `registry.set`; the three `/api/sessions/:id/changes*`
routes read the new reader; `purgeSessionData` removes the journal directory.

### 10.1 How each risk is closed

| Risk | Solution in the shipped code |
|---|---|
| Double I/O on every edit | the before read is one file; a write whose content is unchanged is skipped (`before === after`); blobs are deduped by key |
| Snapshot races the tool's write | the trace is extracted **before** the first `await` (the fanout strips it in place); an `edit` whose write already landed is reconstructed from `old_string`/`new_string`; a raced `write` reads omp's own `before` blob, and a raced `bash` mutation whose mtime is after the call start uses the file's birth time to decide create (`before: null`, A) versus unknown (`before: undefined`, M, plus a `snapshot-race` note) |
| Parallel subagents | one promise chain per journal; `ChangeCapture.flush()` awaits every in-flight capture |
| Redirects are not in the trace | the script is tokenized at start; `>`, `>>`, `2>`, `&>` become mutations |
| ACP has no trace | `onEvent` fallback; tool adapters still read `args`; an opaque command is a `note` |
| Opaque commands | the git scan pass: `git status` + `git show HEAD:path`, bounded to 200 files, with a `scan-budget` note when cut; a non-git cwd falls back to a bounded directory scan (200 files, 10 MB) |
| Storage growth | 20 MB journal rotation, 32 MB blob cap, per-session directory deleted with the session |
| Contents on disk | `0700` on the journal and blob directories |
| Windows | `displayPath` normalizes `\` to `/`; the classifier reads both `rm` and `del`-style verbs as far as argv allows |
| Read-only tool noise | only a tool whose NAME promises a write earns an `unknown-tool` note |
| Run separation | `run` records on `agent_start` / terminal `agent_end`; every `call`/`change`/`note` carries `runId` + `runAt`; a non-terminal `agent_end` is a continuation and reuses the id; a late subagent change keeps the closed run's id |
| Session spanning the feature | omp records older than the first Kabmo line are merged in; each merged record carries its blob store, so a diff straddling the boundary reads the omp `before` and the Kabmo `after` |

### 10.2 Run separation

A run is not every `agent_end`: omp emits a non-terminal one while an async subagent is still
working. The capture therefore:

- opens a run on `agent_start` only when no run is open (a retry or continuation reuses the id);
- closes it on a terminal `agent_end` (`isTerminal !== false`);
- keeps the closed id until the next `agent_start`, so a subagent's late write still carries the
  run that started it.

`bucketChangesByRun` groups by `runId` and maps the run to its chat row by `runAt` (the
`agent_start` time, ~120 ms before the user message that opens the window). A record with no
`runId` — an old journal, or a session whose first frame was a tool call — falls back to the
wall-clock window.

### 10.3 Old sessions

Three cases, no migration:

- **No Kabmo journal** (ran before the feature): the omp reader answers, with its own cache and
  its "creation whose file is gone" heuristic. Behaviour is exactly what it was before.
- **Kabmo journal without `runId`** (ran after the journal, before run separation): read as-is;
  the client falls back to the wall-clock window.
- **A session that spans the feature**: the omp records older than the first Kabmo line are merged
  in, and each merged record carries the store its blob keys belong to. Newer omp records are not
  merged — from the first Kabmo line on, the Kabmo journal is the authority, and merging both would
  double every edit the two writers both saw.

### 10.4 What remains

- **Parity test on a real session.** The unit tests pin the adapters and the classifier; a real run
  that edits, writes and `rm`s must produce the same paths and hashes as omp's journal for the
  `edit`/`write` half.
- **Retention prune.** Rotation bounds the journal; the blob directory has a cap but no prune yet.
- **`apply_patch` / MCP write tools.** They are `note`s today; a patch parser would name their
  paths.
- **Run linkage is shipped.** `runId`/`runAt` on every record, `run` records at the boundaries, and
  `bucketChangesByRun` groups by run id with a wall-clock fallback for old journals.
