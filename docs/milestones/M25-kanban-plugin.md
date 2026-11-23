# Kanban — a right-panel board plugin

Status: **done** — the seven decisions produced `marketplace/plugins/kanban/` plus the
three host changes the design could not avoid (H1–H3, §6). The research below is kept as
the record of WHY; the shipped behaviour is in the plugin's own README, and the measured
host rules are in the wiki page for plugins.

What landed:

| Piece | Where |
|---|---|
| The board plugin (store, RPC, watcher, MCP tools, panel) | `marketplace/plugins/kanban/` |
| Plugin MCP reaches `omp-rpc`, not just ACP | `src/server/lib/mcp/session-overlay.server.ts`, `src/server/lib/omp/rpc/spawn-mcp.ts` |
| A stage's system prompt reaches the spawn | `src/server/routes/agent/new.ts`, `src/server/lib/omp/rpc/{constants,session-registry,session-new}.ts` |
| A plugin can learn the host's data dir | `packages/kabmo-sdk/src/backend.ts` (`paths.dataDir`), `src/server/lib/plugins/loader.server.ts` |
| A rebuilt plugin's SERVER half actually reloads | `src/server/lib/plugins/module-import.server.ts`, wired from `loader.server.ts` |

Two host defects found only by running the thing, both fixed here:

- **Bun caches an ESM module by resolved URL and IGNORES a query string on a file
  specifier** (measured in one process: `?v=1` then `?v=2` returned the same module
  object). A Rebuild therefore kept the previous server code alive until the whole
  process restarted, and there was no way for the UI to say so. `importPluginModule`
  (`module-import.server.ts`) now copies the bundle to a dot-prefixed sibling and imports THAT — a fresh URL, a
  real `import.meta.url` in the plugin's own directory (a plugin that ships an MCP
  server spawns itself from it), removed on dispose.
- **The plugin RPC route re-wraps a thrown handler as `handler_error`**, so the
  board's `no_board` refusal never reached the panel as a code. "No board yet" is now
  a VALUE (`{ exists: false }`), not an error a client has to classify.

| | |
|---|---|
| Reference | [`maddada/Ghostex`](https://github.com/maddada/Ghostex) @ `76a7dd2` (2026-11-22, MIT) |
| Reference files | `apps/desktop/src/app/native_kanban/**`, `packages/gx-protocol/src/beads_view.rs` |
| Kabmo sources read | `packages/kabmo-sdk/src/{app,slots,slots-sidebar,backend}.ts`, `packages/kabmo-ui/src/{services,panels,participant,sidebar}.ts`, `src/client/lib/plugins/{context,bootstrap,sidebar-bridge,topic,composer-bridge}.ts`, `src/client/components/workspace/plugin-panel/catalog.tsx`, `src/server/lib/plugins/*`, `docs/reference/plugin-sdk.md` |
| What was RUN | reads, greps, GitHub raw fetches, one `omp` CLI probe, `kabmo plugin build`, an MCP stdio smoke over `dist/server.js`, and the plugin's own suite (Appendix D). **No browser was opened** — the panel's visual proof is still outstanding. |

---

## 1. Ghostex's board, as built

### 1.1 The board is a view over a store the agents already use

Ghostex's view was called Kanban and is now the **Beads** view. Each card is a *bead*
kept by [Beads](https://github.com/gastownhall/beads) — a Dolt-backed issue tracker that
lives in the repository (`.beads/`), driven by the `bd` CLI. The board never owns card
state: it reads `bd list --all -n 0 --json` plus `bd ready --explain --json`, and every
mutation is a `bd` call (`create`, `updateStatus`, `updatePriority`, `updateEstimate`,
`setLabels`, `depAdd`, `comment`, `delete`) routed through gxserver's
`/api/runBeadsAction` (`native_kanban/beads.rs`).

That is the load-bearing decision: **the same rows the UI drags are the rows the agents
read and write.** Ghostex ships a skill (`ghostex-manage-beads`) and a "Ghostex Project
Board Beads" integration so an agent claims a bead, comments progress and closes it.

### 1.2 Lanes

`native_kanban/model.rs` defines six built-in lanes and then one lane per custom status:

| key | label | bd status | hideable |
|---|---|---|---|
| `backlog` | Backlog | `backlog` | yes |
| `todo` | Todo | `open` | no |
| `in_progress` | In Progress | `in_progress` | no |
| `test` | Test | `test` | yes |
| `review` | Review | `review` | yes |
| `done` | Done | `closed` | no |

Custom statuses live in the project's bd config `status.custom`; the Columns dialog adds,
renames-by-replacement, reorders and deletes them, and **refuses to delete a lane that
still holds cards** ("Move its cards out before deleting"). Hidden lanes are stored in
`custom.ghostex.board_hidden_columns`, and a hidden lane that still holds cards keeps
showing — hiding never makes a card vanish.

### 1.3 A card

Card anatomy (`native_kanban/card.rs`): display id and assignee, title with a mono `P0`–`P4`
priority tag, a meta line (type, estimate, timestamps), grey label chips, and the linked
agent/session. Seven card-view toggles (id, priority, assignee, description, labels,
details, conversation links) are **in-memory view preferences**, not stored.

Fields the board reads per row (`gx-protocol/src/beads_view.rs`): `id`, `title`, `status`,
`priority`, `issueType`, `assignee`, `labels`, `parent`, `deferUntil`, `dueAt`,
`updatedAt`, `closedAt`, `commentCount`, `ready`, `blockedBy`, `blocks`, `needsDecision`.
**Rows are deliberately slim** — no description, design or notes; the detail panel reads
those with a separate `show` call.

### 1.4 Filters

`native_kanban/filters.rs`: priority, estimate (t-shirt, `none`), tag, plus a word query
that must match every word in title/description/id/display id/labels; sort is one of
default, updated ↑/↓, created ↑/↓, priority ↑/↓. **Done defaults to newest-closed first**,
other lanes keep the tracker's order. A stored tag filter that no card carries reads as
"all" without being overwritten.

### 1.5 Moving a card

Drag = status update, optimistically applied (`mutations.rs`):

1. bump a per-card move token, store `pendingMoves[card] = { status, token }`;
2. repaint the card in the target lane immediately;
3. call `bd updateStatus`;
4. on failure, revert to the previous status and toast "Could not move the ticket";
5. a second move supersedes the first by token, so a slow failure cannot undo a newer move.

There is **no manual ordering inside a lane** — the tracker has no order field, and the
board sorts instead. That removes a whole class of write conflicts.

### 1.6 Start work

`native_kanban/conversation.rs` + `text.rs`:

- disabled when no agent is configured and the card has no linked session;
- spawns an agent session with a prompt naming the bead, its title, its description, and
  the exact upkeep commands (`gx board associate <id>`, `bd comment`, status transitions
  `backlog → in_progress → test → review → close`);
- the launched session is linked to the card, and the card then offers **Go to Session**
  (or Resume) instead of Start work;
- Ghostex also moves the bead to In Progress as part of the flow.

### 1.7 Readiness and "needs a decision"

`ready` and `blockedBy` come from `bd ready --explain`. The protocol models readiness as
**tri-state** (`BeadsReadiness::Ok | Unavailable | Paused`): when the ready read and the
list read disagree, readiness is withheld rather than shown wrong. `needsDecision` is
`bd human` (the `human` label) and drives the tree view's "Needs a decision" section with
an **Answer** button.

The view also has four explicit workspace states — `Ready`, `None` (setup card),
`NoBd` (install card), `Failed` — rather than one generic empty state.

### 1.8 Scale and layout

`native_kanban/lane.rs`: lane min width **230 px**, gap 10, card gap 8, card height hint
96 px, overdraw 240 px, **at most 120 visible cards per lane** (the rest are summarised).
Lanes sit side by side and the board scrolls horizontally. First load draws skeleton
cards; a lane scrolled out of view draws only its header. The board is a project view
panel beside the sessions, can be popped into its own window, and is reachable from a
session's long-press menu on the phone.

### 1.9 Sync

Dolt remotes: header shows last pull/push and runs them; the protocol carries
`remote`, `running`, `lastPushAt`, `lastPullAt`, `lastResult` with a result code
(`ok`, `notFastForward`, `conflict`, `noRemote`, `auth`, `network`, `timeout`, `other`).
Git is not the sync mechanism.

---

## 2. The lessons that transfer

Each one names the failure it prevents.

1. **One store, and the agents can reach it.** A board only the UI can write rots: the
   user drags cards, the agent finishes work, the card still says In Progress. Ghostex
   solves it by making the tracker repo-local and CLI-accessible. Any Kabmo design must
   answer "how does the agent update this card?" before it answers "how does it look".
2. **Status is the lane key, not a boolean.** Six lanes over a five-value tracker forced
   Ghostex to maintain a status↔lane mapping and a custom-status config with category
   suffixes. A native store should make the lane id *be* the status value.
3. **Optimistic move with a token and a rollback.** A drag that waits for a write feels
   broken; a drag that never rolls back lies. Ghostex does both halves.
4. **A card is a link hub.** Display id, priority, labels, estimate, blocking edges and a
   live session link — not a title and a checkbox.
5. **Never lose a card.** Hidden lanes still show when they hold cards; unknown statuses
   and unreadable rows are surfaced, never filtered away.
6. **Slim rows, detail on demand.** The list payload carries no descriptions; the detail
   read does. This is what keeps a 500-card board cheap over a socket.
7. **Readiness is tri-state.** "Not blocked" is a claim; when it cannot be computed, say
   so instead of drawing a green dot.
8. **Lane configuration is board data, not user preference.** Custom lanes and hidden
   lanes live with the board so every machine and every agent sees the same board.
9. **No manual ordering in v1.** Sort by priority/updated; it removes a conflict class and
   matches the reference.
10. **Empty states name the cause.** No workspace, no board, unreadable board, empty board,
    and a failed read are five different screens.

---

## 3. What Kabmo's plugin platform gives us

### 3.1 Slots

A plugin is an ESM bundle the host `import()`s into its own Preact tree — same document,
same theme, no iframe (`src/shared/types/panels.ts`). Positional slots are one per plugin
and a duplicate throws: `rightPanel`, `panel` (editor takeover), `headerPanel`,
`settingsSection`. List slots include `commandPaletteAction`, `composerAction`,
`messageAction`, `fileOpener`, `timelineRenderer`, and `contentScript` (code mounted with
no component; its disposer is required).

A right panel receives `{ sessionId, workspacePath }` — but the catalog renders plugin
panels with `workspacePath={null}` (`plugin-panel/catalog.tsx`), so a plugin must read
`usePanelInfo()` (the context `PluginBootstrap` publishes, mounted by both the desktop
layout and `mobile/LayoutWrapper.tsx`).

### 3.2 Hooks and services

| Need | API |
|---|---|
| Active session/workspace/theme | `usePanelInfo()` |
| Read a workspace file | `useWorkspaceFile(relativePath)` (read only) |
| Call the plugin's server | `useRpc(method)` — `{ ok, value } | { ok, error }`, superseded calls dropped |
| Follow the plugin topic | `useRealtime()` — snapshot on subscribe, `stale` flag |
| Read/write the composer | `useComposer()` — `set`, `insert`, `focus`; **no `send`** |
| Sessions | `experimental_useSidebarThreads()` (`isRunning`, `awaitingInput`, `folderId`) and `experimental_useSidebarThreadActions()` (`open`, `openNew`, `rename`, …) |
| Shared repo pick | `useRepoScope()` |
| Markdown | the host's renderer through `services.markdown()` / `<Markdown>` |

`openNew(options?)` pushes a `sessionId=new-<epoch>` URL param and returns `void`; the
pending row is adopted into a real session after the first send, and **the plugin is not
told the real id** (no adoption event in the kit). That matters for "start work" (§5.6).

### 3.3 Server half

`export default function plugin(api: KabmoPluginApi)`, built for Bun, imported by Kabmo's
process. It gets: `rpc` (own client only), `http` (exact paths under
`/api/plugins/<id>/http/*`), `realtime` (ONE topic per plugin, with `seed`/`publish`/
`current`), `events`, `background.service|schedule` (host-owned clock), `mcp.register`
(host owns delivery — ACP today, omp-rpc only after H1), `storage.kv` and `storage.records`, `settings`, `log`,
`onDispose`. `@/…` imports do not resolve in a plugin build (M09, F10), so a plugin cannot
reuse host modules.

`storage.records` is `put/get/list({limit})/remove/clear` per collection, namespaced by
plugin id, `list` ordered `updated_at DESC`. There is no query, no transaction, and no
per-field index.

### 3.4 MCP: the agent surface, with three sharp edges

`api.mcp.register` is meant to add a server every harness receives. Three limits decide the
store and one of them is a host bug:

- a plugin MCP server has **no `cwd` field** (`PluginMcpServer`), so a stdio child runs in
  the agent's own cwd — useless for a board outside every checkout. Solved by declaring the
  path in `env` at registration (`env` IS part of the contract);
- an HTTP MCP pointed at the plugin's own route would be behind `authGate` whenever the
  console has a password (every Elysia route is gated), so it only works unauthenticated;
- **delivery is ACP-only today.** `ensureSessionMcpOverlay` writes
  `sources: ['user','project']` for omp's RPC child and skips the overlay entirely when a
  session has no MCP overrides, so an `omp-rpc` chat sees none of the plugin's tools. The
  overlay's own comment says it: "App-local rows and plugin contributions are ACP-only
  today". Fix H1 (§6) — without it decision 3 does not work on the default harness.

A **stdio MCP that reads the same files as the UI** solves the first two; only H1 solves the
third.

### 3.5 Layout and theming facts

- Plugin right panel: floor 320 px, opens at 560 px, default fraction 0.4 (cap 0.9)
  (`shared/lib/workspace/panel-widths.ts`). A 560 px board shows two 230 px lanes and
  scrolls sideways; the phone drawer is ~390 px.
- A plugin panel is **unmounted when hidden** (`liveWhileHidden: false` in the catalog), so
  any live behaviour must live in the server half.
- Theme through `--theme-ink`, `--theme-paper` (raised), `--theme-canvas` (ground),
  `--theme-meta`, and the `-text` variants for readable status text. Chroma outside the
  palette is only `--theme-error` (syntax highlighting excepted).
- A plugin's stylesheet is loaded only when the manifest declares `css`; `dist/` is
  gitignored and built on install (`kabmo plugin build`).

### 3.6 Gaps and defects found while reading

| # | Finding | Consequence |
|---|---|---|
| G1 | `ComposerService` has `set/insert/focus`, **no `send`** | Not needed: Start work calls `POST /api/agent/new` directly (the route the composer itself uses), which spawns AND sends the first prompt. |
| G2 | `openNew()` returns nothing and adoption is invisible to plugins | Avoided: `/api/agent/new` answers the real `sessionId`, so the card links on the same response. `openNew` is only used for a plain "New chat" button, if at all. |
| G3 | The kit has no workspace-path → `folderId` resolver | `openNew({ folderId })` needs an id, and the board is global so a card's workspace may not be the active one. Solvable in the plugin: `useKabmoFetch('/api/settings/projects')` returns each folder's `id` + `project_path`, so Start work resolves the card's path itself and refuses by name when no folder matches. |
| G4 | One realtime topic per plugin | Fine now: one board, so the topic is `{ revision }` and every panel re-reads on a change. |
| G5 | Plugin RPC inputs are trusted | There is no client-supplied root, so the attack surface is the card id: `^k-[0-9a-f]{6}$`, resolved under `cards/`, `realpath`-checked. |
| G6 | `purgePluginState` (`server/lib/plugins/schema.server.ts`) has **no caller** (`rg` across `src`) | Removal currently leaves `plugin_kv`/`plugin_records`/`plugin_settings`/`plugin_schedules` behind, contrary to its own doc comment. The board avoids that store entirely, and that is part of why (§5.3). |
| G7 | `KabmoPluginApi` exposes **no data directory** | A plugin that keeps files must re-derive `<dataDir>` from `KABMO_DATA_DIR`/`~/.kabmo` — a second copy of a fact `getDataDir()` owns. Fix: H3 (`api.paths.dataDir`); until then, duplicate the two lines with a pointer comment. |
| G8 | **Plugin MCP is delivered to ACP only.** `ensureSessionMcpOverlay` writes `sources: ['user','project']` and its comment says plugin contributions are "ACP-only today"; with no per-session overrides no overlay is built at all | Decision 3 is dead on the default harness. Fix H1 (§6) |
| G9 | **No system-prompt plumbing.** omp 19.1.0 accepts `--append-system-prompt` (measured: `--mode rpc-ui` booted to `ready` with it plus `--skills`), but `buildSessionSpawnArgs` passes only resume/approval/extension args, and `/api/agent/new` has no field for it. ACP `session/new` has no system-prompt field at all | Decision 7 is prompt-prefix only until H2 lands |

---

## 4. Decisions (from the maintainer, 2026-11-23)

Seven rulings, and each one changes the design below rather than decorating it.

| # | Decision | What it forces |
|---|---|---|
| 1 | Both scopes exist; the view defaults to the workspace when one is open, else global | One store, two lenses, a per-card workspace stamp |
| 2 | Kanban is **control only** — no extra knowledge | No description, comments, labels, epics or dependencies. A card is status + assignment + task |
| 3 | Kanban exposes **MCP tools**, so the AI moves its own cards (`in_progress → review`) | MCP is v1, and the host must deliver plugin MCP to omp-rpc (§5.7, H1) |
| 4 | A task is like a queue message: a composer plus harness and model picks | `task` = prompt + images + agent snapshot, resolved per card |
| 5 | A task in progress is **linked to its session** | `sessionId` on the card, live pill, Start work / Send to session |
| 6 | Every stage overrides harness/model, falling back to the defaults | Stage-level `agent`, field-by-field fallback (§5.4) |
| 7 | Every stage sets a system prompt, so it can use skills | Stage `prompt`; appended as a real system prompt on omp-rpc (H2), prepended on ACP |

Decision 2 is the sharpest: it deletes about half of the earlier draft. What is left is the
smallest thing that can still drive work — which is also what makes it cheap to sync and
easy for an agent to read.

---

## 5. Design

### 5.1 Identity

| | |
|---|---|
| Plugin id | `kanban` |
| Name / panel title | `Board` / `Kanban` |
| Directory | `marketplace/plugins/kanban/` |
| Slots | one `rightPanel`; optionally one `panel` (same component, wide) — §5.9 |
| Capabilities | `panel`, `server`, `rpc`, `realtime`, `mcp` |
| Settings | none. Stages and defaults are BOARD data (`board.json`), so every machine and every agent sees the same configuration |
| Icon / colour | three-column glyph; manifest `color` |

### 5.2 Scope: two lenses, one store

- **One board** at `<dataDir>/kanban/` (`~/.kabmo/kanban`, or `KABMO_DATA_DIR`). Same root as
  `db.sqlite`, so backup is one directory.
- **A card carries `workspace: string | null`.** `null` is the global bucket.
- **The default lens follows the user**: a workspace is open → that workspace's lens; no
  workspace → `All` (global). The choice is remembered per session in
  `useSessionState('kanban.lens')`, so switching chats does not reset it.
- **Lenses filter, never move.** `All · <workspace> · Unfiled`. A card is never duplicated
  into a second board, and there is no "move card to another board" operation to get wrong.
- **New cards are stamped with the active workspace**, or `null` when none is open. The stamp
  is editable in the card sheet.
- **A deleted checkout does not delete cards.** The stamp is a path, not a foreign key; the
  sheet marks a folder that no longer exists, and Start work refuses it by name.
- **A workspace is required only to RUN a task**, never to read or plan one.

### 5.3 The store, control-only

```
<dataDir>/kanban/
├── board.json            schema, defaults, stages
└── cards/<id>.json       one card per file
```

`board.json`:

```json
{
  "schema": 2,
  "defaults": {
    "harness": "omp-rpc",
    "model": null,
    "thinking": null,
    "access": "always-ask",
    "prompt": ""
  },
  "stages": [
    { "id": "backlog", "label": "Backlog", "hidden": false, "session": false },
    { "id": "open", "label": "Todo", "hidden": false, "session": false },
    {
      "id": "in_progress", "label": "In Progress", "hidden": false, "session": true,
      "agent": { "thinking": "high", "access": "write",
                 "prompt": "Work the card. Move it to review when the change is ready." }
    },
    {
      "id": "review", "label": "Review", "hidden": true, "session": true,
      "agent": { "harness": "claude", "thinking": "high", "access": "always-ask",
                 "prompt": "Review the change against the card. Use the pr-review skill." }
    },
    { "id": "test", "label": "Test", "hidden": true, "session": false },
    { "id": "done", "label": "Done", "hidden": false, "session": false }
  ],
  "updatedAt": "2026-11-23T10:00:00.000Z"
}
```

`cards/k-3f8a2c.json`:

```json
{
  "schema": 2,
  "id": "k-3f8a2c",
  "title": "Fix composer portal",
  "status": "in_progress",
  "priority": 1,
  "workspace": "/Users/rajeb/projects/kabmo",
  "task": {
    "prompt": "The Goal dialog opens in front of the composer. Reproduce at 1440x900 and fix it.",
    "images": [],
    "agent": { "harness": "omp-rpc", "thinking": "high" }
  },
  "sessionId": "01a0cc50-fd62-7417-899c-e24ff8c8608c",
  "createdAt": "2026-11-22T09:00:00.000Z",
  "updatedAt": "2026-11-23T09:30:00.000Z",
  "movedAt": "2026-11-23T09:31:00.000Z"
}
```

Rules that are load-bearing:

- **`status` is a stage id.** A card whose status matches no stage is shown under **Unplaced**
  with the file named — never dropped, never silently rewritten.
- **`task.agent` is a PARTIAL snapshot.** Every field is optional and resolves independently
  (§5.4), so a card may override only the thinking level and inherit the stage's harness.
- **`task.images`** carries `{ name, mimeType, dataBase64 }`, the same shape the queue persists
  for images; they ride `/api/agent/new`'s `images` field unchanged. Text attachments are
  deliberately not stored (decision 2): a card names files by path instead.
- **`priority`** is `0..4` (`P0`–`P4`). It is control, not knowledge: it decides what
  `kanban_next` returns.
- **Nothing else is stored.** No description, comments, labels, parent, blockers, assignee.
  A card that needs prose keeps it in its `task.prompt`, which is what the agent actually reads.
- **Unknown fields are preserved** on write, so a newer writer's field survives an older UI.
- **Ids** are `k-` + 6 lowercase hex, collision-checked against `cards/`.
- **Writes are atomic** (`<file>.tmp` + `rename`) and carry `baseUpdatedAt`; a mismatch is a
  `stale` refusal that names the card.

### 5.4 Stage configuration and fallback

Four levels, resolved **per field**, first non-null wins:

```
card.task.agent  →  stage.agent  →  board.defaults  →  host default
```

| Field | Host default when nothing is set |
|---|---|
| `harness` | `omp-rpc` |
| `model` | the project's "Defaults for new chats", else the composer's persisted pick (`/api/agent/new` already resolves this) |
| `thinking` | `null` — the harness's own default |
| `access` | the persisted approval mode (`omp_access_mode` / `harness_access_modes`) |
| `prompt` | empty |

That is exactly the fallback chain `/api/agent/new` already implements for the composer
(`projectModelForCwd` → `loadPersistedModel`, `loadPersistedAccessMode`), so the board adds no
second resolution rule — it only fills the request.

**The stage prompt** (decision 7) is applied two ways, because the transports differ:

- **omp-rpc, new session** — `--append-system-prompt <text>` at spawn (measured: omp 19.1.0
  accepts `--append-system-prompt` and `--skills` together in `--mode rpc-ui`; the child booted
  to `ready`. Whether the text is honoured by the model was not measured — P0 verifies it).
  `--skills=<glob>` can also narrow the catalog for a stage, e.g. a review stage allowed only
  `review-*`.
- **ACP harnesses** — ACP `session/new` has **no system-prompt field**
  (`src/server/lib/harness/acp/protocol.ts`), so the stage prompt is PREPENDED to the task
  prompt in a delimited block. Same content, weaker position; the card sheet says which
  transport got which treatment.
- **A linked session that already exists** — spawn flags cannot change, so the stage prompt is
  prepended to the follow-up prompt. This is stated in the sheet rather than hidden.

Stage config is validated on save: `harness` must be in the catalog, `access` must be an
approval mode, `prompt` is capped (8 KB), and a stage id must match `^[a-z][a-z0-9_]{0,31}$`.

### 5.5 The task composer (decision 4)

The card sheet's lower half is a small composer, deliberately the same fields as the chat's:

```
Prompt        ┌──────────────────────────────────────────────┐
              │ The Goal dialog opens in front of the composer│
              └──────────────────────────────────────────────┘
              [ + image ]   (drop or pick; stored as base64)
Agent         [ omp-rpc      v ]  [ model        v ]  [ high  v ]  [ write v ]
Resolved from  card → in_progress → board defaults        (see the chain)
```

- The pickers read the SAME catalogs the composer does: `GET /api/harness` (harnesses, their
  configured state and probed selectors) and `GET /api/models` (omp's registry). A harness
  whose models are unknown shows "not reported yet" rather than omp's list (the rule
  `harnessModels` already enforces in the host).
- A field the user has not touched renders as the INHERITED value with its origin named
  ("stage: in_progress"), so an override is visible before it is made.
- **Start work** and **Send to session** are the two actions; the first spawns, the second
  posts to the linked session. Both are disabled while the prompt is empty.

### 5.6 Start work, linkage and the live pill (decision 5)

**Start work** is one host call, no pending-session heuristic:

```ts
POST /api/agent/new
{ type: 'prompt', cwd, harness, provider, modelId, thinkingLevel, accessMode,
  systemPrompt,                       // H2: omp-rpc only, omitted for ACP
  message: stagePromptOnAcp + taskPrompt, images }
→ { success: true, sessionId }
```

`stagePromptOnAcp` is empty for omp-rpc (the stage prompt already rode `systemPrompt`) and the
delimited block for ACP, so the agent never receives the same instructions twice.

The route already does everything the composer does — resolve the model, apply
`set_model`/`set_thinking_level`, spawn omp or ACP, run the first prompt
(`src/server/routes/agent/new.ts`) — so the board is not a second spawn path.

On success:

1. `card.sessionId = sessionId`, `movedAt = now`;
2. if the card is in a stage with `session: false`, it moves to the first `session: true`
   stage (`in_progress`) in the same write — the two facts land together or not at all;
3. the sheet offers **Open chat** (`sidebarActions().open(sessionId)`).

**Send to session** is the follow-up path, used when the card already has a session. It sends
the resolved snapshot first (`set_model`, `set_thinking_level` — the same pair the queue's
delivery applies) and then `POST /api/agent/:sessionId` with `{ type: 'prompt', message,
images }`. The stage prompt is prepended, because spawn flags cannot change. A session that is
gone is reported ("That chat no longer exists — start work again"), never silently re-spawned.

**The pill** is live from `experimental_useSidebarThreads()`: `running` (spinner),
`needs you` (`awaitingInput`), `idle`, or `unlinked`. A card in a `session: true` stage with
no session shows **Start work** as its primary action — that is decision 5's visible half.

**Agent-initiated work**: an agent that picks a card through MCP can move it, but cannot spawn
a Kabmo session. `kanban_move` therefore returns `next: "start_work_required"` when it lands in
a `session: true` stage with no session, and the card shows Start work. The panel's **Link
this chat** action sets `sessionId` to the active session for the agent that is already
working (§5.8).

### 5.7 MCP: the tools an agent uses (decision 3)

**One process, one entry.** The plugin's server bundle runs as its own stdio MCP server:

```ts
// src/server.ts — the same file the host imports
if (Bun.argv.includes('--mcp')) runKanbanMcp();        // top-level guard, harmless when imported
export default function plugin(api: KabmoPluginApi) { /* … */ }
```

Registration at load:

```ts
import { fileURLToPath } from 'node:url';

api.mcp.register({
  id: 'board',
  transport: 'stdio',
  command: Bun.which('bun') ?? 'bun',
  // fileURLToPath, not `.pathname`: on Windows the latter yields `/C:/…`.
  args: [fileURLToPath(new URL('./server.js', import.meta.url)), '--mcp'],
  env: { KANBAN_DIR: join(dataDir(), 'kanban') },
});
```

`env` is what makes this work with no `cwd` field on `PluginMcpServer`: the child is told where
the board is, instead of guessing from the agent's directory. `import.meta.url` resolves to
`dist/server.js` in the built bundle, so the arg is the file that is already there — no second
build entry, no build script.

**Tools** (names are the agent's whole vocabulary; each answers JSON):

| Tool | Input | Behaviour |
|---|---|---|
| `kanban_list` | `{ workspace?, status?, limit? }` | Cards as slim rows: id, title, status, priority, workspace, sessionId |
| `kanban_next` | `{ workspace? }` | The highest-priority card not in a `done` stage and not linked to a running session, plus its stage prompt |
| `kanban_get` | `{ id }` | The whole card, its stage config, and the resolved agent settings |
| `kanban_create` | `{ title, prompt?, workspace?, status? }` | New card; `workspace` defaults to the caller's `cwd`, which the panel later matches against its registered folders |
| `kanban_move` | `{ id, status }` | The move decision 3 exists for; returns `next: "start_work_required"` when the target stage runs a session and none is linked |
| `kanban_claim` | `{ id, session_id? }` | Records `sessionId` when given, and moves the card to the first `session: true` stage |
| `kanban_update` | `{ id, title?, priority?, prompt? }` | Control fields only — never a description or comment |

Every tool reads and writes the SAME files the panel does, with the same atomic write, the same
id validation and the same `stale` check. There is no second store and no daemon.

**The host gap this exposes (H1).** `api.mcp.register` is delivered to ACP harnesses only:
`ensureSessionMcpOverlay` materializes `sources: ['user', 'project']` for omp's RPC child
(`src/server/lib/mcp/session-overlay.server.ts:118`) and its own comment says plugin
contributions are "ACP-only today"; the overlay is also skipped entirely when a session has no
MCP overrides. So on the default harness an agent would see no `kanban_*` tools. The fix is
small and belongs in the host, not the plugin:

1. include `'plugin'` in the overlay's sources;
2. build the overlay when plugin servers exist, even with no per-session overrides
   (`{ keep: pluginMcpServers().length > 0 }` in `sessionMcpSpawn`).

Both are pinned by a test in `session-mcp.test.ts` (a plugin stdio server appears in the
overlay's `mcp.json`; a session with no overrides still gets an overlay when a plugin
contributes one).

### 5.8 Wire contract (plugin RPC)

| Method | Input | Answers |
|---|---|---|
| `openBoard` | `{}` | `BoardSnapshot` |
| `initBoard` | `{}` | `BoardSnapshot` (creates `board.json`) |
| `readCard` | `{ id }` | `CardDetail` |
| `createCard` | `{ title, status?, workspace?, task? }` | `{ card, revision }` |
| `updateCard` | `{ id, patch, baseUpdatedAt }` | `{ card, revision }` |
| `moveCard` | `{ id, status, baseUpdatedAt }` | `{ card, revision }` |
| `deleteCard` | `{ id }` | `{ revision }` |
| `linkSession` | `{ id, sessionId \| null }` | `{ card, revision }` |
| `saveStages` | `{ stages }` | `{ board, revision }` |
| `saveDefaults` | `{ defaults }` | `{ board, revision }` |
| `resolveAgent` | `{ id, stage }` | The resolved harness/model/thinking/access/prompt + which level each came from |

`BoardSnapshot` is `{ dataDir, revision, board, cards, errors }`; `cards` are slim (no
`task.prompt` — the detail read carries it), so a 500-card board stays small. Failure is a
value (`{ ok: false, error: { code, message } }`) with `no_board`, `not_found`, `invalid`,
`stale`, `no_workspace`, `io`. `resolveAgent` is what the sheet renders, so the UI and Start
work cannot disagree about which stage value won.

**Realtime topic is an invalidation signal**: `{ revision, at }`. Every accepted mutation — from
the panel OR from the MCP child (the watcher sees the file) — publishes it, and every open panel
re-reads after a ~150 ms debounce.

### 5.9 Panel

- **Header**: title, card count, lens chips (`All 12 · kabmo 9 · unfiled 3`), `New card`,
  `Filter`, `Refresh`, overflow (`Stages…`).
- **Board**: horizontal stages, cards on paper, stage header with count and `+`. Stage width
  floor 200 px, horizontal scroll, 120 cards per stage with "N more — narrow the filter".
- **Card**: id, priority tag, title, workspace badge (only in `All`), the session pill, and a
  one-line prompt preview.
- **Card sheet**: title, stage select, priority, workspace, the task composer (§5.5), the
  resolved agent line, `Start work` / `Send to session` / `Open chat` / `Link this chat`,
  Delete.
- **Stages sheet**: per stage — label, hidden switch, `runs a session` switch, harness, model,
  thinking, access, prompt (with a "prepended on ACP" note), and `Reset to defaults`.
- **States**: no board (Create), unreadable board (path + reason + Retry), empty board, empty
  for this lens ("9 cards are filed under kabmo — Show all"), per-file read errors, a stage id
  that no longer exists (Unplaced), and a workspace folder that is gone.
- **Phone**: one stage at a time with a sticky stage bar; the sheet is full-height; 44 px
  targets; the composer's pickers collapse into one row of chips.
- **Drag**: pointer-based between stages (no in-stage ordering); a stage select exists, so drag
  is an enhancement. `aria-live` announces the move.
- **Theme**: `--theme-canvas` ground, `--theme-paper` cards, `--theme-ink` text,
  `--theme-meta` secondary, `--theme-error` for unreadable files. No hex in components.

### 5.10 Server behaviour

- **Two writers, one lock.** The panel (Kabmo's process) and the MCP child (a separate Bun
  process) both write `cards/`. Atomic rename protects a reader from a torn file but not from a
  lost update, so both take a lock file `cards/.write.lock` (`open(…, 'wx')`, retried 20 × 5 ms,
  considered stale after 5 s) around read-modify-write. The panel additionally serialises its
  own writes with a per-card promise chain and checks `baseUpdatedAt`; the MCP child re-reads
  immediately before writing, which is all an agent-side move needs.
- Atomic writes; `fs.watch` with a 150 ms debounce and one 100 ms retry before an unreadable
  file is reported.
- **Path safety**: the root is `join(dataDir(), 'kanban')`, fixed. Ids must match
  `^k-[0-9a-f]{6}$`; resolved paths are `realpath`-checked under `cards/`.
- **Never delete the board on uninstall.** `onDispose` closes the watcher and nothing else.
- **No implicit writes**: opening the panel reads only; `initBoard` is an explicit action.

### 5.11 Tests

- **Store**: init; create; partial update; move; delete; unknown field preserved; invalid JSON
  reported with its path; unplaced stage; stale refused; bad id refused; symlink refused; the
  board survives plugin removal.
- **Resolution**: the fallback chain per field, including a card that overrides only
  `thinking`; `resolveAgent` agrees with what Start work sends.
- **Scope**: default lens follows the workspace; a card keeps its stamp when the folder is gone;
  a new card is stamped with the active workspace or `null`.
- **Concurrency**: two processes (the test forks) moving and editing the same card 50 times
  leave one of the two writes, never a torn file and never a lost lock.
- **MCP**: every tool against a `mkdtemp` board — `kanban_move` returns
  `start_work_required`; `kanban_claim` records the session; a bad id is a JSON error, not a
  crash; the server answers `initialize`/`tools/list`/`tools/call` on stdio.
- **Panel**: stage order; hidden stage with cards still renders; the sheet's inherited-vs-
  override rendering; Start work's request body (fake `fetch`); the phone layout.
- **Host H1**: a plugin stdio server reaches omp-rpc's overlay; no overrides still yields an
  overlay when a plugin contributes.
- **Host H2**: `systemPrompt` reaches `--append-system-prompt` for omp-rpc and is prepended for
  ACP.

---

## 6. Host changes this design needs

| # | Change | Files | Why it is not optional |
|---|---|---|---|
| H1 | Deliver plugin MCP to omp-rpc: add `'plugin'` to the overlay's sources and force the overlay when plugin servers exist | `src/server/lib/mcp/session-overlay.server.ts`, `src/server/lib/omp/rpc/spawn-mcp.ts`, `session-mcp.test.ts` | Decision 3 is dead on the default harness without it |
| H2 | Accept `systemPrompt` on `/api/agent/new` and pass `--append-system-prompt` to a cold omp spawn (and invalidate a prewarmed child, which has none) | `src/server/routes/agent/new.ts`, `src/server/lib/omp/rpc/session-registry.ts`, `src/server/lib/omp/rpc/constants.ts` | Decision 7 asks for a real system prompt, and only omp can take one |
| H3 | `api.paths.dataDir` on `KabmoPluginApi` | `packages/kabmo-sdk/src/backend.ts`, `src/server/lib/plugins/loader.server.ts` | Otherwise the plugin re-derives `getDataDir()` (G7) |
| H4 (optional) | Interpolate `${sessionId}` / `${cwd}` in plugin MCP `env` | `src/server/lib/mcp/registry.server.ts` | Lets `kanban_claim` link the agent's own session without a UI click |

H2 detail worth writing down: `--append-system-prompt` is a SPAWN flag, so a session that was
prewarmed without one must not be adopted. `startNewRpcSession` already kills a warm entry
whose mode selection differs; the system prompt is a second such reason.

---

## 7. Risks

| Risk | Why it bites | Mitigation / check |
|---|---|---|
| **Plugin MCP invisible on omp-rpc** | Today's overlay excludes plugin sources and is skipped without overrides | H1, pinned by a test; smoke-test `tools/list` in a real omp chat |
| **System prompt divergence** | omp gets it appended; ACP gets it prepended; a linked session gets it prepended | `resolveAgent` reports the transport and the sheet says which treatment applies |
| **Stage prompt on a live session** | Spawn flags cannot change; a follow-up re-prepends | Documented; the pill shows the session so the user knows |
| MCP child per session | Every omp chat now starts one stdio child | Measure spawn cost; the child is idle-cheap and reads only on a tool call |
| **Two writers on one card** | Panel and MCP child can read-modify-write at once | `cards/.write.lock` (§5.10) + atomic rename; a test drives both writers at one card |
| Composer drift | The board's pickers could disagree with the chat's | Same endpoints (`/api/harness`, `/api/models`); `resolveAgent` is the single resolution |
| 560 px right panel | Two stages visible | Horizontal scroll; the wide takeover (§5.9) is the escape hatch |
| Touch drag | HTML5 DnD is inert | Pointer events + stage select |
| Images in cards | base64 bloat in a JSON file | Cap 2 MB per card and 4 images; the sheet refuses by name |
| No cross-machine sync | `~/.kabmo` is per machine | Stated; backup = copy the dir |
| Windows | `rename` over an existing file, `fs.watch` | Store suite on Windows CI |
| Removal leaves plugin state | G6 (`purgePluginState` uncalled) | Not this path: the board is files, which removal must NOT purge |

---

## 8. Phases

| Phase | Deliverable |
|---|---|
| P0 | Freeze `board.json`/card schema; verify `--append-system-prompt` is HONOURED (not just accepted) with a one-turn omp run |
| P1 | Host H1 (plugin MCP → omp-rpc) + test — decision 3 cannot ship without it |
| P2 | Pure store + stages + resolution + ids, fully tested (no UI) |
| P3 | Server half: RPC, atomic writes, watcher, realtime revision |
| P4 | MCP server (`--mcp` entry, 7 tools) + tests |
| P5 | Panel read-only: header + lens chips, stages, cards, sheet, states |
| P6 | Writes: create/move/edit/delete, optimistic move + rollback, stale handling |
| P7 | Task composer + `resolveAgent` + Start work / Send to session / Link this chat |
| P8 | Stages sheet (harness/model/thinking/access/prompt) + host H2 |
| P9 | Phone layout, keyboard, drag, aria-live, theme pass |
| P10 | README, `marketplace.json` entry, install + browser smoke |

## 9. Gates

- `bun test marketplace/plugins/kanban/` and `bun test src/server/lib/mcp`
- `bun run lint`; `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `bun run build`; `bun run typecheck:consumer`; `bun test`
- `kabmo plugin build kanban`, install from the bundled store, then in a browser:
  create a card, Start work on `in_progress`, watch the session pill go `running → idle`,
  ask the agent in that chat to move the card to `review`, and confirm the panel moves it
  without a reload (this is the end-to-end proof of decisions 3, 5 and 7).
- Store suite also on Windows CI.

## 10. Out of scope (v1)

- Any knowledge store: descriptions, comments, labels, epics, blockers, assignees, due dates,
  defer, WIP limits, swimlanes, attachments beyond images.
- Manual ordering inside a stage; a second board per workspace; cross-machine sync.
- Auto-starting a session when an MCP move lands in a `session: true` stage (the card shows
  Start work instead — a spawn nobody asked for is worse than one click).
- Beads/GitHub/Linear sync.

## 11. Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Should `kanban_move` into a `session: true` stage auto-start the session? | No in v1: return `start_work_required` |
| Q2 | Should the stage prompt also restrict skills (`--skills`)? | Offer it per stage, off by default |
| Q3 | One MCP server per plugin (current) or a shared "kanban" server name? | Per plugin: the name is `kanban:board` unless the plugin sets one |
| Q4 | Priority scale: `P0..P4` (Beads) or `1..5`? | `P0..P4`, it is what every reference uses |

---

## Appendix A — Ghostex file map (what to re-read)

| File | What it settles |
|---|---|
| `native_kanban/model.rs` | Lanes, custom-status config, hideable columns, t-shirt estimates, priority labels |
| `native_kanban/lane.rs` | Lane width/scroll/overdraw, 120-card cap, drop target |
| `native_kanban/card.rs` | Card anatomy and the seven view toggles |
| `native_kanban/filters.rs` | Filter/sort grammar, Done default sort |
| `native_kanban/mutations.rs` | Optimistic move + token + rollback; create/delete/save flows |
| `native_kanban/conversation.rs`, `text.rs` | Start work, the agent prompt, session link |
| `native_kanban/beads.rs` | The `bd` action table and the JSON envelope |
| `native_kanban/columns.rs` | Columns dialog rules (delete refused while non-empty) |
| `packages/gx-protocol/src/beads_view.rs` | Slim row shape, tri-state readiness, workspace states, sync result codes |

## Appendix B — API cheat sheet used above

```ts
// app half
export default definePluginApp((app) => {
  app.rightPanel({ id: 'board', title: 'Kanban', component: Board, minWidth: 420 });
  // optional: app.panel({ … }) for the wide takeover
});

// server half
export default function plugin(api: KabmoPluginApi) {
  api.rpc.register('openBoard', { handler: async () => readBoard() });
  api.rpc.register('resolveAgent', { handler: async ({ id, stage }) => resolveAgent(id, stage) });
  api.realtime.seed({ revision: 0, at: '' });
  api.mcp.register({
    id: 'board',
    transport: 'stdio',
    command: Bun.which('bun') ?? 'bun',
    args: [new URL('./server.js', import.meta.url).pathname, '--mcp'],
    env: { KANBAN_DIR: join(dataDir(), 'kanban') },
  });
  api.onDispose(() => watcher?.close());
}

// host endpoints the panel calls (same-origin, cookie auth)
POST /api/agent/new          { type:'prompt', cwd, harness, provider, modelId,
                               thinkingLevel, accessMode, message, images } -> { sessionId }
POST /api/agent/:sessionId   { type:'prompt', message, images }        // follow-up
GET  /api/harness            harnesses + probed selectors
GET  /api/models             omp model registry
```

## Appendix C — ASCII renders

Widths approximate the measured px: the right panel opens at 560 px (≈ 69 cols at
~8 px/char), the phone drawer is ~390 px, and a stage block is 22 cols ≈ 200 px.

### C.1 Desktop right panel — two stages visible, the rest scroll sideways

```
┌─ Kanban ────────────────────────────────────────────── 12 cards  ⟳ ─┐
│ [All 12] [kabmo 9] [unfiled 3]   Filter ▾     + New card            │
├─────────────────────────────────────────────────────────────────────┤
│  BACKLOG  2         + │ TODO  3            + │ IN PROGR  2        + │
│ ──────────────────────│──────────────────────│──────────────────────│
│ ┌────────────────────┐│┌────────────────────┐│┌────────────────────┐│
│ │ k-1a2b          P3 │││ k-9c1d          P1 │││ k-3f8a2c        P1 ││
│ │ Spike: board       │││ Composer portal    │││ Board store        ││
│ └────────────────────┘││ kabmo              │││ kabmo              ││
│ ┌────────────────────┐│└────────────────────┘││ ● running          ││
│ │ k-5e01          P4 ││┌────────────────────┐│└────────────────────┘│
│ │ Telemetry ideas    │││ k-2b7f          P2 ││┌────────────────────┐│
│ └────────────────────┘││ Wiki page          │││ k-8f22          P2 ││
│                       ││ kabmo              │││ Watcher            ││
│                       │└────────────────────┘││ webapp             ││
│                       │                      │└────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

A stage is never squeezed: at the 560 px default the board scrolls horizontally, which is
the reference's own choice (`LANE_MIN_WIDTH = 230`).

### C.2 Wide takeover — the same component registered as `panel`

```
┌─ Kanban ──────────────────────────────────────────────────────────────────────────────────────────── 12 cards  ⟳ ─┐
│ [All 12] [kabmo 9] [webapp 2] [unfiled 1]   Filter ▾   Stages…        + New card                                  │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  BACKLOG  1         + │ TODO  2            + │ IN PROGRESS  2     + │ REVIEW  1          + │ DONE  1            + │
│ ──────────────────────│──────────────────────│──────────────────────│──────────────────────│──────────────────────│
│ ┌────────────────────┐│┌────────────────────┐│┌────────────────────┐│┌────────────────────┐│┌────────────────────┐│
│ │ k-1a2b          P3 │││ k-9c1d          P1 │││ k-3f8a2c        P1 │││ k-6a10          P2 │││ k-77ab          P3 ││
│ │ Spike: board       │││ Composer portal    │││ Board store        │││ Review sheet       │││ Rename view        ││
│ └────────────────────┘││ kabmo              │││ kabmo              │││ webapp             ││└────────────────────┘│
│                       │└────────────────────┘││ ● running          │││ needs you          ││                      │
│                       │┌────────────────────┐│└────────────────────┘│└────────────────────┘│                      │
│                       ││ k-2b7f          P2 ││┌────────────────────┐│                      │                      │
│                       ││ Wiki page          │││ k-8f22          P2 ││                      │                      │
│                       ││ kabmo              │││ Watcher            ││                      │                      │
│                       │└────────────────────┘││ webapp             ││                      │                      │
│                       │                      │└────────────────────┘│                      │                      │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### C.3 Card anatomy — control only

```
┌────────────────────────┐
│ k-3f8a2c            P1 │  1  id            4  priority (P0-P4)
│ Board store            │  2  title         5  workspace badge (in All)
│ kabmo                  │  3  session pill  6  prompt preview (1 line)
│ ● running              │
└────────────────────────┘

No description, no comments, no labels: decision 2 keeps the card a
control record. The prompt below is the task, and it is the only prose.
```

### C.4 Card sheet — title, stage, and the task composer

```
┌─ k-3f8a2c ───────────────────────────────── P1  in_progress ─┐
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Title     [ Board store                       ]            │
│   Stage     [ In Progress  v ]  Workspace [ kabmo v ]        │
│   Priority  [ P1 High      v ]                               │
│                                                              │
│   Prompt                  (the task, like a queue message)   │
│   ┌──────────────────────────────────────────────────┐       │
│   │ The board reads and writes one file per card.    │       │
│   │ Move it to review when the store tests pass.     │       │
│   └──────────────────────────────────────────────────┘       │
│   [ + image ]   no images                                    │
│                                                              │
│   Agent     [ omp-rpc     v ]  [ inherit model v ]           │
│             [ high        v ]  [ write         v ]           │
│             from: card -> stage in_progress                  │
│                                                              │
│   Session   01a0cc50…  ● running   [ Open chat ]             │
│             [ Send to session ]   [ Unlink ]                 │
│                                                              │
│   [ Start work ]  [ Link this chat ]       [ Delete ]        │
│                                                              │
│   Saved 23 Nov 09:30  ~/.kabmo/kanban/cards/k-3f8a2c.json    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### C.5 Stage sheet — overrides and the stage prompt

```
┌─ Stage: Review ────────────────────────────────── overrides ─┐
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Label     [ Review                             ]           │
│   Hidden    [x]        Runs a session [x]                    │
│                                                              │
│   Harness   [ claude              v ]  (override)            │
│   Model     [ anthropic/opus-5.5  v ]  (override)            │
│   Thinking  [ high                v ]  (override)            │
│   Access    [ always-ask          v ]  (override)            │
│                                                              │
│   System prompt     (appended on omp-rpc, prepended on ACP)  │
│   ┌──────────────────────────────────────────────────┐       │
│   │ Review the change against the card. Use the      │       │
│   │ pr-review skill. Do not edit code.               │       │
│   └──────────────────────────────────────────────────┘       │
│                                                              │
│   Skills    [ review-* ]   a glob narrows the catalog        │
│                                                              │
│   A field left on "inherit" falls back to board defaults,    │
│   then to the host: omp-rpc, project model, write access.    │
│                                                              │
│         [ Reset to defaults ]        [ Save ]                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### C.6 Phone — one stage at a time, sticky stage bar

```
┌─ Kanban ──────────────────────────────────────────────── 12 ─┐
├──────────────────────────────────────────────────────────────┤
│ [All 12] [kabmo 9]                                           │
│  Back Todo [Prog] Review Done                                │
│ ──────────────────────────────────────────────────────────   │
│                                                              │
│   IN PROGRESS  2                +                            │
│                                                              │
│   ┌────────────────────────────┐                             │
│   │ k-3f8a2c              P1   │                             │
│   │ Board store                │                             │
│   │ kabmo                      │                             │
│   │ ● running                  │                             │
│   └────────────────────────────┘                             │
│                                                              │
│   ┌────────────────────────────┐                             │
│   │ k-8f22                P2   │                             │
│   │ Watcher                    │                             │
│   │ webapp                     │                             │
│   └────────────────────────────┘                             │
│                                                              │
│   long-press a card -> Move to stage / Start work /          │
│                        Link this chat / Delete               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### C.7 The states

```
┌─ Kanban ───────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   No board yet.                                                    │
│                                                                    │
│   It will be created at:                                           │
│   /Users/rajeb/.kabmo/kanban/                                      │
│                                                                    │
│   board.json, cards/<id>.json                                      │
│                                                                    │
│             [ Create board ]                                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─ Kanban ───────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   Board is empty.                                                  │
│                                                                    │
│   A card is a control record: a prompt, an agent, a stage.         │
│   Press New card, or ask an agent to call kanban_create.           │
│                                                                    │
│             [ New card ]                                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─ Kanban ───────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   Nothing in this workspace.                                       │
│                                                                    │
│   9 cards are filed under kabmo, 3 are unfiled.                    │
│                                                                    │
│             [ Show all ]                                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─ Kanban ───────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   Could not read the board.                                        │
│                                                                    │
│   ~/.kabmo/kanban/board.json                                       │
│   Unexpected token } in JSON at position 214                       │
│                                                                    │
│   Nothing was written. Fix the file, or delete it to start over.   │
│                                                                    │
│             [ Retry ]   [ Show folder ]                            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─ Kanban ───────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   12 cards read.                                                   │
│                                                                    │
│   ! cards/k-4d3a.json  Unexpected end of JSON input                │
│   ! cards/k-0c9d.json  stage "doing" matches no stage              │
│                                                                    │
│   Both are listed under Unplaced, never dropped.                   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### C.8 One MCP move, end to end

```
agent chat (omp-rpc or ACP)
  │
  │  tools/call  kanban_move { "id": "k-3f8a2c", "status": "review" }
  ▼
kanban MCP child        bun <plugin>/dist/server.js --mcp
  env KANBAN_DIR=~/.kabmo/kanban
  │  validate id -> read card -> check stage exists
  │  write cards/k-3f8a2c.json.tmp -> rename
  ▼
~/.kabmo/kanban/cards/k-3f8a2c.json      (the one store)
  │  fs.watch, 150 ms debounce
  ▼
plugin server half      publishes topic { revision: 42 }
  ▼
open Kanban panel       re-reads -> the card is in Review

tool result
  { "ok": true, "card": { "id": "k-3f8a2c", "status": "review" },
    "stage": { "id": "review", "runsSession": true },
    "next": "start_work_required" }

The agent cannot spawn a Kabmo session; the card shows Start work,
and the panel is the only party that spends a session on it.
```

This is the path decision 3 buys: the agent that did the work moves its own card, the
panel follows through the watcher, and the only party that spends a session is the panel.

## Appendix D — what was actually run

| Claim | How it was checked |
|---|---|
| omp accepts a system prompt and a skill filter in RPC mode | `omp --mode rpc-ui --cwd /tmp/kcheck --append-system-prompt KANBAN_TEST --skills='review-*'` (omp 19.1.0) emitted `{"type":"ready",…}` and stayed up. **Accepted, not honoured** — P0 must send one turn and read the reply |
| omp exposes the flags at all | `omp --help` lists `--system-prompt`, `--system-prompt-template`, `--append-system-prompt`, `--no-skills`, `--skills=<glob>` |
| Plugin MCP is ACP-only | `src/server/lib/mcp/session-overlay.server.ts` writes `sources: ['user', 'project']`; its comment: "App-local rows and plugin contributions are ACP-only today". `ensureSessionMcpOverlay` returns `undefined` when the overrides map is empty |
| ACP carries plugin MCP | `src/server/lib/harness/spawn.server.ts` calls `mcpServersFor(request.cwd, { overrides })` with no source filter, then `toAcpMcpServers` |
| A plugin MCP server can carry `env` | `src/server/lib/mcp/registry.server.ts` `nativeFromPlugin` copies `server.env`; `toAcpMcpServers` turns it into the ACP name/value list |
| The overlay has a `keep` option already | `ensureSessionMcpOverlay(…, { keep?: boolean })`, used today only by `session-mcp.test.ts` |
| `/api/agent/new` is a full spawn + first prompt | `src/server/routes/agent/new.ts`: accepts `type`, `cwd`, `harness`, `provider`, `modelId`, `thinkingLevel`, `accessMode`, `modes`, `message`, `images`; answers `{ success, sessionId, data, harness? }` |
| `/api/agent/:sessionId` sends a follow-up | `src/server/routes/agent/command.ts` dispatches `{ type: 'prompt', message, images }` |
| Harness and model catalogs are plain routes | `GET /api/harness` (`use-harnesses.ts`) and `GET /api/models` (`src/server/routes/models/index.ts`) |
| Queue-shaped task fields exist to reuse | `QueuedMessageModel { provider, modelId, thinkingLevel, accessMode }`, `Attachment { name, type, size, dataBase64, content }` (`src/shared/types/chat.ts`) |
| `purgePluginState` has no caller | `rg purgePluginState src` → the definition in `schema.server.ts` only |
| Plugin MCP now reaches omp-rpc | `session-mcp.test.ts` — a registered plugin server appears in the overlay's `mcp.json` even with an EMPTY override map; the pre-fix source list proves the gap |
| A stage prompt reaches the spawn | `constants.test.ts` — `--append-system-prompt` and `--skills=a,b` sit before the extension args; `new-prompt.test.ts` — the route's validation and the ACP prepend |
| A relocated data dir reaches a plugin | `plugins/e2e.test.ts` — `record.api.paths.dataDir` follows `KABMO_DATA_DIR` after a dispose/reload |
| The plugin builds | `kabmo plugin build` → `dist/app.js` + `dist/server.js`; `bun run build` unaffected |
| The MCP child serves stdio | `bun dist/server.js --mcp` with `KANBAN_DATA_DIR` → `initialize`, `tools/list`, `kanban_create` wrote `cards/k-*.json`, a bad id answered a readable refusal |
| The panel's rules hold | `panel.test.ts` — lenses, hidden stages, the card face, origin labels, and the Start-work request per transport |
| The assembled panel works | isolated server (`KABMO_DATA_DIR`/`KABMO_MARKETPLACE_DIR` overrides), install from the bundled store, then in a real browser: the activity bar shows **Kanban — Kanban**; the board renders its stages; New card created `k-4d06b3`; the sheet showed `Harness · host default`, `Model · 338 available`, `none · appended to omp's system prompt`; saving wrote the prompt and workspace to `cards/k-4d06b3.json`; the card moved to In Progress and **Start work** became enabled. |
| Not proven | A live Start-work spawn (an actual agent turn) and an agent-initiated MCP move inside a real chat. The mechanics under them are pinned (route body per transport, stdio serve + file write, watcher publish), but the end-to-end agent loop has not been run. |
