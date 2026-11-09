# M20 — Cross-harness orchestration: Claude as orchestrator, omp as worker

Status: **partial** — the `@harness` mention grammar, picker rows, worker preamble and default-model precedence shipped; composer-side direct spawn, the MCP server and the Run UI remain (2026-11-09).

M19 mapped one reference implementation (`get-bb/bb`) onto Kabmo: thread/session relations, forks,
child outcomes and an agent-callable CLI. This milestone answers the question M19 left open:

> How do two **different** harnesses participate in one piece of work when the only portable agent
> protocol Kabmo speaks is ACP — for example Claude as the orchestrator and omp as a worker?

The short answer, established by every implementation studied below: **ACP is a client-to-agent
transport, not an agent-to-agent bus.** Cross-harness orchestration is a *host* feature. The host
spawns both agents, gives the orchestrator a callable control surface, and routes worker outcomes
into the orchestrator's own transport. Claude never talks to omp; both talk to Kabmo.

Paths in this document are Kabmo's unless a reference repository is named. Reference paths are
relative to that checkout at the cited revision.

---

## 1. The five references, and what they agree on

| Reference | What it is | Orchestration control surface |
|---|---|---|
| [`get-bb/bb`](https://github.com/get-bb/bb) | agent IDE; threads are the unit of work | `bb` CLI inside every thread + parent notification queue |
| `bb` **workflows** plugin | deterministic JavaScript orchestration (QuickJS) | one agent tool `bb_workflow_run`; workers are hidden threads |
| [`dbrekelmans/bb-orchestra`](https://github.com/dbrekelmans/bb-orchestra) | live-agent fleet on bb | agent tools `orchestra_delegate/tell/status/…`; workers are child threads |
| [`stablyai/orca`](https://github.com/stablyai/orca) | desktop agent IDE ("AI orchestrator") | `orca orchestration` CLI; workers are terminals or native chats |
| [`orca-cli/orca`](https://github.com/orca-cli/orca) | Go orchestration layer for coding agents | MCP server (`orca mcp serve`); workers are run processes in worktrees |
| [`araa47/orca`](https://github.com/araa47/orca) | tmux + worktree worker spawner | `orca spawn/steer/logs/kill` CLI; daemon watches panes |

They agree on seven things, and none of them depends on ACP:

1. **The orchestrator is an ordinary agent session**, not a service, a thread type or a process
   role. bb has no orchestrator module (M19 §5.1); Orca's coordinator is a chat or terminal agent;
   orca-cli is driven by whatever agent the user already uses.
2. **A worker is a first-class addressable unit** with its own workspace and lifecycle: a bb thread,
   an Orca dispatch/terminal, an orca-cli run, a tmux pane.
3. **The control plane is agent-callable**: a CLI on `PATH` (bb, Orca, araa47) or an MCP server
   (orca-cli). Never a protocol between two agents.
4. **Completion is pushed, not polled.** bb coalesces child outcomes into the parent's queue; Orca
   delivers `worker_done`/`question`/`heartbeat` messages; araa47's daemon notifies the
   orchestrator; orca-cli gates review.
5. **The orchestrator ends its turn and is woken.** A blocking `await` is unworkable when the
   completion path steers the waiting agent: the wake preempts the tool call doing the waiting.
   `bb-orchestra` says this explicitly in its README.
6. **State is durable outside the agent process.** bb: SQLite threads/queue; Orca: SQLite run state;
   orca-cli: SQLite `~/.orca/orca.db`; araa47: daemon events. Context loss is expected, so the
   orchestrator re-reads state instead of remembering it.
7. **The host owns the invariants**: nesting depth, workspace isolation, visibility, cleanup,
   notification coalescing. None of the references asks the model to enforce them.

---

## 2. `stablyai/orca` — explicit worker protocol, no ACP

Orca's orchestration layer (docs: [`onorca.dev/docs/cli/orchestration`](https://www.onorca.dev/docs/cli/orchestration))
is the most complete example of a *message-passing* worker contract.

### Model

| Entity | Role |
|---|---|
| **Run** | durable namespace plus coordinator inbox; never schedules or places workers |
| **Task** | spec + dependencies + status: `pending`, `ready`, `dispatched`, `completed`, `failed`, `blocked` |
| **Dispatch** | one attempt of a task on a terminal; lifecycle authority for `worker_done` / heartbeat |
| **Message** | inbox mail: `status`, `dispatch`, `worker_done`, `escalation`, `question`, `heartbeat` |
| **Gate** | coordinator-owned decision that blocks a task until resolved |

### Worker contract

A worker receives a **preamble** that names its Task and Dispatch IDs and tells it to:

- send `worker_done` exactly once, even on failure, with `--outcome succeeded|failed`;
- include a short body (done / found / remains) and both IDs, so a stale retry cannot complete the
  wrong dispatch;
- send `heartbeat` during long work when the brief asks;
- use `orca orchestration ask` for blocking questions rather than a local TUI prompt.

The coordinator starts workers with `orca orchestration worker-start --task <id> --worktree
current|new-child --agent codex|claude|… [--model] [--effort]`, then **ends its turn**. Orca wakes
it with a delivery; `check --wait --types worker_done,escalation,question` is the supervised loop.
Workers may start helpers up to **Nested worker depth** (default 4), and stopping a worker stops its
helpers. Group addressing exists (`@all`, `@idle`, `@claude`, `@codex`, `@worktree:<id>`), never for
`worker_done`.

### Relevant to Kabmo

- Cross-provider is a **launch option**, not a protocol feature: `--agent` and `--model` choose who
  runs; the orchestration state machine is provider-blind.
- When Chat UI is on, `worker-start` launches a structured chat for every agent that has one
  (including omp — PR #26776), otherwise a terminal. The worker's *transport* varies; the
  *contract* does not.
- Completion authority belongs to the dispatch context, not to text matching or process exit.

---

## 3. `orca-cli/orca` — MCP as the only interface

Single Go binary, no Node/Python/Docker. `~/.orca/orca.db` (SQLite + FTS5) holds run state;
`.orca/runs/<id>/` holds git worktrees; `orca mcp serve` exposes the layer over MCP stdio.

```
You (CLI, TUI, or MCP client)
    ↓
Orca (single Go binary)
    ├──→ Run state  →  ~/.orca/orca.db
    ├──→ Isolation  →  .orca/runs/<id>/ (git worktrees)
    └──→ Adapters   →  Claude Code · Codex · Aider · OpenCode · Cursor
```

Run lifecycle: `queued → running → ready → shipped`, with `blocked` and `failed → retry`.
A **pod** decomposes a goal into a DAG of runs; dependencies gate dispatch; `.orca/policies/`
constraints gate what reaches review; `orca ship` opens the PR.

### Relevant to Kabmo

- This is the strongest evidence that **MCP is enough to make any agent an orchestrator**: the agent
  calls tools; the host owns processes, worktrees and state.
- It also shows the limit: orca-cli is strong for a known-shape DAG (fan-out, review queue) and weak
  for live conversation with a worker (it has logs, retry and review, not `tell`).
- A single binary owning its own SQLite is the opposite of Kabmo's architecture (server + session
  registry + realtime topics). Copy the interface, not the ownership model.

---

## 4. `araa47/orca` — the cheapest possible control plane

`orca spawn` creates a git worktree and a tmux window, then launches a CLI agent; a background
daemon watches panes through installed lifecycle hooks. It auto-answers safe prompts (workspace
trust, permission prompts, y/n, rate limits) and escalates auth failures, missing credentials,
ambiguous questions and repeated errors to the orchestrator. Notification is `tmux send-keys` into
the orchestrator pane, or `openclaw system event` for an OpenClaw L0. Limits: `ORCA_MAX_DEPTH=3`,
`ORCA_MAX_WORKERS=10`.

### Relevant to Kabmo

- It demonstrates that **pane text is a control channel** — cheap, universal, fragile. Kabmo already
  has a PTY layer, but a PTY scrape is not a contract: no IDs, no outcomes, no authorization.
- Its "stuck worker" policy is the useful idea: classify the blocked state and either answer
  mechanically or escalate with context. Kabmo's ACP `session/request_permission` and RPC dialogs
  give this classification for free, which is strictly better than scraping.

---

## 5. bb's two orchestration plugins — the closest precedent

Part I already covers bb's thread primitives (`parentThreadId`, `lifecycleOwnerThreadId`, fork,
`bb thread tell --mode steer|queue|auto`, coalesced child notifications, `MAX_THREAD_HIERARCHY_DEPTH
= 4`). Two plugins show the two shapes an orchestration feature takes on top of those primitives.

### 5.1 `builtin:workflows` — deterministic fan-out

- Provider-independent JavaScript runs inside QuickJS with **no Node, filesystem, shell, network,
  imports, clock or randomness**; reasoning is delegated to ordinary bb threads.
- Each agent call may name `provider`, `model` and `reasoningLevel`; workers are hidden **root**
  threads (no core parent edge), so the plugin owns notification and cleanup.
- Metadata declares ordered phases; workers may return Ajv-validated structured output through
  `bb_workflow_result`; every call has retries with bounded backoff.
- Durability: calls are persisted and replayed by SHA-256 identity until the first divergence;
  settings snapshot into the run; one child-workflow level allowed.
- One authoring tool (`bb_workflow_run`); validation, status, history and stop are CLI commands.

### 5.2 `bb-orchestra` — live agent fleet

- Agent tools: `orchestra_delegate`, `orchestra_status`, `orchestra_tell`, `orchestra_pause`,
  `orchestra_resume`, `orchestra_cancel`, `orchestra_providers`.
- Workers are **real bb child threads** with their own provider/model/effort, so a Fable-high
  orchestrator can spawn a Codex-`xhigh` implementer and a Haiku-`low` fact-checker in one turn.
- There is deliberately **no await tool**: a child's final message is delivered to its parent as a
  message that steers the parent's turn, which would kill the tool call doing the waiting.
- `worktree` isolation is the default; `shared` is available for seeing uncommitted changes.
- A reconciler re-derives display state every 60 s because lifecycle events only arrive while the
  plugin is loaded; report delivery itself is bb's and survives plugin reload.

**The lesson for Kabmo:** orchestration is not a new agent protocol. It is a small control surface
plus the existing session model, durable delivery, and host-enforced limits. `workflows` and
`orchestra` differ only in *who decides the shape* (script vs live agent).

---

## 6. Comparison

| | bb threads + plugins | stablyai/orca | orca-cli/orca | araa47/orca | Kabmo today |
|---|---|---|---|---|---|
| Control surface | `bb` CLI + agent tools | `orca orchestration` CLI | MCP server | CLI + tmux send-keys | `kabmo` CLI has no session verbs |
| Worker unit | thread | dispatch / terminal / chat | run | pane + worktree | session (RPC or ACP) |
| Cross-harness | provider per thread | agent per worker | adapter per run | agent binary per pane | catalog of 14 harnesses |
| Isolation | env/worktree | worktree | worktree | worktree | worktree sessions (M11) |
| Completion | coalesced parent notice | inbox delivery | review queue | daemon notify | none yet |
| Mid-flight steering | `tell --mode` | `send` | retry with feedback | `steer` | `queued_messages` + ACP steering |
| Durable state | SQLite | SQLite | SQLite | daemon events | SQLite |
| Needs ACP | no | no | no | no | ACP is one of two transports |

Every production-grade column is host-side. ACP appears nowhere in the orchestration design of any
reference — only in how some of them *display or drive an individual agent*.

---

## 7. ACP is a session transport, not an orchestration bus

### 7.1 What ACP defines

From [`agentclientprotocol.com/protocol/v2`](https://agentclientprotocol.com/protocol/v2/overview):

- JSON-RPC 2.0, no batches; both sides send requests; ids are never reused while pending.
- Client → Agent: `initialize`, `session/new` / `session/resume`, `session/prompt`,
  `session/set_config_option`, `session/close`, `session/cancel`.
- Agent → Client: `session/update` notifications (messages, thoughts, tool calls, plans, config,
  notices), `session/request_permission`.
- `session/new` takes `cwd` **and `mcpServers`**; the agent connects to those servers before
  answering. `session/resume` takes the same list and replaces the previous one.
- One session is one conversation stream. A `session/prompt` response means *accepted*, not
  finished; the turn streams as updates.

Kabmo's client speaks ACP v1 (`session/new`, `session/load`, `session/prompt`, `session/cancel`);
v2 renamed load to `session/resume` and split the prompt result from the idle state update. The
orchestration argument here is identical in both versions: one client connection, one agent.

### 7.2 What the subagent RFD adds, and what it does not

[`rfds/subagents`](https://agentclientprotocol.com/rfds/subagents) lets an **agent** expose the
subagents *it* creates:

- v1: optional client capability `subagents: {}`; the agent sends `subagent_update` on the parent
  session's stream to announce a child session ID, title, description, capabilities and cwd.
- The child's events flow on the same connection; the parent stream carries the roster metadata.
- The client **cannot prompt a child**: a child is observable, cancellable only when advertised, and
  never a place to submit work. In v2 the updates are baseline and support is assumed.

So the RFD standardizes **one agent's internal delegation**, not delegation *between harnesses*. A
Kabmo client that announced `subagents` could render Claude's own Task subagents as children of the
Claude session; it could not use that mechanism to create an omp worker, and it must not pretend to.

### 7.3 Kabmo's current ACP surface (measured in this tree)

| Fact | Evidence |
|---|---|
| One `AcpProcess` per chat; session id is the agent's | `src/server/lib/harness/acp/client.ts`, `session.ts` |
| `session/new` and `session/load` send `mcpServers: []` | `src/server/lib/harness/acp/verbs.ts:27-33` |
| `initialize` advertises no fs/terminal capability by default | `client.ts:135-147` |
| ACP child env is `{ ...Bun.env, ...options.env }` | `client.ts`, same pattern in `src/server/lib/omp/rpc/process.ts:58` |
| Steering is an omp extension (`_session/steering`); Claude's adapter reports `promptQueueing` | `verbs.ts:74-83`, M16 §"`_meta.claudeCode.promptQueueing: true`" |
| Claude runs over `@agentclientprotocol/claude-agent-acp@0.100.0` | `src/server/lib/harness/launch-table.ts:94-99` |
| Every ACP chat is one child process with a 10-minute idle reaper | M17, `acp/session-idle.ts` |

Three consequences:

1. **Kabmo cannot make two agents talk over ACP.** Only the client can call `session/prompt` on an
   agent, and it holds one connection per chat. There is no cross-agent `session/prompt`.
2. **`mcpServers` is the standardized injection point.** A host tool server can be handed to Claude
   at `session/new` without touching Claude's config or prompt. That is host-tool access *over* ACP,
   not agent-to-agent ACP.
3. **A custom `_method` per agent is not portable.** ACP reserves `_` methods for
   implementation-specific extensions; building orchestration on one would work for exactly one
   adapter and break the "a new agent works without touching the core" rule M17 established.

---

## 8. The design: a Run over ordinary sessions

### 8.1 Decisions

- **D10 — A Run is a namespace, not a process.** `orchestration_runs` groups an orchestrator session
  and its workers; nothing new runs. This mirrors Orca's Run and bb's "a manager is a skill you can
  talk to" (M19 D6). A Run owns the goal text, the coordinating session id, and the limits.
- **D11 — The orchestrator is an ordinary session of any harness.** Claude over ACP, omp over RPC,
  Codex over ACP: the same control contract. No orchestrator harness gets a special spawn path.
- **D12 — Workers are ordinary sessions of any harness**, linked by M19's `session_relations`
  (`parent_session_id`, `lifecycle_owner_session_id`). A worker is not a native subagent and not a
  hidden process Kabmo cannot address.
- **D13 — Control surface: CLI first, MCP second.** `kabmo session …` works for both transports with
  no agent cooperation. An MCP server is the second surface for agents whose tool loop prefers tool
  calls to shell (Claude), injected through ACP `session/new.mcpServers`; for omp RPC it goes
  through omp's MCP configuration (Kabmo already has an MCP settings surface).
- **D14 — Completion is a queued notice, never a blocking wait.** A `kabmo session wait` exists for
  scripted use, but the documented contract is "delegate, end your turn, act on the notice" —
  bb-orchestra's measured reason applies unchanged.
- **D15 — Worktree per worker on request.** `--worktree new-child|current`, default `new-child` for
  writers and `current` for read-only reviewers. This amends M19 D9: spawning does not implicitly
  create a worktree, but an explicit flag may.
- **D16 — Do not implement ACP `subagents` in v1.** If an adapter emits `subagent_update`, render it
  in the native-subagent surface (a tool-level artifact), not as a Kabmo child session. Two identity
  systems already exist (M19 risk); a third would make the sidebar lie.
- **D17 — Refuse, never substitute.** A dead worker, a harness without the capability, or a refused
  permission answers a typed code. No silent fresh session, no fabricated "completed".

### 8.2 The Claude → omp flow, concretely

```
Claude (ACP chat, session C)
  │  shell tool: kabmo session spawn --parent-self --harness omp-rpc \
  │              --worktree new-child --prompt-file -
  ▼
POST /api/sessions/spawn                       (agent token, not UI auth)
  ├─ relations.assertParent(C, folder, depth < 4)
  ├─ resolve harness/cwd/model; startRpcSession('omp', cwd=worktree)
  ├─ write harness_sessions + relation + agent token
  └─ dispatch first prompt; stream on session:<worker>
        │
        ▼
omp worker (RPC child, session W) — writes, runs tests, ends its turn
        │  turn settles (run-settle.server.ts)
        ▼
notify.server: coalesce per (C, 'child-outcomes'), window 2 s
        ▼
queued_messages row on C
        ▼
dispatcher (queue/delivery.server.ts + a harness-aware cold path)
  ├─ C live + idle   → session/prompt on C
  ├─ C live + busy   → queue (Claude's adapter queues; no steer)
  └─ C not live      → session/load C, then prompt
        ▼
Claude receives one notice:
  [kabmo] Child session @session:W completed: <final output, ≤ 4 000 chars>
        │
        ▼
Claude: kabmo session output W --json  → decides: more work, or report
```

Why this is not ACP between Claude and omp: Kabmo is the only party that knows both sessions. Kabmo
called `session/new` for Claude and spawned the omp child; it owns the token, the relation row and
the queue. Claude's ACP connection is used exactly as specified — receive a prompt, stream updates.

### 8.3 Environment and authorization

Inject through the existing env seams (`RpcProcess` and `AcpProcess` both merge `options.env` into
the child environment):

| Variable | Purpose |
|---|---|
| `KABMO_SERVER_URL` | the instance the agent calls; never inferred from a repo path |
| `KABMO_SESSION_ID` | `--parent-self`, `show`, `output`, `tell` defaults |
| `KABMO_RUN_ID` | the Run this session belongs to |
| `KABMO_AGENT_TOKEN` | bearer token minted at spawn, stored hashed in `session_agent_tokens` |

The token is a routing and ownership guard, not an OS boundary: the same user can read the database
and the agent's environment. It prevents accidental cross-session control and keeps the route
contract identical with UI auth on or off. Say that in the route doc comment, not less.

### 8.4 Why not the alternatives

| Alternative | Why it fails |
|---|---|
| ACP subagent RFD as the worker mechanism | It is agent-internal and one-directional; the client cannot prompt a child, and omp is not the agent that created it. |
| A custom `_kabmo/spawn` ACP method | Works for one adapter; violates M17's "a new agent needs no core change"; every harness would need a patch. |
| omp's native `task` tool as the cross-harness answer | Same harness only; not addressable as a session; no cross-provider model choice. |
| PTY scraping (araa47) | No IDs, no typed outcomes, no authorization; Kabmo already has structured dialogs. |
| A central scheduler service | Every reference proves the agent is the scheduler; a service would have to re-implement context, steering and review. |

### 8.5 The prompt contract: three layers, and only one is the user's

"Orchestrator" is not a model, a prompt or a role flag in any reference. It is a normal agent
session whose **instruction layer** teaches it to delegate and whose **environment** gives it a
control surface. Three separate texts do the work:

| Layer | Who writes it | What it must say | Where it lives in the references |
|---|---|---|---|
| **Orchestrator instruction** | the product | when to delegate, the exact commands, "end your turn", how to synthesize | bb: injected guide + `bb-guide`; bb-orchestra/Orca: a skill; araa47: repo `CLAUDE.md`/`AGENTS.md`; orca-cli: `.orca/AGENTS.md` |
| **User goal** | the user | the work, not the mechanics | the first prompt |
| **Worker brief** | the orchestrator | a self-contained task: goal, paths, constraints, done criteria, report format | the worker's first prompt |

The user never writes orchestration commands. They write *"refactor billing; split API and UI; have
omp implement and Claude review"*, and the instruction layer turns that into workers.

#### What the references actually say

bb's orchestrator instruction is deliberately conservative (`plugins/bb-guide/introduction.ts`):

> The `bb` CLI is available when you need BB context or orchestration.
> Do not spawn new threads or message other threads unless the user has explicitly asked you to do
> so, except to answer a thread that messaged you.
> … answer your parent thread in your final response, which bb reports to the parent.

bb-orchestra's skill is the explicit loop (`skills/orchestrating/SKILL.md`):

> 1. Plan the split. …
> 2. Call `orchestra_providers` if you are not certain …
> 3. `orchestra_delegate` once per piece, all in the same turn. …
> 4. **End your turn.** Do not poll `orchestra_status` in a loop …
> 5. Synthesize once the pieces you need are in. You are the only agent that sees every report.

and the rule that makes a worker brief work:

> The subagent **cannot see your conversation**. Everything it needs goes in `task`: the goal, the
> relevant file paths, the constraints, the definition of done, and what to report back.

Orca's coordinator guide says the same in one line:

> Start every independent worker, then **end your turn**. "Report back" and "tell me when it's
> done" still mean end your turn; Orca wakes you and you report then.

Orca's **worker prompt is generated, not written by the coordinator**. The dispatch preamble
(`src/main/runtime/orchestration/workers/launch/worker-dispatch-preamble.ts`) is prepended to the
task spec in the same turn:

```
You are working inside Orca, a multi-agent IDE. You are a dispatched worker.
Your coordinator's Orca session ID is: <handle>
Your task ID is: <taskId>

The coordinator cannot see this terminal. Reach it with the `orca orchestration` commands
below, and message it only to ask, report a blocker, or finish; it needs no progress updates
unless the task asks.
Do only this task, yourself: no subagents or helper workers unless the task asks.

=== CLI COMMANDS ===
  # Ask the coordinator, then end your turn; Orca wakes you with the answer.
  orca orchestration ask --from <worker> --question "<your question>"
  # Finish: send exactly once. --body is three sentences: what you did, what you
  # found, what is left. Use --outcome failed if the work is not done.
  orca orchestration send --from <worker> --type worker_done … --outcome succeeded

=== TASK ===
<taskSpec>
```

Three properties are load-bearing:

1. **Identity and authority are in the prompt** (`taskId`, `dispatchId`, coordinator handle), so a
   stale retry cannot settle the wrong dispatch.
2. **The communication rules sit beside the commands**, where the agent reads them.
3. **The task spec is last**, because it is the only part that varies.

bb's equivalent is the first prompt passed to `bb thread spawn`; the child answers in its final
response and bb delivers it. bb `workflows` replaces the agent-authored brief with a script call:

```js
const results = await pipeline(
  args.items,
  (item) => agent("Review " + item, { phase: "Review" }),
  (review, item) => agent("Verify this review for " + item + ":\n" + review, { phase: "Verify" }),
);
```

araa47 asks the user to paste the instruction into the repo (`CLAUDE.md` / `AGENTS.md`):

> When facing tasks that can be broken into independent pieces, use `orca spawn` to delegate work
> to parallel workers instead of doing everything sequentially. … After spawning, stop and wait —
> the daemon notifies you when workers finish.

#### Kabmo's two texts

Kabmo has no generic system-prompt injection across harnesses (M19 §5.4). So v1 puts both texts in
the **first prompt**, visibly, for both transports.

**A. Orchestrator contract** — prepended to the first message of a session the user marks as an
orchestrator (or of every session inside a Run):

```text
[kabmo orchestration contract]
You are the orchestrator of Run <runId>. You are session <C>.

Start a worker on any installed harness:
  kabmo session spawn --parent-self --harness <id> --worktree new-child --prompt-file -

Rules:
- A worker sees nothing of this conversation. Put the goal, file paths, constraints,
  definition of done and report format in its prompt.
- Start independent workers in the same turn. Do not serialise them.
- After starting workers, END YOUR TURN. Kabmo sends each worker's outcome back
  as a new message. Do not poll.
- Read a worker's output with `kabmo session output <id>`.
- You are the only agent that sees every report. Reconcile contradictions; do not
  relay a report verbatim.
- Do not delegate work one tool call can answer, and do not delegate work that
  depends on another worker that has not reported yet.
- Nesting is capped at depth 4. Stop when the goal is met.
[/kabmo orchestration contract]
```

The block is shown in the timeline and marked as system-authored. Hiding it would make the
transcript claim the user typed something they did not.

**B. Worker dispatch preamble** — generated by the server, prepended to the worker's first prompt
by `POST /api/sessions/spawn`; the orchestrator supplies only `TASK`:

```text
[kabmo dispatched worker]
You are a dispatched worker in Kabmo. You are session <W>; your coordinator is <C>.
The coordinator cannot see this chat.

  # Read another session (yours or a sibling's):
  kabmo session output <id>
  # Ask the coordinator or report a blocker, then end your turn:
  kabmo session tell <C> --message-file - --mode auto

Do only this task. Do not start other workers unless the task says so.
When you finish, your final message is your report: what you did, what you found,
what is left. Do not send a separate acknowledgement.
[/kabmo dispatched worker]

TASK
<the orchestrator's brief>
```

Kabmo takes bb's completion rule, not Orca's extra `worker_done` command: **the turn's final
message is the report**, and turn settle is the authority. A failure notice carries the error text
and never says "completed". `session tell` is for questions and blockers only, which keeps the
worker contract to one new verb.

**C. The wake notice** — the only message the orchestrator receives from a worker:

```text
[kabmo] Worker <harness> @session:<W> completed (turn 1, 42 s):
<final text, truncated at 4 000 chars>
Inspect: kabmo session output <id>
```

A failed worker uses `failed` and the failure context; a coalesced notice lists every outcome in the
window under one header. This is the "prompt" the orchestrator sees when it wakes — not a tool
result, not a resumed conversation, but a new user-role message in its own transport.

#### Injection points per transport

| Transport | Instruction layer | Worker brief | Why |
|---|---|---|---|
| `omp-rpc` | first prompt (v1); omp's own config for a durable instruction later | first prompt via `spawn` | no generic system-prompt API Kabmo can write without touching the user's config |
| ACP (Claude, codex, …) | first prompt; Q3: MCP server `instructions` | first prompt via `session/prompt` | ACP has no system-prompt method; `session/new.mcpServers` is the only standardized side channel |
| MCP (Q3) | `initialize.instructions` on the injected server | n/a | the agent reads it without a prompt, and it survives a resume |

The MCP `instructions` field is the cleanest long-term home for the orchestrator contract: it is
delivered by the tool server Kabmo already injects, it is not user content, and it does not consume
a turn. It is Q3 work because it requires measuring each adapter.

### 8.6 Why "end your turn" is part of the prompt, not just the host

A blocking `await` is not merely discouraged; it is unimplementable in this model. The completion
that would end the wait is delivered by steering the waiting agent, and a steer preempts the turn
holding the tool call (bb-orchestra's README states this explicitly). So the contract the model must
learn is:

```
delegate  →  end turn  →  wake with report  →  read output  →  delegate again | answer user
```

The host enforces the mechanics (queue, coalescing, cold wake, dedupe); the prompt enforces the
behaviour (do not poll, do not serialise, do not relay). Neither half works alone: a host without
the prompt produces a polling agent that burns tokens; a prompt without the host produces an agent
that ends its turn and is never woken.

### 8.7 Model and effort per worker: default, inherited, or explicit

The answer is **default per harness, not one Run-wide default**. A model id is opaque and
provider-scoped (`opus` on Claude is not `anthropic/…` on omp), so Kabmo must never translate one
harness's model into another's. Cross-harness inheritance is invalid by construction.

Resolution order for a spawned worker (D18):

1. **Explicit** `--model` / `--thinking` on `kabmo session spawn`. Validated against that harness's
   live probe; an unknown value is refused, not silently replaced.
2. **Same-harness parent model**, only when the worker runs on the *same* harness as a live
   orchestrator. This is bb's "live parent execution" default and it keeps a reviewer at the tier
   the user already chose.
3. **Harness config default** — Settings → Harnesses (`provider` filter then `model`), resolved
   against the probe by `resolveDefaultModel`. A model the agent no longer lists falls through
   (existing measured behaviour, `shared/lib/harness/config.ts:164-183`).
4. **The agent's own default** — send no model at all. `startAcpSession` already does this when
   `request.model` and the configured default are both null; `/api/agent/new` does the same for
   `omp-rpc` after project model → global selected model.

Thinking/effort follows the same four steps and is only sent when that model advertises the level:
ACP config selectors are per-agent, and omp's `set_thinking_level` is its own vocabulary.

What the references do:

| Reference | Default when the caller says nothing |
|---|---|
| bb `thread spawn` | explicit flags → **live parent execution** → remembered project defaults; with none, the requested provider (or Codex) resolves its **provider-reported default model** (or the first catalog model); reasoning and permission default to `medium` / `auto` |
| bb-orchestra `orchestra_delegate` | the plugin setting's default provider/model/effort/permission, **`inherit` by default** — the worker inherits the orchestrator's values |
| bb workflows `agent()` | `provider`, `model`, `reasoningLevel` are all-or-none; omitted means BB's normal default for the chosen provider |
| Orca `worker-start` | no `--model` means the agent's own default; `--model` is opaque, validated on the execution host, `--effort` requires `--model`, and the receipt records `launch.requested` / `launch.effective` |
| orca-cli `run` | the adapter/default agent from `.orca/orca.toml` |

Two rules Kabmo should copy from Orca's receipt design, and one it should not:

- **Record requested and effective separately.** The session's `runModel` is the truth the agent
  reported; the spawn receipt keeps what was asked. Never echo the request as "effective" — that is
  the bug Orca filed as #16527.
- **Show the effective model on the worker row**, not only in the receipt. A worker that silently
  ran on the agent default must not look like it ran on the orchestrator's model.
- **Do not** make a Run-level "default model" that applies across harnesses. There is no shared
  vocabulary; per-harness config is the only correct place.

### 8.8 Shipped: the mention grammar and its defaults

The user-facing half of this design is implemented.

| Input | Worker |
|---|---|
| `@harness:claude` | Claude, harness default model, no role |
| `@claude` | same (bare alias; refused as a harness when it names an omp agent) |
| `@harness:omp` | omp over RPC (`omp-rpc`), default model |
| `@harness:claude:opus` | Claude pinned to `opus` |
| `@harness:claude:provider/model` | the exact model value the agent lists |

Rules:

- **One mention per paragraph.** Its paragraph, minus the mention, is that
  worker's whole `TASK`; a blank line separates workers. Two mentions in one
  paragraph, an unknown `@harness:`, or a mention with no task refuses the send
  before an optimistic bubble exists.
- **Bare means default.** No `:model` means the spawn command omits `--model`,
  so `spawn.server.ts` resolves: same-harness live parent model → ACP configured
  default (or the agent's own) / omp project model. It never copies a model id
  across harnesses.
- **The composer does not spawn.** The message compiles into a `[kabmo
  orchestration contract]` block with one exact `kabmo session spawn
  --parent-self --harness … --prompt-file - <<'KABMO_TASK_n'` command per
  paragraph. The orchestrator (Claude, omp, any harness) runs those commands,
  which keeps one scheduler and works identically in a pending chat and an open
  one.
- **The server writes the worker preamble.** Every parented `spawnChildSession`
  prepends `[kabmo dispatched worker]` with the parent id, `kabmo session tell`
  and the final-message-is-the-report rule; the orchestrator never has to
  restate the protocol.
- **Every new or resumed session gets the callback credential.** `/api/agent/new`,
  the RPC and ACP resume routes and the cold dispatcher mint
  `KABMO_AGENT_TOKEN` + `KABMO_SERVER_URL` into the child environment and record
  the hash against the session, so an ordinary top-level chat can run
  `kabmo session spawn --parent-self`.
- **Failure is classified, not flattened.** An ACP turn with no renderable
  answer (including a rejected `session/prompt`) is `failed` with the agent's own
  error text; a cancelled turn stays `interrupted`. RPC reports a refused prompt
  from its `response` frame (no `agent_end` will follow) and a terminal frame
  carrying an assistant `error` or a failure stop reason; an aborted run stays
  `interrupted`.
- **Picker rows are namespaced.** `@harness:<id>` cannot collide with `@file:`
  or an omp `@agent`; the harness rows survive `includeAgents: false` so an ACP
  chat can still delegate.

Files: `shared/lib/chat/composer/delegation.ts` (grammar + command formatter),
`client.ts` (picker rows), `prompt-text.ts` (send-time compilation),
`send.ts`/`send-helpers.ts` (one assembly, refusal before render),
`server/lib/sessions/spawn.server.ts` (model precedence + worker preamble),
`cli/lib/commands/session.js` (`--model`, `--thinking`).

Not shipped in this step: composer-side direct spawn (the orchestrator still
runs the command), model autocomplete below `@harness:<id>:` (the model is typed
and validated), role templates (`#role`), the MCP injection and the Run/fleet
UI.

### 8.9 Measured: a real three-worker run

Run on this machine (2026-11-09) against a temp DB and workspace:

| Role | Harness | Model | Result |
|---|---|---|---|
| Orchestrator | `omp-rpc` | `aihub-brisnets-jatis/deepseek-v4.1-flash` | spawned all three, read `session output`, reported |
| Worker 1 | `omp-acp` | `aihub-brisnets-jatis/deepseek-v4.1-flash` | `WORKER_OMP_ACP_OK` |
| Worker 2 | `opencode` | `opencode/deepseek-v4.1-flash-free` | `WORKER_OPENCODE_OK` |
| Worker 3 | `antigravity` | harness default | `WORKER_ANTIGRAVITY_OK` |

All three workers were recorded as children at depth 1, all three answers were
verified through `kabmo session output`, and the orchestrator received the
reports as system messages (one for the first finisher, one coalesced batch for
the other two).

Two findings from the run:

1. `kabmo session spawn --prompt-file -` was rejected by the shared CLI parser:
   a lone `-` was treated as a positional instead of the option value. Fixed in
   `src/cli/lib/args.js`; the contract's heredoc command now works as written.
2. The test server listened on `[::1]` while `KABMO_SERVER_URL` named
   `127.0.0.1`, so the first spawn attempts hit `ECONNREFUSED`. That is a test
   environment mismatch, not an orchestration bug; the orchestrator adapted and
   reported it. A real install should set `KABMO_SERVER_URL` to the address the
   server actually binds.

---

## 9. Phases

M19 ships P0–P5 (relations, spawn, notification, cold dispatcher, forks, CLI/token). M20 builds on
them and does not repeat them.

| Phase | Delivers | Proven by |
|---|---|---|
| **Q0** | orchestrator contract + worker preamble injection (both transports); `KABMO_SESSION_ID` / `KABMO_SERVER_URL` / `KABMO_AGENT_TOKEN` injection; agent-token guard; `kabmo session spawn/tell/output` | a real Claude ACP session spawns an omp worker and reads its output |
| **Q1** | `kabmo session wait` + the notice contract across transports; typed refusals (`harness_unavailable`, `worker_busy`, `worker_dead`, `output_unreadable`) | worker finishes while Claude is idle and while Claude is busy |
| **Q2** | `--worktree new-child|current`; per-worker worktree record; cleanup on delete | two writers in one Run do not share a checkout |
| **Q3** | MCP server (`kabmo mcp serve`) with `session_spawn`, `session_tell`, `session_output`, `session_status`; injected into ACP `session/new.mcpServers` | Claude calls a tool instead of a shell; omp's MCP settings path documented |
| **Q4** | Run record + limits (workers per run, depth, wall clock), fleet panel, child rows, phone list | a Run with two workers, one failure, one completion, rendered once each |

### Acceptance criteria

1. A Claude ACP session runs `kabmo session spawn --parent-self --harness omp-rpc --worktree
   new-child --prompt-file -`, receives a session id, and later receives that worker's outcome as a
   system notice in its own timeline.
2. Two workers finishing inside the coalescing window produce **one** Claude turn carrying both
   outcomes.
3. A worker that fails reports failure (not `completed`) and its stderr/final text is available to
   `session output`.
4. A worker finishing while the Claude tab is closed wakes Claude on the same ACP session
   (`session/load`) and delivers the same notice; if the agent cannot reload, the notice names the
   session and says the output is unreadable.
5. A harness the catalog knows but the machine cannot launch answers `harness_unavailable` before
   any process is spawned.
6. The same flow works with the orchestrator on `omp-rpc` and the worker on `claude`, proving the
   contract is transport-neutral.
7. The orchestrator's first prompt contains the contract block and a spawned worker's first prompt
   contains the dispatch preamble plus the task; the timeline shows both as system-authored, and
   the worker's report is its final message (no separate `worker_done` call).
8. A worker spawned without `--model` runs on the same-harness parent model when one exists,
   otherwise on that harness's configured default, otherwise on the agent's own default; the
   receipt records `requested` and `effective`, and they may differ.
9. No file in `src` crosses 350 lines; the §2 gates in `AGENTS.md` pass.

---

## 10. Risks and open questions

- **Claude's adapter queues, it does not steer.** M16 measured `_meta.claudeCode.promptQueueing:
  true`. A notice that arrives mid-turn is delayed, not injected. The UI must show "queued for
  Claude", and the coalescing window must not grow unbounded.
- **One process per worker.** Kabmo's ACP/RPC model is one child per chat with a 10-minute idle
  reaper. A fan-out of eight workers is eight processes; a Run needs an explicit worker cap and a
  visible cost line, not an implicit "as many as the prompt asks".
- **ACP output after the process dies.** An ACP transcript exists only while the agent can
  `session/load` it. A notice must never invent a final answer; it names the session when it cannot
  read one (M19 D5).
- **At-least-once notices.** A crash between `send` and the durable ack can duplicate a notice.
  Carry a stable `(childSessionId, turn)` marker and let the parent dedupe, as bb's workflow
  completion does.
- **Recursion.** A worker can become an orchestrator. M19's depth cap is the only thing that stops
  runaway nesting; M20 must enforce it at spawn, not at prompt time.
- **Run-to-folder scope.** M19 D8 keeps a child in its parent's folder. A Run that spans projects
  needs a place to render in the sidebar; until then, refuse cross-folder workers explicitly.
- **MCP injection trust.** `mcpServers` in `session/new` is an arbitrary command line. It is
  Kabmo's own binary and environment, but the value must come from the server, never from the
  agent's request, and the child must be spawned with `stripKabmoHostEnv` semantics.
- **`[INFERENCE]` Adapter tolerance for `mcpServers`.** The protocol requires connecting to the
  list; each adapter may implement stdio MCP differently. Q3 measures `claude`, `omp-acp`, `codex`
  and one more before the MCP path is announced as available.

---

## 11. Sources

| Source | Used for |
|---|---|
| [`get-bb/bb`](https://github.com/get-bb/bb) at `55135d1e` (2026-11-07), plus current `main` for the plugins | threads, CLI, notifications, workflows, provider abstraction |
| [`bb/docs/system-overview.md`](https://github.com/get-bb/bb/blob/main/docs/system-overview.md) | thread/environment/host model, lifecycle ownership, sweeps |
| [`bb/docs/provider-plugin-api.md`](https://github.com/get-bb/bb/blob/main/docs/provider-plugin-api.md) | provider as plugin; one process per provider artifact; no per-thread process in the runtime |
| [`bb/plugins/workflows/README.md`](https://github.com/get-bb/bb/blob/main/plugins/workflows/README.md) | QuickJS orchestration, hidden workers, replay, retries, structured output |
| [`dbrekelmans/bb-orchestra`](https://github.com/dbrekelmans/bb-orchestra) README and [`skills/orchestrating/SKILL.md`](https://github.com/dbrekelmans/bb-orchestra/blob/main/skills/orchestrating/SKILL.md) | agent tools, child-thread delivery, no-await rule, the delegate/end-turn/synthesize loop, "the subagent cannot see your conversation" |
| [`bb/plugins/bb-guide/introduction.ts`](https://github.com/get-bb/bb/blob/main/plugins/bb-guide/introduction.ts) | the injected orchestrator instruction and its restraint rule |
| [`stablyai/orca`](https://github.com/stablyai/orca) and [`onorca.dev/docs/cli/orchestration`](https://www.onorca.dev/docs/cli/orchestration) | Run/Task/Dispatch/messages/gates, nested depth, group addresses |
| [`stablyai/orca` worker preamble](https://github.com/stablyai/orca/blob/main/src/main/runtime/orchestration/workers/launch/worker-dispatch-preamble.ts) | the generated worker prompt: identity, CLI recipes, after-`worker_done` rules, `=== TASK ===` |
| [`stablyai/orca` orchestration skill](https://github.com/stablyai/orca/blob/main/skill-guides/orchestration.md) | coordinator recipe, "end your turn", task-spec guidance |
| [`stablyai/orca` native chat docs](https://www.onorca.dev/docs/agents/native-chat) and PR #26776 | workers as structured chats; omp as a chat worker |
| [`orca-cli/orca`](https://github.com/orca-cli/orca) README | single binary, MCP server, pods, worktrees, run lifecycle, policies |
| [`araa47/orca`](https://github.com/araa47/orca) README | tmux/worktree spawn, daemon auto-handling, escalation, depth/worker limits |
| [`ACP v2 overview`](https://agentclientprotocol.com/protocol/v2/overview) and [`session setup`](https://agentclientprotocol.com/protocol/v2/session-setup) | client/agent methods, `mcpServers`, resume, prompt lifecycle |
| [`ACP subagent RFD`](https://agentclientprotocol.com/rfds/subagents) | agent-internal subagents, client capability, "client cannot prompt a child", v2 baseline |
| Kabmo code | `harness/acp/verbs.ts`, `client.ts`, `session.ts`, `harness/launch-table.ts`, `omp/rpc/process.ts`, `queue/delivery.server.ts`, `cli/main.js` |
| M16, M17, M19 | measured adapter facts (`promptQueueing`), transport split, relations/fork design |
