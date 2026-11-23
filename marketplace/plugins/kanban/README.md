# Kanban

A board that **drives work** rather than describing it.

A card is a task: a prompt, an agent, and a stage. Press **Start work** and the
card's prompt becomes a real chat in its own workspace; the card then shows that
chat's live state. The agent can move its own card — `in_progress → review` —
through the plugin's MCP tools, and the board follows without a reload.

That is the whole idea. There is no description field, no comments, no labels and
no epics: a board that accumulates knowledge stops being read, and the prompt
already carries everything the agent needs.

## One board, two lenses

The board lives in Kabmo's own data directory (`~/.kabmo/kanban`, or
`KABMO_DATA_DIR`), not in a repository. A per-repo board dies with its checkout,
and "what am I working on" then needs a tool to answer.

- **`All`** — every card.
- **`This workspace`** — the default while a workspace is open.
- **`Unfiled`** — cards with no workspace.

A card carries the workspace it belongs to, so the lenses FILTER and never move
anything. A card whose folder was deleted stays on the board and says so; only
starting work needs a real workspace.

## Stages own the agent

Each stage can override the harness, model, thinking level, approval mode and
**system prompt**, and each field falls back independently:

```
card  →  stage  →  board defaults  →  host default
```

Per field, so a card that only wants more thinking does not have to restate the
stage's harness. The sheet names the level every value came from, because a
fallback chain nobody can see is a chain nobody can override.

The stage prompt reaches the agent differently per transport, and the sheet says
which:

| Harness | Delivery |
|---|---|
| `omp-rpc` | `--append-system-prompt` at spawn — appended to omp's own coding prompt, so the tool contract survives |
| any ACP harness | prepended to the first turn in a `<stage_instructions>` block, because ACP's `session/new` has no system-prompt field |
| an already-linked session | always prepended: spawn flags are fixed once the child exists |

A prewarmed omp child is deliberately NOT adopted when a system prompt is asked
for — omp reads that flag only at spawn, so adopting one would silently drop the
instructions.

## Start work is one call

`POST /api/agent/new` — the route the chat composer itself uses — resolves the
model when the card names none (project default, then the persisted pick),
applies the thinking level, spawns omp or an ACP agent, and runs the first
prompt. It answers the real `sessionId`, so the card is linked on the same
response; there is no pending-session heuristic and no second spawn path.

A card with no workspace is refused by name rather than started in the server's
own directory.

## MCP: the agent moves its own card

The plugin registers a stdio MCP server named `<plugin id>:board`. It is the same
built bundle: `dist/server.js --mcp` serves it, and `KANBAN_DATA_DIR` tells it
which board to read (a plugin MCP registration has no `cwd`, so guessing from the
agent's directory would read the wrong board).

| Tool | What it does |
|---|---|
| `kanban_list` | Slim rows, filtered by workspace and stage |
| `kanban_next` | The highest-priority card that is not done, plus its stage prompt |
| `kanban_get` | One card with its stage and the resolved agent |
| `kanban_create` | New card (workspace defaults to nothing — say where it belongs) |
| `kanban_move` | The move the board exists for |
| `kanban_claim` | Record a session and land in the working stage |
| `kanban_update` | Title, priority, workspace, prompt |
| `kanban_link_session` | Link or unlink a chat |
| `kanban_delete` | Remove a card file |
| `kanban_stages` | Read or replace the stage list and the board defaults |

A move into a stage that **runs a session** does not start one. It answers
`next: "start_work_required"` and the card shows **Start work**, because a chat
appearing from nowhere is worse than one click.

A refusal is a RESULT the agent can read (`{ ok: false, code, message }`), not a
JSON-RPC error: `stage "nope" does not exist` is actionable, `the server broke` is
not.

## Files, and why not a database

```
<dataDir>/kanban/
├── README.md          format notes for an agent
├── board.json         schema, defaults, stages
└── cards/<id>.json    one card per file
```

Two writers exist — Kabmo's process and the MCP child — so every
read-modify-write takes `cards/.write.lock` (a stale lock is taken over after
5 s) and every write goes through a temp file and a rename. A card file is the
unit of change, which is also what lets an agent with nothing but its file tools
read and edit the board.

**Removing the plugin never deletes the board.** That is why the board is not in
`storage.records`: those rows are purged on removal, and a personal queue
destroyed by an uninstall-and-reinstall is not an acceptable failure.

## The panel

- Board: horizontal stages, 200 px floor, horizontal scroll, 120 cards per stage.
- Card: id, priority, title, workspace (in `All`), prompt preview, live session
  pill (`running` / `needs you` / `idle`).
- Card sheet: title, stage, priority, workspace, the prompt (with images), the
  agent picks with their origins, and Start work / Link this chat / Open chat /
  Unlink / Delete.
- Stages sheet: per stage — label, hidden, runs-a-session, harness, thinking,
  access, system prompt; plus the board defaults.
- A hidden stage that still holds cards keeps showing. A card whose stage no
  longer exists appears under **Unplaced** with its file named.
- Drag moves a card between stages; the stage select does the same thing, so drag
  is an enhancement rather than the only way.

## Tests

```
bun test marketplace/plugins/kanban/
```

72 assertions across four suites, each owning a rule that fails silently:

- `store/board.test.ts` — ids, unknown fields preserved, staleness, the prompt and
  image ceilings, a broken card reported with its path, an unreadable board never
  read as empty, a hidden stage keeping its cards, the fallback chain per field.
- `mcp.test.ts` — every tool, `start_work_required`, a readable refusal, a bad id
  that never reaches the filesystem.
- `server.test.ts` — an agent's write is published (the watcher), a burst
  collapses to one frame, dispose stops it.
- `panel/panel.test.ts` — lenses, which stages draw, the card face, the origin
  labels, and exactly what a Start-work request carries per transport.
