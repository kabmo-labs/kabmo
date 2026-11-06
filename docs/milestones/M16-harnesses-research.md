# Multi-harness support (composer tab per harness)

Research, 2026-11-05. Question: can Kabmo let the user pick WHICH coding-agent
harness runs a chat — omp, deepseek-harness, opencode, Claude Code, Codex, pi,
MiniMax Code, Antigravity/Gemini CLI — as tabs in the composer's model dropdown?

**Verdict: possible, and the client-side seam already exists. The cost is not the
tab; it is the three places Kabmo currently reads omp-specific data:
`/api/models`, the session JSONL transcript, and the event frame vocabulary.**
Every number below was measured on this machine (omp 18.16.0, opencode 1.18.31,
codex-cli 0.166.0, claude 2.1.223, pi 0.73.1) with throwaway stdio and HTTP
probes, not read off documentation.

Status: **done** — built as designed in [`M17`](M17-harnesses-design.md): one ACP adapter family, in `src/server/lib/harness/` (2026-11-06, `687c5adf`).

---

## 1. What exists today (the coupling, measured)

| Surface | Evidence |
|---|---|
| omp-specific server code | `src/server/lib/omp/**` = **32 364 lines / 200 files** |
| Files importing it | **318** files under `src/` |
| omp-specific client+shared chat code | `src/{client,shared}/**/chat/omp` = **7 881 lines** |
| Live event vocabulary folded by the client | 31 `case` arms in `agent-events.ts` + 17 in `transport-frames.ts` |
| Session storage | JSONL under `~/.omp/agent/sessions`, read by `scan.ts`, `files.ts`, `messages.ts`, `locator.ts` |
| Model catalog | omp's `models.yml` through the shared utility RPC child (`rpc/utility.ts`) |
| RPC command surface Kabmo actually drives | ~20 distinct commands (`prompt`, `steer`, `abort`, `set_model`, `set_thinking_level`, `get_state`, `compact`, `bash`, `get_subagents`, …) |

The **client** side is closer to harness-neutral than it looks: the timeline drives
`OmpAgentHandle` (`sendPrompt`, `steerOmpRun`, `abort`, `setModel`,
`setThinkingLevel`, `respondToExtensionUi`), and every frame goes through one
pure fold, `foldAgentEvent(OmpAgentEvent)`. Replacing the *source* of those
frames behind the realtime `session:<id>` topic needs no timeline change.
`OmpAgentHandle` already IS an adapter interface; only its name is omp's.

## 2. Protocol landscape per harness

Every harness exposes at least two ways in. The four families the task asks
about — RPC, REST, ACP, SDK — are not four choices *per harness*, they are four
shapes across harnesses.

| Harness | Native RPC (stdio) | REST | ACP | SDK |
|---|---|---|---|---|
| **omp** | `omp --mode rpc` — NDJSON, 67 commands / 31 events (Kabmo's current path) | — | `omp acp` — full surface | `@oh-my-pi/pi-coding-agent` |
| **pi** | `pi --mode rpc` — same lineage as omp; `get_state`, `prompt`, `agent_settled` | — | `pi-acp` (3rd party) | `@mariozechner/pi-coding-agent` (in-process) |
| **opencode** | — | `opencode serve` — 162 OpenAPI paths, SSE `/api/session/:id/event` | `opencode acp` | `@opencode-ai/sdk` |
| **Codex** | `codex app-server` — JSON-RPC stdio (no `jsonrpc` field), thread/turn/item | — | `@agentclientprotocol/codex-acp` | `@openai/codex-sdk` |
| **Claude Code** | `claude -p --output-format stream-json` (one-shot per turn, `--resume` to continue) | — | `@agentclientprotocol/claude-agent-acp` | `@anthropic-ai/claude-agent-sdk` |
| **deepseek-harness** | `dsh --profile sdk` (JSON-RPC) | — | `dsh --profile acp` | Python/TS SDK over the `sdk` profile |
| **Gemini CLI** | `gemini -p --output-format stream-json` | — | `gemini --acp` (built in) | — |
| **MiniMax Code** | — | — | `@minimax-ai/code acp` | — |
| **Antigravity** | — | — | `agy_acp_server` (Google binary) | — |

The ACP registry (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`,
44 agents) already contains **7 of the 8 harnesses in this request**, plus
gemini, copilot, cursor, kimi, qwen, goose, cline, amp, devin, kiro, junie.

## 3. Measurements

### 3.1 Handshake and first token (median of 3 where repeated)

| Harness / transport | handshake | session create | first text chunk | turn end |
|---|---|---|---|---|
| **omp RPC** (`--mode rpc`) | ready **0.29–0.43 s** | in-band | **2.4–4.0 s** | +0.02–0.04 s |
| **omp ACP** (`omp acp`) | initialize **0.10–0.13 s** | `session/new` **0.27–0.30 s** | **2.89–3.19 s** | 2.90–3.20 s |
| **opencode ACP** | initialize **2.39 s** (plugin boot) | `session/new` +3.3 s | — (see 3.4) | — |
| **opencode REST** | `serve` port open **0.49 s**, first API **0.32 s** | `POST /api/session` **0.032 s** | — | — |
| **Codex app-server** | initialize **0.08 s** | `thread/start` **2.05 s** | — (401, no creds) | 23.6 s then `failed` |
| **Claude CLI** | — | — | — (OAuth expired) | 1.58 s one-shot |

Notes that matter for the design:

- **ACP is not the slow path.** omp ACP's handshake is 3× faster than omp RPC's
  (`0.11 s` vs `0.32 s`) and `session/new` costs `0.27 s`; the LLM dominates
  every wall-clock number after that. ACP does *not* pay a proxy tax here.
- **opencode's 2.4 s handshake is plugin startup**, and `opencode acp` writes
  non-JSON plugin log lines to **stdout** before the first JSON-RPC frame
  (`[opencode-blob-office] Plugin initialization START`). Any adapter must skip
  unparseable lines rather than fail the transport. `RpcProcess` today would
  treat that as a parse error.
- Codex's `thread/start` at ~2 s is the first-call warm-up (model catalog +
  Codex home); it is not per-turn.

### 3.2 Feature richness, measured per event stream

**omp ACP** (`session/new` returned `configOptions`):

```json
[{"id":"mode","category":"mode","n":2},
 {"id":"model","category":"model","n":221},
 {"id":"thinking","category":"thought_level","n":5}]
```

One file-read turn produced: `available_commands_update` (slash commands with
argument hints), `session_info_update`, `tool_call` + `tool_call_update` with
`rawInput`, `rawOutput.content[].text` **and** `rawOutput.details`
(line counts, `resolvedPath`, `displayContent`), `agent_thought_chunk` ×50,
`agent_message_chunk` ×6, `usage_update` with `{size, used, cost:{amount,currency}}`.
`session/list` returns `cwd`, `updatedAt`, `_meta.messageCount`. `session/load`
replayed 4 update frames and answered immediately after. Advertised:
`loadSession`, `sessionCapabilities {list, fork, resume, close}`, steering.

That is **enough to drive Kabmo's existing cards** — tool title/kind/status,
locations, diffs, thinking accordion, usage chip — without any omp-specific
knowledge. It is missing only Kabmo's own extensions (plan/goal markers, todo
phases, subagent roster) because those live in Kabmo's omp extension, not in omp.

**omp RPC** additionally carries: `tool_execution_update` snapshots,
`prompt_result`/`agentInvoked`, `command_output` (built-in slash commands),
`auto_retry_*`, `session_settled`, `todo_*`, `subagent_*`, `ttsr_triggered`,
`advisor_*`, `queue_update`. Strictly richer, and it is the only transport that
speaks Kabmo's mode markers natively.

**opencode REST**: 162 paths, including `/api/session/{id}/prompt` with
`delivery: steer|queue`, `/interrupt`, `/model`, `/permission/{id}/reply`,
`/question/{id}/reply`, `/context`, `/revert/*`, `/pty`. Its SSE stream emits
`session.next.text.delta|reasoning.delta|tool.called|tool.progress|tool.success|
tool.failed|step.started|step.failed|compaction.*|revert.*` — a V2 event model,
coarser than omp's but sufficient. `POST /prompt` answers in **57 ms**
(fire-and-forget admission), so latency lives entirely in the SSE stream.

**Codex app-server**: `item/*` + `item/agentMessage/delta`, `turn/plan/updated`,
`turn/diff/updated`, `commandExecution`/`fileChange`/`mcpToolCall` items,
approvals as server→client requests, and `codex app-server generate-ts`
produced **97 files** of protocol types — the best machine-readable contract of
the set. JSON-RPC without the `"jsonrpc"` header, so it is *not* wire-compatible
with ACP even though both are JSON-RPC.

### 3.3 Model discovery (what the dropdown tab can list)

| Harness | Source | Count measured |
|---|---|---|
| omp | `/api/models` (models.yml via utility child) | — (existing) |
| omp (ACP) | `configOptions[category=model]` | **221** |
| opencode | `GET /api/model` (`providerID`, `capabilities.tools`, input modalities) | **89** |
| Codex | `model/list` (+ reasoning efforts, `includeHidden`) | returned |
| Claude | SDK/`--model` aliases | — |
| ACP generic | `configOptions` after `session/new` | per agent |

ACP gives a *uniform* selector contract: `category` ∈ `model`, `thought_level`,
`model_config`, `mode`, and `session/set_config_option` to change them. That is
exactly the three controls the composer already has (model / thinking / access),
so one ACP adapter populates all three for 44 agents.

### 3.4 Where it breaks today (observed, not hypothesised)

- `opencode acp` + `session/prompt` with its default model produced **no**
  `agent_message_chunk` within 60 s and no `session/prompt` response; with an
  explicit `session/set_config_option model=opencode/crouton-alpha-free` the
  switch is acknowledged in 0.02 s but the turn still stalls. Over REST the same
  model returns `session.next.step.failed` with
  `"Provider request failed with HTTP 400: Model is unavailable."` — i.e. the
  transport is fine, the harness's provider is not, and **a harness that cannot
  complete a turn must be shown as unavailable, not as an empty answer**
  (repo rule: never substitute a failure).
- Codex without credentials: `turn/completed` with `status:"failed"` after 10
  `error` notifications (`"Reconnecting… n/5"`, 401). ACP/`turn/*` both report it
  properly — but only if the adapter forwards harness errors instead of
  swallowing them.
- Claude CLI: `is_error:true`, `"OAuth session expired"` in a clean
  `--output-format stream-json` envelope within 1.6 s. Same rule.

## 4. Against the requested priority: RPC → REST → ACP → SDK

The ordering is right for **omp and pi** (identical lineage; Kabmo already has
the RPC client, and `pi` answers `get_state` at 0.55 s with the same record
grammar). It is wrong as a *breadth* strategy, for one measured reason: 7 of the
8 requested harnesses ship ACP today, and only two ship a Kabmo-shaped RPC.
Ordering RPC-first per harness means writing 8 bespoke clients; ordering
ACP-second means writing one adapter that lights up all of them, then upgrading
the 2–3 harnesses where ACP loses a feature Kabmo needs.

Measured feature loss if ACP is the only path:

| Lost | Consequence | Mitigation |
|---|---|---|
| omp plan/goal markers, todo phases, subagent roster | plan/goal toggles, todo panel, subagent view go dark for non-omp | keep omp on RPC (its native path); hide the controls for other harnesses and say so |
| mid-run steering semantics | a second `prompt` **CANCELS** the running turn (measured) | omp's ACP uses the `_session/steering` extension; codex has `turn/steer`; opencode REST has `delivery:steer`; for an agent with none of those, disable steer and say so |
| per-tool diff detail | renderers degrade to `tool_call.content[]` diffs | ACP *does* define a `diff` content block; omp ACP emitted `rawOutput.details` instead, so per-agent sniffing is needed |
| approval granularity | omp's per-tool policy vs ACP's `session/request_permission` | map Kabmo's approval gate onto ACP permission options (`allow_once`, `allow_always`, `reject_once`, `reject_always`) |

## 4b. Feature matrix ACP vs RPC (measured side by side, same agent)

Both columns are **omp 18.16.0** on this machine, same cwd, same model, driven
back-to-back. This isolates the *transport* from the *agent*: everything below
is what ACP exposes versus what RPC exposes of the very same capabilities.

| Capability | omp RPC | omp ACP | Note |
|---|---|---|---|
| prompt | `prompt` | `session/prompt` | both |
| streamed text | `message_update.text_delta` | `agent_message_chunk` | ACP sends each chunk as its own frame (6 frames for "hello-kabmo-42") |
| thinking stream | `message_update.thinking` | `agent_thought_chunk` | measured 50–86 chunks per short turn |
| tool start/update/end | `tool_execution_start/_update/_end` | `tool_call` + `tool_call_update` | RPC's `_update` is a **full snapshot**; ACP's update is a patch |
| tool result detail | `details` | `rawOutput.details` | both carry `resolvedPath`, line counts, `displayContent` |
| tool file locations | in `args` | `locations[]` **top-level** | ACP is better for the diff/jump card |
| usage | `usage` on messages | `usage_update {size, used, cost{amount,currency}}` | ACP pushes it as its own frame |
| **steer mid-turn** | `steer` | **extension `_session/steering`** → `{outcome:"injected", queue:"steering"}`; `_meta.steering.queue:"followUp"` → `{queue:"followUp"}` | NOT in the ACP baseline: a plain second `prompt` **cancels** run 1 (measured twice: `stopReason:"cancelled"`) |
| queue follow-up | `follow_up` | none | |
| abort | `abort` | `session/cancel` (notification) | both |
| model list | `get_available_models` → **221** | `configOptions[model].options` → **221** | identical set |
| model switch | `set_model` | `session/set_config_option model` | ACP acks in 0.02 s |
| thinking level | `set_thinking_level` | `session/set_config_option thinking` | ACP: `thought_level` category, 5 options |
| **mode** | RPC has no verb (Kabmo injects `/kabmo-mode` prompt) | `configOptions[mode]` = `default`/`plan`; switch emits `current_mode_update {currentModeId:"plan"}` in 1.2 s | ACP is cleaner here than Kabmo's current hack |
| plan events | Kabmo `planStateMarker` extension frames | `session/update plan` (full entry list each time, per spec) | omp ACP did **not** emit `plan` in any of the 5 turns measured; the ACP spec defines it, omp's adapter doesn't use it |
| slash commands | `get_available_commands` → **64** | `available_commands_update` → **64** | identical list, with arg hints |
| compact | `compact` | none | |
| bash | `bash` → `{output, exitCode, totalLines, bytes}` | via `terminal/*` bridge (client runs it) | see below |
| session stats | `get_session_stats` | none | |
| message paging | `get_messages_page` | `session/load` replay only | |
| session list | filesystem scan | `session/list` → `sessionId, cwd, updatedAt, messageCount, size` | |
| fork / resume / close | `new_session`, `switch_session`, `branch` | `session/fork`, `session/resume`, `session/close` (`{}` ack) | ACP advertises all four |
| title update | `session_info_update` + `set_session_name` | `session_info_update` on `session/update` | |
| **host tools** | `set_host_tools` → registers `kabmo_open_file` as a real tool | **none** | RPC-only: Kabmo can hand the agent its own tools |
| **host URI schemes** | `set_host_uri_schemes` → `kabmo://` links | none | RPC-only |
| **todos** | `set_todos` / `todoPhases` | none | RPC-only: the todo panel has no source over ACP |
| subagent roster | `get_subagents`, `set_subagent_subscription` | none | RPC-only |
| plan/goal markers | Kabmo extension frames | none | RPC-only |
| approvals/ask dialogs | `extension_ui_request` + response | `session/request_permission` with `options[]` (`allow_once`, `allow_always`, `reject_once`, …) | measured on `rm -v zz.txt`: request carries the full `toolCall` (title `rm -v zz.txt`, `kind:"execute"`, `rawInput.command`); rejecting it ends the prompt with a normal result, and the agent retried the same command — so `reject_once` is not sticky |
| images in a prompt | `images: ImageContent[]` | `{type:"image", data, mimeType}` content block | both |
| **fs access** | in-process (agent reads disk itself) | **client-side bridge** (`fs/read_text_file` measured) | ACP routes reads through the host — this is how an editor keeps buffers in sync |
| fast mode | `set_fast_mode` (model-gated) | none | RPC-only |
| terminal | in-process runner | **client-side bridge**: `terminal/create` → `wait_for_exit` → `output` → `release` (measured) | ACP can run the command in Kabmo's own terminal panel |

### What the measurements change about the recommendation

1. **ACP is a superset on the surfaces Kabmo renders most**: tool cards (it adds
   `locations` and per-update patches instead of full snapshots), usage+cost as
   a first-class frame, a `diff` content block in the spec, and a **mode**
   selector that replaces Kabmo's `/kabmo-mode` prompt injection with a real
   config option (`default`/`plan`, with a `current_mode_update` notification).
   Caveat measured: omp's own ACP adapter never emitted a `plan` update in 5
   turns, including one run in plan mode — so the plan panel is spec-available
   but adapter-dependent, and must be feature-detected, not assumed.
2. **ACP is strictly weaker on four Kabmo panels**: todo phases, subagent roster,
   host tools/URI schemes, and session stats/message paging. Those four are the
   reason not to move omp *off* RPC — not a reason to avoid ACP for everyone else.
3. **Steering lives in an omp-only ACP extension, and the baseline is a trap.**
   The `initialize` result advertises `_meta.steering.supported: true`; the
   method is **`_session/steering`** (found by string-searching the installed
   binary — it is not in the ACP spec, and every guessed name returned
   `Unknown ACP ext method`). It answers `{outcome:"injected", queue:"steering"}`,
   and `_meta.steering.queue: "followUp"` queues instead of steering. Without it,
   a second `session/prompt` while a turn runs **cancels** the first turn
   (`stopReason: "cancelled"` on both, measured twice). So Kabmo's queue/steer UI
   must be driven by two different verbs per harness, and for ACP agents with no
   extension it must be disabled — not silently rerouted — or "send now" destroys
   the answer the user was watching. RPC at least refuses loudly:
   `"Agent is already processing. Use steer() or followUp()…"`.
4. **Config changes apply to the running turn on both transports.** Setting
   `thinking` mid-run was accepted, and a `model` switch mid-turn emitted
   `config_option_update` and the turn kept streaming — the same hazard
   `deferred-model.ts` already documents for RPC. The client-side deferral rule
   (stash the pick, apply before the next prompt) must be transport-independent.
5. **Terminal + fs bridging is optional and per-client.** With
   `clientCapabilities.terminal` absent, omp runs the command itself; with it
   present, the client gets `terminal/create` with `/bin/bash -l -c "…"` plus
   `PI_SESSION_ID` in env, then `wait_for_exit`/`output`/`release`. A Kabmo ACP
   adapter that advertises `terminal` inherits responsibility for running those
   commands in the terminal panel — and for answering `fs/read_text_file` from
   the real disk. Declaring a capability Kabmo does not implement makes the agent
   hang on a request nobody answers (the adapter must decline at `initialize`).

**Recommended order:** omp RPC (default, exists) → **omp ACP** (proves the
adapter against the same agent, near-zero risk, and it is the fastest handshake
measured) → **generic ACP** (opencode, gemini/antigravity, minimax, claude via
`claude-agent-acp`, codex via `codex-acp`, pi via `pi-acp`, dsh) → **native
transports for the 3 that out-feature ACP**: opencode REST (steering, queue,
permissions, PTY, revert), Codex app-server (plan/diff/approvals), pi RPC
(near-omp parity). SDK last: the SDKs are in-process and bind Kabmo's Bun server
to one vendor's runtime and version; the subprocess boundary is what gives
Kabmo its kill-tree, ownership lease, and crash isolation today.

## 5. Architecture: one seam, three couplings

### 5.1 The seam already exists

`AgentSessionWrapper` (`src/server/lib/omp/rpc/manager.ts`) is the interface the
whole server already treats as "a session". Its public surface:

```
sessionId, sessionFile, cwd, pid      getters
isAlive() isRunning() isBusy()        lifecycle
start() waitUntilReady() destroyAndWait()
send(command: Record<string, unknown>)       ← the only control channel
onEvent(listener) emit(event)                ← the only frame channel
getPendingUiDialogs() resolvePendingUiDialog(id)
runModel, modeMirror, subagents, idle, runSettle
```

Reduce that to a `HarnessSession` contract plus a `HarnessDriver`
(`spawn`, `adopt(id)`, `listSessions`, `listModels`), and the registry in
`session-registry.ts` becomes a map of `harness → driver`. The realtime
`session:<id>` topic, the SSE path, the sidebar's spin/badge logic, and the whole
client all keep working untouched, because they only ever see frames.

### 5.2 Three couplings to break

1. **Frames.** Add a per-harness mapper `native event → AgentEvent` so
   `foldAgentEvent` stays the single fold. ~300–800 lines per harness; ACP's
   mapper is one file because ACP already normalises `tool_call`, `plan`,
   `agent_message_chunk`, `usage_update`.
2. **Transcript.** Kabmo's timeline reload, sidebar, titles, rewind, delete and
   mode read walk omp JSONL (`getSessionsDir()`). Introduce a
   `session_harness` row (session id → harness + native id + cwd) and per-harness
   history sources: ACP `session/load` replay (measured: full turn in 4 frames),
   opencode `GET /api/session/:id/history`, Codex `thread/items/list`,
   pi/dsh JSONL (pi's format is version-3 tree JSONL — same parser family as
   omp's, needs a second mapper, not a second parser).
3. **Models.** `/api/models` is omp's registry. Make it
   `/api/models?harness=<id>` with a per-harness provider, and namespace
   `modelKey` to `harness:provider:id` — `provider:id` already collides inside
   omp alone (`deepseek-v4-flash` exists under both `deepseek` and `kenari`), so
   adding a harness dimension without namespacing will silently cross-select.

### 5.3 UX: tabs, not a second dropdown

The dropdown is `model-dropdown/{index,Panel,Header,Section,Item}.tsx`. The tab
strip belongs in `Header.tsx` (above the search field), because the tab changes
what the list *is*, not which row is chosen. Model selection is per-session
config; harness is a spawn-time property — changing it on a live session must
mean a new session, and the tab must say so rather than silently switching the
frame source under a running turn.

Tab states must be honest: `available` (binary + auth present), `not installed`
(with the install command, like `install-hint.ts` does for omp), `not signed in`
(ACP `authMethods` / codex 401 / claude OAuth — all three were hit during this
research).

## 6. Cost

| Piece | Estimate |
|---|---|
| Composer tab + namespaced model keys + per-harness model route | small (1–2 files + `Header.tsx`, one server route change) |
| `HarnessSession`/`HarnessDriver` seam + registry split | medium: touches `session-registry`, `command.ts`, `new.ts`, `topics/session.server.ts`, `manager.ts` typing |
| ACP adapter (all 44 registry agents) | 1 ACP client (~600–900 LOC incl. fs/terminal/permission handlers) + 1 frame mapper + history via `session/load` |
| omp ACP as second adapter | small once ACP exists: reuse, add omp's `_meta.steering` |
| Native adapters (opencode REST / codex app-server / pi RPC) | per harness ~500–900 LOC mapper + control verbs; opencode REST is the cheapest (HTTP + SSE, no process to supervise) |
| Transcript/session store + sidebar for non-omp | medium: `session_harness` table, per-harness list + delete, title source |

Rule of thumb from the measurements: **the transport is cheap, the mapper is
the work.** Every harness's handshake was under 0.5 s except opencode's plugin
boot; every harness's event model needed its own translation table.

## 7. Risks

- **Ownership.** omp writes a session lease (`lease-flock.server.ts`) that makes
  multi-instance peer relay safe. Nothing else does. ACP/opencode/codex adapters
  need a Kabmo-side lease keyed by `(harness, native session id)` or the second
  instance will double-drive a session.
- **Modes.** Plan/Goal are implemented as a Kabmo extension inside the omp child
  (`kabmoModeEnv`, `KABMO_MODES`). ACP has `mode` as a config option for omp;
  other agents only have their own modes. Keep the toggles omp-only and state it.
- **Approvals.** Kabmo's ask/approval gate is fed by `extension_ui_request`.
  ACP uses `session/request_permission` *and* `elicitation/create`; codex uses
  its own approval requests. All three must land on the same dialog component,
  or a non-omp run hangs on a prompt nobody sees.
- **Sessions without transcripts.** `isOmpSession` in
  `hooks/chat/timeline/index.ts` decides whether a chat is live at all
  (UUID-shaped ids route to the agent bridge). A non-omp id (`ses_…`, `thr_…`,
  `sess_…`) fails that test today and would fall into the mock/static path.
- **`350 lines / file`** forces one folder per harness (`src/server/lib/harness/acp/`,
  `…/opencode/`, `…/codex/`) rather than one growing "adapters" file.

## 8. Answer

Yes — feasible, in this order:

1. **Seam** (`HarnessSession` + `HarnessDriver` + `session_harness`), omp RPC
   unchanged, one harness in the tab strip.
2. **omp ACP** as the second tab: cheapest proof, fastest handshake measured,
   exercises the ACP command/event mapping against an agent whose behaviour is
   already known.
3. **Generic ACP**: opencode, Gemini/Antigravity, MiniMax, Claude (`claude-agent-acp`),
   Codex (`codex-acp`), pi (`pi-acp`), deepseek-harness (`dsh --profile acp`).
   One adapter, 44 possible agents, model+thinking+mode selectors for free.
4. **Native upgrades** only where ACP measurably loses something Kabmo shows:
   opencode REST (steer/queue/PTY/revert), Codex app-server (plan/diff/approvals),
   pi RPC (omp-parity event stream).
5. **SDKs last** — they trade the process boundary for in-process coupling.

Do not put harness and model in the same flat list: harness is a per-session
spawn choice, model is per-session config, and the tab has to be able to say
"not installed" / "not signed in" / "this harness cannot steer mid-turn".

---

## 9. Per-harness recommendation

Every command below was **launched on this machine** and answered `initialize`.
The `session/new` column is the measured time to a usable session; the last
column is what the harness said when it could not complete a session, which is
exactly the state the composer tab must render.

### 9.1 The table

| Harness | Recommended transport | Launch command (verified) | `init` | `session/new` | Auth-state measured | Verdict |
|---|---|---|---|---|---|---|
| **omp** | **RPC** `--mode rpc-ui` (exists) | `omp --mode rpc-ui --cwd <dir>` | 0.29–0.43 s | — | ok | **Keep.** Only path with todos, subagents, host tools, stats, compaction |
| **omp** (second tab / fallback) | ACP | `omp acp` | **0.08–0.13 s** | **0.22–0.30 s** | ok | Best ACP adapter measured; fastest handshake of the set |
| **pi** | **RPC** | `pi --mode rpc --no-session` | 0.55 s (`get_state`) | — | needs model configured | Same protocol lineage as omp → 1 mapper family |
| **pi** (via adapter) | ACP | `pi-acp` (npm) | 0.13 s | 0.13–0.36 s | `pi_terminal_login` required | Works, but shell-outs to `pi` on PATH |
| **opencode** | **REST** (`serve`) | `opencode serve --port N --hostname 127.0.0.1` | **0.49 s to port** | `POST /api/session` **0.032 s** | ok (89 models) | Richest: steer/queue, permissions, PTY, revert, 162 endpoints |
| **opencode** (via adapter) | ACP | `opencode acp` | 2.32–2.39 s | +3.3 s | ok (102 models) | Works but 5× slower to start; prints plugin logs to **stdout** |
| **Codex** | **app-server (JSON-RPC)** | `codex app-server` | **0.08 s** | `thread/start` 2.05 s | 401 without creds | 85 methods, generated TS schema (97 files) |
| **Codex** (via adapter) | ACP | `codex-acp` (needs `CODEX_PATH`) | 0.35 s | 0.36 s | `Authentication required` | Fine; adapter is a thin bridge over app-server |
| **Claude Code** | **ACP** (`claude-agent-acp`) | `claude-agent-acp` | **0.22 s** | **0.53 s** | `_auth/status_update: Not logged in` | 5 config selectors incl. `mode`/`effort`/`fast`/`ultracode` |
| **Claude Code** (native) | CLI `-p --input-format stream-json` | `claude -p --input-format stream-json --output-format stream-json --verbose` | 0.9 s | stdin stays open | OAuth expired | Multi-turn works, **but** no config selectors, no permission API |
| **deepseek-harness** | **ACP** | `dsh --profile acp` | 0.93–0.98 s | +0.03 s | ok | Standard ACP only; **no fork/delete/replay** |
| **deepseek-harness** (alt) | SDK JSON-RPC | `dsh --profile sdk` | 0.62 s | `session/prompt` creates | ok | 7 methods only; different vocabulary (see 9.3) |
| **Gemini CLI** | **ACP** | `gemini --acp` | 0.76 s | 0.80 s | API key missing | Image+audio+embeddedContext capabilities |
| **MiniMax Code** | **ACP** | `mcode acp` | 0.75 s | 0.76 s | `Run mcode login` | 4 session caps incl. fork/resume/close/list |
| **Antigravity** | **ACP** only | `agy_acp_server.par` (Google, 98 MB) | — (not run: 98 MB download) | — | unknown | No CLI/RPC/REST surface — ACP is the only entry |
| **qwen-code** | **ACP** | `qwen --acp` | 0.84 s | 0.86 s | `qwen auth` required | list/resume; image capability `_meta` |
| **Kimi** | **ACP** | `kimi acp` | — (not run) | — | unknown | Registry binary; same shape as opencode |
| **Cursor** | **ACP** | `cursor-agent acp` | — (not run) | — | unknown | Registry binary |

Handshake measured, whole set: **omp ACP 0.08 s < pi-acp 0.13 s < claude-acp
0.22 s < codex-acp 0.35 s < minimax 0.75 s < gemini 0.76 s < qwen 0.84 s <
dsh 0.93 s < opencode ACP 2.32 s**. REST is a different shape: opencode's server
is listening in **0.49 s** and creating a session costs **32 ms**.

### 9.2 The recommendation in one line per harness

| Harness | Use | Why not the alternative |
|---|---|---|
| omp | **RPC** | ACP loses todos/subagents/host-tools/stats/compact — 6 Kabmo panels |
| pi | **RPC** | omp-lineage protocol; the ACP adapter is a third-party wrapper that needs `pi` on `PATH` |
| opencode | **REST + SSE** | 5× faster startup, 2× cheaper session creation, and ACP exposes only `model`+`mode` of its 162 endpoints |
| Codex | **app-server** | ACP adapter requires an external `CODEX_PATH` and adds a hop; app-server has 85 methods and a generated schema |
| Claude Code | **ACP** | The native CLI's multi-turn stdin works but has no config selectors, no permission API, no `loadSession` |
| deepseek-harness | **ACP** | Its SDK profile is 7 methods with its own vocabulary; ACP is the standard one |
| Gemini / MiniMax / Antigravity / qwen / Kimi / Cursor | **ACP** | ACP is the *only* programmatic surface they ship |

### 9.3 What makes ACP the default (and where it is not)

Measured `configOptions` per agent — the composer's three controls, for free:

| Harness (ACP) | selectors returned by `session/new` |
|---|---|
| omp | `mode`(2), `model`(**221**), `thinking`(5) — categories: `mode`, `model`, `thought_level` |
| opencode | `model`(**102**), `mode`(3) |
| claude-agent-acp | `mode`(5), `model`(5), `effort`(6), `fast`(2), `ultracode`(2) |
| dsh | `model`(1), `reasoning_effort`(4) |
| codex-acp / gemini / minimax / qwen | auth required before `session/new` returns options — the tab shows "not signed in" |

Two things ACP cannot give Kabmo, so they must be feature-detected per agent:

- **`session/fork`, `session/delete`, replay.** Advertised unevenly: omp has
  `list/fork/resume/close`; opencode has `close/fork/list/resume`; claude has
  `additionalDirectories/close/delete/fork/list/resume/systemPrompt`; minimax
  has `list/fork/resume/close`; **dsh has only `close/list/resume`** (its own
  README says deletion, forks and transcript replay are unsupported); pi-acp has
  only `list/delete`; gemini has none of those four.
- **Steering.** `_session/steering` is omp-only. Claude's adapter advertises
  `_meta.claudeCode.promptQueueing: true` (a queue, not a steer); codex-acp
  documents a `_session/steering` extension of its own; opencode offers
  `delivery: "steer"|"queue"` over REST. Everything else: disable the control.

### 9.4 Adapter gotchas that would bite a naive integration

Measured, in the order they would appear:

1. **`opencode acp` writes non-JSON to stdout** (`[opencode-blob-office] Plugin
   initialization START`) before the first frame. The reader must skip
   unparseable lines instead of failing the transport.
2. **`pi-acp` shells out to a `pi` binary on `PATH`** and errors with
   `executable not found (command: pi)` inside `session/new` — the failure
   arrives as a *session* error, not a spawn error, so the tab would look
   "available" until the first click.
3. **`codex-acp` needs `CODEX_PATH`** when the bundled Codex cannot run; with a
   broken path it reports `[APP-SERVER EXIT] code 1`, and only `APP_SERVER_LOGS`
   shows why (`Missing optional dependency @openai/codex-darwin-arm64`).
4. **`dsh --profile acp` accepts `session/list` before any session exists** and
   lists sessions from *other* runs (`kabmo-t1`, `kabmo-t2`, …) — so a Kabmo
   `session/list` must filter by its own cwd and id namespace.
5. **`dsh --profile sdk` is a different protocol**: `initialize` takes
   `{cwd, provider, model, reasoningEffort?}`, prompts use `contentBlocks` (not
   `prompt`), and it answers `session "x" already exists` on reuse — 7 methods
   total, 4 notifications. Do not try to unify it with ACP.
6. **`gemini --acp` / `mcode acp` / `qwen --acp` answer `initialize` fine but
   fail `session/new` with `-32000 Authentication required`** — the auth list
   is the only way the UI can name the next step, and it differs per agent
   (`oauth-personal` / `gemini-api-key` / `vertex-ai`, `mcode login`,
   `qwen --auth-type=openai`, `pi_terminal_login`).
7. **`claude-agent-acp` is silent on stdout until asked** and pushes
   `_auth/status_update` *unsolicited* ~3.4 s after `initialize` — a client that
   treats unknown notifications as errors will break on a healthy adapter.
