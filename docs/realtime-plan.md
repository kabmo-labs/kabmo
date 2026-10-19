# Unified Realtime Transport

One WebSocket per browser tab carries every server-originated event. Polling,
per-session SSE, and the client-side event bus that mirrored server state are all
replaced by a single hub with per-topic subscriptions.

Status: **complete**. All four phases shipped; see the phase table at the
bottom for what each one verified.

## Decisions

**One socket per tab, not one per browser.** A WebSocket belongs to a document,
so two tabs are two connections. The property this design buys is "one tab opens
one socket", not "the browser opens one socket" — the latter needs a
`SharedWorker`, which iOS Safari does not implement, so it would force a second
code path rather than remove one.

**Topics are the resources the server owns and pushes**, not the `omp:*` window
event names. What made polling necessary was data that changes on the server;
the remaining window events are pure DOM navigation that never crosses the
network.

**Snapshot on subscribe, delta on change.** A topic's `subscribe` answers with a
full snapshot and then pushes increments. This removes polling without inventing
a new consistency model — every consumer already does "GET, repeat".

**Frames:**

```ts
// client → server
{ t: 'subscribe',   topics: string[] }
{ t: 'unsubscribe', topics: string[] }
{ t: 'resync',      topics: string[] }   // after a reconnect
{ t: 'ping',        id: number }

// server → client
{ t: 'snapshot',   topic: string, seq: number, payload: unknown }
{ t: 'delta',      topic: string, seq: number, payload: unknown }
{ t: 'pong',       id: number }
{ t: 'error',      code: string, message: string }
```

There is no `invalidate` frame: it was specified for payloads "too large to
ship", and the two topics that would have used it (`models`, `panels`) are
republished as an ordinary snapshot on demand instead. A third frame kind would
have needed a client branch for no payload the snapshot path cannot carry.

## Topics

| Topic | Snapshot | Delta trigger | Replaces |
|---|---|---|---|
| `sidebar` | `loadSidebarData()` | stream-status writes, `invalidateOmpSidebarData` (`delete.server.ts:129`), session JSONL writes | `omp:session-updated`, `omp:workspace-updated`, `useStreamPoll` (8s), `useSidebarRevalidation` (1s), idle poll (30s) |
| `sidebar:status` | status map only | every stream-status write | the fast-changing half of `sidebar` |
| `session:<id>` | `buildWebState` + queue + modes | `EventFanout.emit` (`manager.ts:256`) | agent WS + SSE, `omp:stream-pending`, `omp:session-renamed`, `omp:session-title-hint`, `kabmo-mode`, `subagent_*` |
| `session:<id>:todos` / `:plan` | reader per panel | turn boundary from the fold (`session-data-dirty`) | `useKabmoFetch` + `omp:session-updated` |
| `session:<id>:telemetry` | `/api/telemetry/context` | turn boundary from the fold | `usePanelRefresh` (5s) |
| `session:<id>:queue` | `listQueue` | every queue write, including the server's own delivery claim | `QUEUE_POLL_INTERVAL_MS` (3s) as a queue READ; the timer survives only as a delivery nudge |
| `git:<root>\0<repo>` | `buildGitStatusMaps` | file-mutating tool completion | `GIT_STATUS_POLL_MS` (15s), `omp:files-mutated` |
| `fs:<root>\0<repo>` | listing | same (invalidate) | `usePanelRefresh` (5s) |
| `repos:<root>` | `?reposOnly=1` | discovery settles | `REPO_DISCOVERY_POLL_MS` (1.5s) |
| `usage` | `buildUsageProviders()` | provider/key writes | `usePanelRefresh` (5s) |
| `schedule` | task list | schedule routes + `runtime.server.ts` | `SCHEDULE_POLL_MS` (10s) / badge (30s), `omp:schedule-updated` |
| `panels` | registry payload | plugin install/remove | `omp:panels-changed` |
| `models` | `loadModelsWithCache()` | `invalidateModelsCache` | `omp:models-updated` |
| `wiki:<scope>` | wiki tree | mirror change | `usePanelRefresh` (5s) |
| `btw:<id>` | `btwStateFor()` | `publishBtw` (`registry.server.ts:92`) | btw WS + SSE |

The four `session:<id>:<suffix>` topics share ONE delta trigger, the
`session-data-dirty` signal. It is raised at a turn boundary rather than per
tool — a `todo` call commits its snapshot inside the run, so the transcript only
tells the truth once the turn settles — and by every queue write. The
republisher reads the SUBSCRIBED set, so a tab that never opened the todo panel
pays nothing for a topic whose resolver parses a whole transcript.

The socket's own connection status is deliberately **not** a topic: a transport
reporting its own health over itself is self-referential. It stays local state
read off the socket object.

## What does not move, and why

| Stays separate | Reason |
|---|---|
| Terminal, dictation | Bidirectional binary; a PTY has a grid and resize semantics, dictation uploads PCM16 |
| Browser screencast | JPEG at 1s/frame — would flood the shared path |
| Search, update-apply, omp-login, mock chat | **Responses to one request**, not push. These are not a second channel; they are the reply to something the client started |
| 10 UI-local events (`open-file`, `open-diff`, `open-settings`, `view-subagent`, `btw`, `update-popup`, `update-request`, `theme-changed`, `editor-font-changed`, `browser-include-page`) | Never cross the network. Routing them through a socket adds latency and a failure mode to actions that must be instant |

## Server-side invariants

1. **Register before snapshot, buffer deltas while the snapshot is in flight.**
   The snapshot is async (JSONL scan, `git status`). Registering after it loses
   any delta that lands in between; registering before it without buffering hands
   the client `delta seq 7` ahead of `snapshot seq 5`.
2. **`seq` is per topic, held by the hub.** One snapshot serves every subscriber,
   so the numbering has to be shared. A client that sees a gap asks for `resync`
   rather than sitting on stale data.
3. **Snapshot is single-flight and uncached.** Two tabs subscribing together
   share one scan; a subscriber arriving later triggers a fresh one, which is
   correct because the data may have changed. A TTL here would reintroduce the
   staleness this design removes.
4. **Subscribe never spawns.** Snapshot reads the live registry read-only, the
   way the existing routes do. Subscribing to `session:X` must not boot an omp
   child for a session that is only being looked at.
5. **Refcount per topic.** No subscribers means no work — `usage` shells out to
   `omp usage` and `sidebar` scans the JSONL, so neither may run for a tab that
   did not ask.
6. **Hidden tab unsubscribes.** A hidden panel releases its topics, so the
   server stops producing snapshots nobody renders — the behaviour the removed
   `useVisibilityRefresh` aimed for, now enforced by the subscription refcount.
7. **Per-topic fan-out.** A frame goes to the subscribers of its topic only.
   Broadcasting to every connection leaks one session's stream into a tab that is
   not rendering it.

## Client-side invariants

1. **One socket per tab**, owned by a module singleton with refcounted topics.
2. **Gap detection**: `delta.seq !== last + 1` triggers `resync`.
3. **Reconnect resubscribes** the live topic set; the new snapshot is the repair.
4. **Stale is a state**, not a silent failure — a topic whose socket is down
   reports `stale`, and every panel keeps a manual `refresh`.

## Phases

| Phase | Content | Gate |
|---|---|---|
| 1 ✅ | Protocol, hub, route, client singleton, `useRealtimeTopic`; topics `sidebar` + `sidebar:status`; the sidebar's two polls deleted | **Done.** 4627 tests pass; lint/tsc-unused/350-line/build all clean; verified against a live server: `snapshot seq=2 (4 sessions)` → an external `omp -p` wrote a session → `delta seq=3 (5 sessions)` at 4.3s, with no polling |
| 2 ✅ | `session:<id>` + `btw:<id>`; agent and BTW streams migrated; both WS + SSE routes and the `streamTransport` setting deleted | **Done.** 4599 tests pass; gates clean; verified against a live server: a real spawn + prompt produced **12 frames on ONE socket** (`snapshot` → `agent_start` → `turn_start` → `message_*` → `agent_end`), and `btw:<id>` answers its own snapshot |
| 3 ✅ | Data topics: session todos/plan/telemetry/queue, the global `usage`/`schedule`/`panels`/`models`, and the workspace `git`/`fs`/`repos`/`wiki` — with their client consumers (todo/plan/usage/wiki panels, files/git/search/terminal, schedule modal + badge, models invalidation, repo picker). The repo-discovery retry timer and the wiki's duplicate GET are gone | **Done.** 4600 tests pass; gates clean; verified against a live server: one socket delivered `sidebar` (4 folders), `git:<root>` (152 changes), `repos:<root>` (`pending:true` → a `delta` when the walk settled), and a `POST /api/folders` produced a fresh `sidebar` delta carrying the new folder. The four session DATA topics originally had no publisher; they now ride `session-data-dirty` and were re-verified end to end (a live run moved the Todo panel with no reload) |
| 4 ✅ | The emptied `visibility-refresh`/`panel-refresh`/`revalidation-throttle`/`stream-poll` hooks and every server-origin `omp:*` event (`session-updated`, `workspace-updated`, `renamed`, `stream-pending`, `session-title-hint`, `kabmo-mode`, `panels-changed`, `models-updated`, `schedule-updated`, `files-mutated`) plus the 3 `subagent_*` window events — replaced by server signals (structure writes) and a client signal bus (UI-local coordination). The ten UI-local navigation events stay, as the table below requires | **Done.** No server-origin event string remains; every file under 350 lines; 4600 tests pass; lint/tsc-unused/build clean. An audit after the phase found the session DATA topics had no publisher and the `updates` topic had no consumer, both fixed in the same pass (see the phase 3 notes) |

Every phase must pass: `bun run lint`, `bunx tsc --noEmit --noUnusedLocals
--noUnusedParameters`, the 350-line check, and `bun run build`.

## Phase 1 notes

**Elysia hands `message` an already-PARSED JSON frame.** Measured on 1.4.30: a
`{t:'subscribe'}` sent as text arrives at the handler as an object, so a decoder
that required `typeof raw === 'string'` silently dropped every inbound frame and
no client ever subscribed. `decodeClientFrame` accepts both shapes, exactly as
`terminal/protocol.ts` already did.

**A session FILE appearing needed a watcher, not a poll.** omp creates a
session's JSONL only when the first assistant message settles (~17s), and that
moment is reported by nothing in Kabmo — the 30s idle poll was the only
thing covering it. `sessions-watch.server.ts` watches the sessions root
recursively. Measured against real `omp -p`: the create arrives as
`rename: <id>.jsonl` (a temp-file rename), while an APPEND to a live transcript
arrives as `change` — so the filter is `rename` + `.jsonl`, which keeps a
streaming turn from re-running the discovery scan on every append.

**A structure publish must invalidate the scan cache first.** The discovery scan
is TTL'd (4s) and `publishSidebarStructure` runs precisely when something
structural moved, so without the invalidate the publish would answer with the
snapshot taken before the change — the new session would be missing from the
very frame that announced it.

**The heal rules moved out of `stream-state.server.ts`** into
`stream-heal.server.ts`: adding the realtime signal pushed the original file past
the repo's 350-line ceiling, and the abandoned-row rules are a different concern
(when a record is stale) from the writes and reads that record it.

## Phase 2 notes

**The client is process state, and a test must reset it.** A suite that ran
earlier can leave the singleton holding a socket to a listener that is gone; the
next `subscribe` then finds a socket already present and never dials the new
server, so the channel reports `connecting` forever against a healthy port. The
test harness now resets the client before each server it starts.

**A dial needs a deadline.** Measured: a socket can sit in `CONNECTING` with no
`open`, `error` or `close` at all — a listener that has bound but is not
accepting, or a proxy that swallows the upgrade. Backoff is driven by `close`, so
without an explicit timeout the channel would sit dead forever while the tab said
"connecting". `connection.ts` abandons a dial after 10s, and closing it takes the
normal retry path.

**Frame vs value subscriptions.** A panel wants the latest VALUE; a timeline
wants every FRAME. Collapsing agent frames to the last payload would drop the
run, so the client exposes `subscribeFrames` alongside `subscribe`/`read`.

**A topic subscribed before its source exists must be re-snapshotted.** A
`session:<id>` topic subscribed against a placeholder has no child to bind to, so
it publishes nothing. The spawn path raises `session-attached` and the hub
re-snapshots that topic for everyone watching — which is what lets the client
subscribe unconditionally, instead of the old 409-refusal dance.

**Peer bridging moved from per-session sockets to the topic.** An instance that
does not own a session relays the owner's frames into the same topic, publishing
the owner's own snapshot as the baseline (the local resolver cannot produce one —
no child here).

## Phase 3 notes

**The session-data topics ride one naming scheme.** `session:<id>:<suffix>` is
resolved by suffix, so a data family is a row in a table rather than another
branch, and `session:<id>` itself stays the agent frame stream.

**`invalidateModelsCaches` is the one place the `models` signal is raised.** All
~8 provider mutations already call it, and each one means "the catalog changed";
raising the signal at the call sites would leave a caller that forgot it serving
a stale picker until the cache TTL expired.

**Global payloads are republished, not streamed.** `usage`, `schedule`, `panels`,
`models` and `updates` are produced on demand, so a write reports itself by
re-snapshotting the topic (`publishTopic`) rather than by streaming every
intermediate state.

**`publishTopic` must resolve through the HUB's descriptor table, never the
registry module's own.** The first version looked the topic up in this module's
`EXACT_TOPICS`, which holds only the exact-name topics — so a scoped name
(`git:`/`fs:`/`repos:`/`wiki:`) resolved to `null` and every subscriber's panel
was BLANKED by a `delta null` instead of re-read, while the resolver that should
have run never did. `getRealtimeHub().resolve(topic)` is the one path: it is the
table the hub was actually registered with, so a test's own topic set is
honoured too (the module-local lookup ran the production resolver in tests,
which is how the bug surfaced). `topics.server.test.ts` pins both halves.

**A background walk is reported by a signal, not a poll.** `startRepoScan` is
kicked off BY a read (the `repos:` topic's own resolver), so nothing writes it;
its completion is the only moment the list becomes final. `repos-scanned` (with
the root) lets the topic re-snapshot, which is what let the client delete its
1.5s retry timer. Verified against a live server: `reposPending:true` in the
snapshot, then a `delta` with the settled list.

**The wiki topic is the read path; only a forced refresh goes over HTTP.** The
resolver reads the cached mirror, so "go to the network" (the panel's own
Refresh) is the one thing it cannot express — that request re-fetches the mirror
over HTTP and then re-snapshots the topic, so both paths converge on one payload.

**A session's DATA topics needed a publisher, and the first cut had none.**
`session:<id>:todos/:plan/:telemetry/:queue` were registered with resolvers and
then never republished by anything — the panels rendered their subscribe-time
snapshot and stayed there, so a `todo` call that landed mid-run was invisible
until a reload (verified against a live server: a real run wrote two snapshots
into the transcript, `probe-task` in_progress → completed, and the subscribed
topics received ZERO deltas). They now ride `session-data-dirty`, raised at a
turn boundary and by every queue write, and the republisher walks the SUBSCRIBED
set rather than the four known names — the `todos` resolver parses a whole
transcript (7.2 MB on a real session), so resolving it for a tab that never
opened the panel is the polling this design removed. Verified after the fix: one
queue write produced three deltas (`queue`, `todos`, `telemetry`), and a live
run moved the Todo panel from `probe-task` to `live-probe` with no reload.

**The `updates` topic was removed rather than wired.** It had a resolver, a
documented row and no subscriber and no publisher: the update popup is a
request/response surface (`useUpdates` checks once on mount and applies over
SSE), so nothing ever wanted a push. `invalidate` went with it — the frame kind
was specified for "payloads too large to ship", and the two topics that would
have used it are republished as an ordinary snapshot on demand.

## Phase 4 notes

**Server-origin events became signals; UI-local ones stayed window events.**
`sidebar-structure` is now raised by every folder/session write (create, delete,
pin, toggle, settings, archive, rename), so the sidebar and the Projects pane
follow the `sidebar` topic instead of a window event each caller had to remember
to dispatch. The ten navigation events (`open-file`, `open-settings`,
`view-subagent`, `btw`, `theme-changed`, …) are untouched: they never cross the
network and must stay instant.

**The remaining client coordination rides one module bus**
(`@/client/lib/signals`): `stream-pending`, `session-title-hint`,
`session-renamed` and `kabmo-mode`. They are scoped to a session and consumed
by a known handful of hooks, so advertising them to the whole page only made it
harder to find who listened. The subagent frames got the same treatment
(`@/client/lib/chat/omp/subagent-frames`) — those are the SECOND hop, after the
`session:<id>` topic already carried them over the wire.

**The hub's contracts moved to `hub.types.ts`.** Adding `resolve` pushed
`hub.server.ts` past the 350-line ceiling; the interfaces are the half two other
modules (the WS route, the topic registry) import without the implementation.

## Verified groundwork

- A WS upgrade **does** run the root `onBeforeHandle` (`authGate`) when the route
  is composed under the instance owning that hook — measured: parent gate +
  `use(sub)` rejects the upgrade, no gate accepts it. `src/server/index.ts:88-105`
  is exactly that shape.
- `attachObserverStream` / `createObserverState` (`lib/observer-ws.ts`) already own
  the coalescer, the 30s keepalive and an idempotent teardown. Per-connection
  state **must** live on `ws.data`: Elysia hands `pong` the raw socket and a fresh
  wrapper to every other callback, so a `WeakMap` keyed by the `ws` object always
  misses.
- `connectSocket` (`shared/lib/chat/omp/socket.ts:30`) already implements capped
  backoff, with a refused first dial treated as terminal.
- `isSameOriginUpgrade` is applied by the terminal and dictation routes only;
  `agent/ws.ts` and `btw/ws.ts` lack it. The unified route applies it.
- `invalidateOmpSidebarData` has exactly one caller (`delete.server.ts:129`), so
  the sidebar's write-side invalidation points are few.
