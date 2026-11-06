# Multi-harness UI design — ACP-first (omp keeps RPC)

Design, 2026-11-05. Companion to `docs/multi-harness-research.md` (which holds
the measurements). This document decides **one transport per harness** and
designs every surface around that decision.

## 0. The decision, restated

| Harness | Transport | Why |
|---|---|---|
| **omp** | RPC `--mode rpc-ui` (unchanged) | only path with todos, subagents, host tools, stats, compaction |
| **omp (ACP)** | **its own tab** `omp acp` | second entry for the same agent: proves the adapter, and lets a user pick the slimmer surface |
| everything else | **ACP only** | measured: every one of them ships it |

No REST. No SDK. No native app-server. One adapter family, seven launch lines:

```
omp                → omp acp              (0.08 s init)
claude             → claude-agent-acp     (0.22 s)   5 selectors
codex              → codex-acp            (0.31 s)   needs CODEX_PATH or login
opencode           → opencode acp         (2.29 s)   102 models
deepseek-harness   → dsh --profile acp    (1.51 s)   no loadSession
antigravity        → agy acp              (replaced the retired gemini CLI)
command-code       → cmd acp              (0.77 s, 96 models)
minimax            → mcode acp            (1.28 s)   login required
pi                 → pi-acp               (0.14 s)   needs `pi` on PATH
```

## 1. What each harness actually reports (measured, drives every surface)

| | omp ACP | claude-acp | opencode | dsh | gemini | minimax | pi-acp | codex-acp |
|---|---|---|---|---|---|---|---|---|
| `loadSession` | ✓ | ✓ | ✓ | **✗** | ✓ | ✓ | ✓ | ✓ |
| `session/list` | ✓ | ✓ | ✓ | ✓ | **✗ -32601** | ✓ | ✓ | ✓ |
| `list` title | ✗ | **✓** | **✓** | ✗ | — | — | — | — |
| `list` extra | `messageCount`, `size` | — | — | — | — | — | — | — |
| `fork` / `delete` | fork | fork+delete | fork | ✗ | — | fork | delete | fork+delete |
| `configOptions` | mode 2 · model 221 · thinking 5 | mode 5 · model 5 · effort 6 · fast 2 · ultracode 2 | model 102 · mode 3 | model 1 · effort 4 | after auth | after auth | after auth | after auth |
| `usage_update` | **✓** size/used/cost | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `plan` update | **✗** (spec has it) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `agent_thought_chunk` | ✓ (50–86/turn) | ✓ | ✓ | ✗ | — | — | — | ✓ |
| `available_commands` | 64 | ✓ | ✓ | — | — | — | — | ✓ |
| push without asking | `session_info_update` | `_auth/status_update` | — | `session.event` fanout | — | — | — | — |

Three consequences that shape the whole UI:

1. **`usage_update` is omp-only.** Context/usage panels must have a real
   "not reported" state per harness, not an estimate dressed as a measurement.
2. **`plan` is never emitted by any agent measured**, including omp in plan
   mode. The plan/todo panel is a capability, not an assumption.
3. **`session/list` is not free and not uniform.** Spawning 7 agents to build a
   sidebar costs 6+ seconds and 7 processes. The sidebar therefore reads a
   Kabmo-owned index, and ACP `session/list` is an explicit import action.

---

## 2. Sidebar

**The rule: one list, harness is an icon before the NAME, never a second tree.**

Sessions from different harnesses belong to the same workspace folder and the
same user intent; splitting them into per-harness trees makes "where was that
chat?" a two-level lookup. The mark is a single glyph, colourless (chroma is
reserved for `--theme-error`), differentiated by SHAPE.

**Implemented.** `src/shared/lib/harness/catalog.ts` is the id → {label,
initial, transport, glyph} table; `src/client/components/common/harness-glyph/`
draws it; all three rows (`SessionItem`, `common/session-row`, the phone's
`MobileSessionRow`) render it from one `harness` prop, and the server fills
`SessionItemData.harness` for real-mode rows. Verified in a running Kabmo:
236/236 real rows carried `harness: omp-rpc`, the mark rendered at x=40 with the
title at x=56 (classic) and both sidebar styles drew it.

The glyph sits INSIDE the title line, not in the leading 16px slot: that slot
already owns one glyph (run cue / roster chevron) and a second one there would
shift every title sideways the moment a row gains a harness. A row with no
`harness` renders nothing, so pre-harness and MOCK rows keep their old
alignment.

```
┌──────────────────────────────────────┐
│  kabmo-labs/kabmo                 ⌄  │   ← workspace
│  ┌────────────────────────────────┐  │
│  │ ⌕ search sessions…             │  │   ← filters title + harness name
│  └────────────────────────────────┘  │
│                                      │
│  ▸ omp                  ● 2 running  │   ← harness FILTER chips (off by
│    claude               ○ idle       │      default = all), not a tree
│    codex                ⚠ sign in    │
│    ⋯ 8 harnesses                     │
│                                      │
│  ── Today ────────────────────────   │
│  ● Fix the auth guard          o     │   ← o  = omp RPC   (existing glyph)
│    kabmo-labs/kabmo · 2m · ⚡        │
│  ● Sidebar redesign            A     │   ← A  = claude
│    kabmo-labs/kabmo · 14m            │
│  ○ Rename issueToken           o     │
│    kabmo-labs/kabmo · 1h             │
│  ○ Refactor the stream         C     │   ← C  = codex
│    kabmo-labs/kabmo · 1h · ⊘         │   ← ⊘ = this session cannot resume
│                                      │      (agent has no loadSession)
│  ── Yesterday ────────────────────   │
│  ○ Reproduce the flake         O     │   ← O  = opencode
│    kabmo-labs/kabmo · 1d             │
│                                      │
│  ⚠ gemini · not signed in            │   ← one row per UNUSABLE harness,
│    signature: 3 conversations        │      never a hidden tab
│    [ how to sign in ]                │
│                                      │
│  ── Discover ─────────────────────   │
│  [ import sessions from harness… ]   │   ← explicit: runs session/list
└──────────────────────────────────────┘
```

### Why this shape

| Problem | Answer in this design |
|---|---|
| 7 `session/list` calls per load = 6 s + 7 processes | Sidebar reads `harness_sessions` (SQLite, written on spawn + `session_info_update`). Import is a **button**, one harness at a time, with a count preview. |
| omp ships `messageCount`+`size` but no title | Title column falls back to `Untitled`; first `user_message_chunk` from `session/load` replay fills it (measured: 4 frames for a whole turn). |
| dsh has no `loadSession` | Row renders normally but opens **read-only from Kabmo's own stored events**; a `⊘` marker says the agent cannot restore it. |
| `antigravity` replaced the retired `gemini` | One Google adapter, not two: Gemini CLI is deprecated in favour of Antigravity CLI. |
| codex/minimax/pi need auth | The sidebar shows the **harness row** with the reason + the exact command (`mcode login`, `qwen --auth-type=openai`, `pi` on PATH) — never a session row that fails on click. |
| Harness identity is invisible today | The glyph column. `o` RPC, `a` ACP (all adapters share one glyph shape family, letter differs), `⏻` for a session currently running on another instance. |

### Session row anatomy

```
│ ● Fix the auth guard            o   │
│   ├ ● = live run (server-tracked stream row, unchanged)
│   ├ title
│   ├ glyph column = harness, right-aligned, 1 cell
│   └ second line: workspace · age · markers (⚡ waiting, ⊘ unresumable, ⟳ forked)
```

Markers are the existing set plus two: `⊘` unresumable, `⟳` forked from another
session (ACP `fork` is advertised by 5 of 8 agents, so forks will exist).

---

## 3. Composer

**Harness = a tab inside the model dropdown, not a new control row.** The row
already carries model · thinking · access · plan/goal and has no room; and the
tab must change *what the list is*, which is exactly what a tab does.

```
┌─ COMPOSER ─────────────────────────────────────────────────────────┐
│                                                                    │
│  Ask anything…                                              [ ▣ ]  │
│                                                                    │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ omp    claude    codex    opencode    dsh    gemini    +2      │ │ ← tabs
│ ├────────────────────────────────────────────────────────────────┤ │
│ │ ⚠ claude · signed out — `claude` login in a terminal           │ │ ← banner
│ │   [ open terminal ]            [ use omp for this chat ]       │ │   (if any)
│ ├────────────────────────────────────────────────────────────────┤ │
│ │ + Add new provider                                     ⌄ close │ │
│ │ ⌕ Search models                                                │ │
│ ├────────────────────────────────────────────────────────────────┤ │
│ │ ★ RECENT                                                       │ │
│ │   claude-fable-5            anthropic   1M ctx · 384K out  ◐   │ │
│ │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │ │
│ │ A ANTHROPIC                                            (5)     │ │ │
│ │   default                   ← ACP default       —          ◐   │ │
│ │   opus                      Opus 5            200K ctx     ◐   │ │
│ │   sonnet                    Sonnet 5.5        200K ctx     ◐   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  [o · omp  ▾]  [◐ high ▾]  [⚙ auto ▾]  [◇ Plan] [◎ Goal]   [ ➤ ]  │ ← toolbar
└────────────────────────────────────────────────────────────────────┘
```

### The tab decides the MODEL LIST (implemented)

Every harness publishes its own catalog and they are not interchangeable, so
the active tab is the source of truth for what the list contains:

| Tab | Source | Measured size |
|---|---|---|
| `omp` (RPC) | Kabmo's `/api/models` — omp's registry, with favorites, recents and provider plates | 221 |
| `omp (ACP)` | that agent's own `configOptions[model]` | 221 |
| `claude` | `claude-agent-acp` aliases | **5** (`default`, `opus`, `claude-fable-5[1m]`, `sonnet`, `haiku`) |
| `opencode` | its `session/new` config options | 102 |
| `opencode2` | its `session/new` config options (the 2.x binary) | **96** (6 thought levels, 4 modes) |
| `command-code` | its `session/new` config options (`cmd acp`) | **96** (4 thought levels) |
| `antigravity` | its `session/new` config options (`agy acp`) | replaces the retired `gemini` |
| `dsh` | one `provider/model` pair | 1 |

`harness-models.ts` owns the mapping: omp's list is returned **untouched** (its
rows carry the user's favorites and the provider plates), and any other harness
**replaces** it — never a merge, because a row the active agent cannot run would
fail at the first prompt. An unprobed harness reports `unprobed` and the panel
says so; it never shows omp's list as a stand-in.

Verified in a running Kabmo: the `omp` tab drew 221 rows, `omp (ACP)` 221 with
`data-harness="omp-acp"`, and `claude` **5 rows** — only that agent's aliases.

### Two icons per row: harness first, then provider

```
  ⋮⋮  ◎  k.  Agnes-2-5-Flash - Free        512K  [off]  ☆
      ↑   ↑
      │   └ provider plate (brand mark or initials)
      └ harness glyph — the OUTER choice
```

**The marks are the agents' own brand art** (`harness-glyph/brands.ts`), not
lucide shapes: `@lobehub/icons-static-svg` (MIT) for claude-code, codex,
gemini-cli, opencode, deepseek, kimi, minimax, cursor, qwen, antigravity and pi,
plus omp's own `favicon.svg` with its gradient and dark plate stripped so it
paints in `currentColor` like the rest. Every mark keeps its own `viewBox`
(omp's logo is 64×64, the others 24×24), and a test asserts no source `<rect>`
or `linearGradient` survives — a full-colour plate per row would be the only
chroma in the densest list in the app.

The harness mark comes first because it is the outer choice: the tab above has
already narrowed the list to it, and a provider plate with no agent mark would
read as "this model, from this provider, on nothing". ACP rows claim no context
window or price (the agent publishes neither, so `—` is drawn), which is why the
columns stay aligned across harnesses.

### Tab states (each is a measured outcome, not a guess)

```
 omp        ready        spawned, 221 models, thinking ladder
 claude     signed-out   session/new → -32000; banner names the command
 codex      needs-path   codex-acp reports APP-SERVER EXIT (CODEX_PATH)
 opencode   ready        102 models, but 2.3 s init → tab shows a spinner
 dsh        ready        model list has exactly 1 entry; no fork
 gemini     no-history   session/list → -32601; only live sessions listed
 minimax    login        -32000 "Run mcode login"
 pi         missing-bin  session/new → "executable not found (command: pi)"
```

Tab affordance rules:

- **The active tab is the session's harness and is read-only for a live chat.**
  Switching harness on a session with messages opens: "Start a new chat with
  `<harness>`? This session stays on `omp`." — because harness is a spawn
  property (the frame source cannot change under a running transcript).
- A tab is **disabled** (not hidden) when the harness cannot run here. Hidden
  tabs made omp's own "why is Claude not there" unanswerable.
- **Model list, thinking list and mode list all come from
  `configOptions`**: `category:model` → the model section; `category:thought_level`
  → the ◐ pill; `category:mode` → the ⚙ pill; `category:model_config` (claude's
  `fast`, `ultracode`) → extra rows inside the dropdown footer, because they are
  per-model knobs, not session config.
- **`+ Add new provider` is omp-only.** It writes `models.yml`; an ACP agent's
  models come from the agent itself.

### Placement: full screen on a phone, popover on a desktop (implemented)

`fullscreen-picker.ts` decides, and a portalled `Fullscreen.tsx` renders the same
card at `100dvh`. The shell's `isMobile` wins when supplied; otherwise
`(pointer: coarse)`, then width. The 86dvh sheet that came first measured ~7
visible model rows on a 390x844 phone against ~18 full screen, with 344px of dead
canvas above it. A phone also drops the keyboard-hint footer, which it has no
keyboard to follow.

The popover's click-outside guard is **disabled** in that placement: a portalled
overlay is outside the picker's root by construction, so an armed listener closed
the picker on the `mousedown` meant for a row.

### Popover size: measured, never a constant (implemented)

```
width  = clamp(240, min(containerRight, viewportWidth) - anchorLeft - 8, 512)
height = clamp(0, spaceAbove(trigger) - 48, 460)   // 48 = titlebar + 8px of air
```

`anchorLeft` is the TRIGGER's left edge — the card is positioned there and grows
rightward — and `containerRight` is the composer card's right edge
(`[data-composer-style]`). Both previous budgets were wrong in opposite
directions: the trigger's width gave a 275px card for a 259px chip inside a 712px
composer, and the panel's WIDTH gave a 437px card that hung 29px past a 421px
composer, because the card starts 13px inside the panel.

Desktop caps are 512 x 460. 384 cut the model name; 620 stood ~14 rows tall and
read as a panel over the conversation instead of a menu beside it.

`popover-metrics.ts` owns the arithmetic so it can be asserted without a layout
engine. Both halves were constants and both failed in a real browser, each in a
different way:

| Constant | Failure, measured |
|---|---|
| `w-84 sm:w-96` (336/384px) | a 384px card in a 320px chat panel hung 64px past the composer's edge; on a 390px phone it was wider than the screen |
| `max-h-[460px]` | at 1024×620 the card started at y=22 and `elementFromPoint` on the first harness tab answered `HEADER` — the tab was in the DOM and unreachable |
| a hard `MIN_HEIGHT = 180` | with 52px of room it pushed the top edge under the chrome anyway; the floor is a PREFERENCE that yields to the viewport |

Re-measured, not measured once: a window resize alone missed the two events that
actually move the trigger — the composer GROWING as the user types (which lifts
it) and a phone's visual viewport shrinking under the keyboard. The panel listens
to `resize`, `visualViewport` resize/scroll, and a `ResizeObserver` on the
trigger's own box.

Verified live: 1440×900 → 292×460 with the composer 712px; 1024×620 → 240×350
starting at y=38 (titlebar ends at 40, first tab at 43); 390×844 → 240×336, both
inside the viewport and inside the composer.

### Where the tab strip lives in code

`ModelDropdown` (`model-dropdown/index.tsx`) already owns open/search/focus/
hover state and passes a flat `models` list into `buildPickerGroups`. The tab
becomes an input to that list, not a new component:

```
index.tsx        + const [harness, setHarness] = useState<HarnessId>(sessionHarness)
                 + models = useModelCatalog(harness)          // per-harness fetch
Panel.tsx        + <HarnessTabs … />                           // above <Header/>
Header.tsx         unchanged
groups.ts          unchanged (it groups whatever list it is given)
```

One state rule: **`harness` is seeded from the session and becomes editable
only on a chat with no messages.** Editing it on a live chat opens the
"start a new chat" confirm described above; the picker never switches the frame
source under a running transcript.

### Toolbar mapping per harness

```
  [o · omp ▾]   [◐ high ▾]   [⚙ auto ▾]   [◇ Plan] [◎ Goal]   [➤ send]
     │             │             │            │        │
     │             │             │            │        └ omp RPC only (Kabmo extension)
     │             │             │            └ omp: /kabmo-mode · ACP: configOptions[mode]
     │             │             └ ACP category:thought_level, or hidden when absent (dsh: 4 opts)
     │             └ ACP category:model; falls back to Kabmo's persisted pick
     └ harness glyph, same as the sidebar
```

**Steering / queue controls** are separate from send, as today, but gated:

| Harness | `Send now` behaviour |
|---|---|
| omp RPC | `steer` (works) |
| omp ACP | `_session/steering` → `{outcome:"injected", queue:"steering"}` |
| codex | its own `_session/steering` extension |
| claude | `promptQueueing` → queue only (no steer) |
| everything else | **control disabled with a tooltip**: "this harness cannot take a message mid-turn" |

Never fall back to a second `session/prompt` — measured to **cancel** the
running turn.

### Mid-run picks

The existing `deferred-model.ts` rule stays and becomes transport-independent:
a pick made while streaming is stashed and applied before the next prompt.
Measured: an ACP `set_config_option model` mid-turn is accepted in 0.02 s and
the turn re-targets — same hazard as RPC.

---

## 4. Settings

The page has its own sidebar group, **HARNESSES**, not a member of OMP: omp's
group is one engine's config, this one holds other agents entirely. The groups
live in `SETTINGS_SECTIONS` (`src/shared/lib/settings/sections.ts`) — one list for
the type and the render loop, because two copies let a group render nothing with
no error.

```
┌─ SETTINGS › Harnesses ──────────────────────────────────────────────┐
│                                                                     │
│  ┌─ list ──────────┐ ┌─ omp (ACP) ───────────────────────────────┐  │
│  │ ● omp      RPC  │ │ Binary    [ /Users/raj/.bun/bin/omp    ] 📁 │  │
│  │ ● omp      ACP  │ │ Launch    omp acp                          │  │
│  │ ○ claude   ACP  │ │ Status    ● ready · 18.16.0                │  │
│  │ ⚠ codex    ACP  │ │                                          │  │
│  │ ● opencode ACP  │ │ ── Capabilities (from initialize) ────────  │  │
│  │ ⚠ gemini   ACP  │ │ loadSession        ✓                      │  │
│  │ ⚠ minimax  ACP  │ │ session/list       ✓   fork ✓  resume ✓    │  │
│  │ ○ pi       ACP  │ │ delete             ✗   close ✓             │  │
│  │ + Add harness   │ │ configOptions      mode · model 221 · think│  │
│  │                 │ │ usage_update       ✓                      │  │
│  │                 │ │ plan update        ✗                      │  │
│  │                 │ │ steer              ✓ _session/steering    │  │
│  │                 │ │                                          │  │
│  │                 │ │ ── Defaults for new chats ───────────────  │  │
│  │                 │ │ Model     [ kenari-jatis/deepseek-v4-1 ]   │  │
│  │                 │ │ Thinking  [ high ▾ ]                      │  │
│  │                 │ │ Mode      [ default ▾ ]                   │  │
│  │                 │ │ Access    [ auto ▾ ]                      │  │
│  │                 │ │                                          │  │
│  │                 │ │ ── Sessions ─────────────────────────────  │  │
│  │                 │ │ 12 known · [ discover from agent ]        │  │
│  │                 │ │ [ re-check status ]                       │  │
│  └─────────────────┘ └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

Design points:

- **`Capabilities` is rendered from the live `initialize` result**, not a
  hardcoded table. The matrix in §1 is the expected output of this pane; a
  version bump that adds `fork` shows up here without a code change.
- **One "Reload engine" action per harness** (the existing
  `useReloadOmpEngine` pattern generalised): dispose standby processes so the
  next command boots the binary currently installed.
- **`Add harness`** offers the 44 ACP registry agents, pre-filled with their
  registry launch command (`npx`, `uvx`, or a binary download). Each row shows
  the distribution kind, because `npx` agents need Node and binaries do not.
- **Auth is a first-class button** that runs the agent's own flow:
  `pi_terminal_login` / `mcode login` / `qwen --auth-type=openai` / codex's
  `authMethods[]` / claude's terminal prompt. Kabmo already has a PTY, so the
  terminal auth method can be hosted in the terminal panel instead of telling
  the user to open iTerm.
- **Existing omp settings pages stay untouched.** `Providers`, `Models`,
  `Agent`, `Behavior` are omp-specific and stay omp-specific; the harness page
  is additive and per-harness.

---

## 5. Chat timeline — the hard surface

The timeline is one fold (`foldAgentEvent`) fed by `AgentEvent`. The design keeps
that: an **ACP mapper** converts `session/update` into the same `AgentEvent`
vocabulary. Nothing in the timeline learns about ACP.

### 5.1 Frame mapping (the whole adapter contract)

```
ACP sessionUpdate            →  Kabmo AgentEvent
─────────────────────────────────────────────────────────────────────────
agent_message_chunk          →  message_update {assistantMessageEvent:{type:
  {content:{type:text},         text_delta, delta}, messageId}
  messageId}
agent_thought_chunk          →  message_update {…{type:thinking_delta}}
tool_call                    →  tool_execution_start {toolCallId, toolName:name,
                                 kind, args:rawInput, locations}
tool_call_update             →  tool_execution_update | tool_execution_end
                                 (status pending→start, in_progress→update,
                                  completed|failed→end)
plan                         →  todo_updated (if an agent ever sends it)
usage_update                 →  usage_updated {size, used, cost}
available_commands_update    →  available_commands_update
session_info_update          →  session_info_update {title, updatedAt}
current_mode_update          →  mode_changed
config_option_update         →  config_changed
session/prompt response      →  agent_end {isTerminal:true, stopReason}
session/request_permission   →  extension_ui_request (approval dialog)
fs/read_text_file            →  (client-side answer, no frame)
terminal/*                   →  (client-side bridge, no frame)
```

Two mapping facts that decide the renderer:

- **`kind` must land in `ToolCallData.type`; `name` stays `name`.** Kabmo's
  `resolveToolKey` (`tool-renderers/index.tsx`) resolves, in order: a `proc://`
  or `xd://` target, `details.xdev.tool`, then `tool.name`, then the title's
  first word, then `tool.type`. So an ACP card renders correctly iff the mapper
  writes `kind` → `type` (`read|edit|delete|move|search|execute|think|fetch|
  switch_mode|other` → `ToolType`) and keeps the agent's `name` for the glyph
  and the header. Measured `read` → `kind:"read"`, `rawInput:{path}`,
  `locations:[{path}]`; measured `write` → `kind:"edit"`. That is why a
  non-omp agent's `view_file` still draws a read card.

  `ToolType` (`src/shared/types/chat.ts`) is an omp vocabulary, so the mapper
  owns an explicit translation. Only `read` and `edit` have an exact member;
  `execute`, `search`, `think`, `delete`, `move`, `fetch`, `switch_mode` and
  `other` all have to be mapped onto one:

  | ACP `kind` | `ToolCallData.type` |
  |---|---|
  | `read` | `read` |
  | `edit` | `edit` (or `write` when the call is a whole-file create) |
  | `search` | `grep` |
  | `execute` | `bash` (the card body is `rawInput.command`) |
  | `delete`, `move` | **`edit`**, with `rawInput.path` as the target and a destructive marker in `details` — the union has no destructive type, and inventing one changes every renderer's exhaustive switch |
  | `fetch` | `web_search` (body = URL + status) |
  | `think` | `read`-shaped but rendered collapsed; `details.collapsed = true` |
  | `switch_mode` | `todo` (it is a session-mode change; the plan/todo card is the right surface) |
  | `other` | the agent's `name` when it is a known `ToolType`, else `read` with the raw JSON body |

- **`tool_call_update` is a PATCH, not a snapshot** (opposite of omp RPC's
  `tool_execution_update`). The mapper must merge, never replace — a
  `status:completed` update carries no `content`, so a naive replace blanks the
  card at the exact moment it finishes.

### 5.2 A turn, rendered

```
┌─ CHAT TIMELINE ─────────────────────────────────────────────────────┐
│                                                                     │
│  ┌ you ──────────────────────────────────────────────────────────┐  │
│  │ Rename issueToken to mintToken and update every caller.       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ▸ Thinking · 3.2 s · 86 chunks                        [ ⌄ ]       │
│                                                                     │
│  ╭─ read ────────────────────────────────────────────── 41 ms ─╮    │
│  │ src/auth/token.ts                                    12→34  │    │
│  │  1 │ export function issueToken(user: User) {               │    │
│  │  2 │   return sign({ sub: user.id }, SECRET);               │    │
│  ╰──────────────────────────── ⤢ open · ⧉ copy path ──────────╯    │
│                                                                     │
│  ╭─ edit ────────────────────────────────────────────── 118 ms ─╮   │
│  │ src/auth/token.ts                                            │   │
│  │  - export function issueToken(user: User) {                  │   │
│  │  + export function mintToken(user: User) {                   │   │
│  │  @@ src/auth/session.ts @@                                   │   │
│  │  - import { issueToken } from './token';                     │   │
│  │  + import { mintToken } from './token';                      │   │
│  ╰──────────────────────────── ⤢ open diff · ↺ revert ─────────╯   │
│                                                                     │
│  ╭─ search ──────────────────────────────────────────── 22 ms ─╮    │
│  │ issueToken — 4 hits                                          │    │
│  │  src/auth/session.ts:12   src/api/login.ts:8  …              │    │
│  ╰──────────────────────────────────────────────────────────────╯   │
│                                                                     │
│  Renamed `issueToken` → `mintToken` in 4 files. Tests pass.        │
│  ─────────────────────────────────────────────────────────────     │
│  claude · claude-fable-5 · 12.4 s · 8.1K in / 412 out · $0.014     │
│  ◐ high                                              [ ↻ retry ]   │
└─────────────────────────────────────────────────────────────────────┘
```

Card chrome is unchanged from today — the design work is choosing the glyph,
title, target and body per `kind`:

| `kind` | Card title | Target line | Body | Right rail |
|---|---|---|---|---|
| `read` | the tool's `title` (`Reading hello.txt`) | `locations[0].path` | first N lines of `rawOutput.content[].text` | line count |
| `edit` | `title` | every `locations[].path` | `content[]` **diff block** when present, else `rawInput.content` as `+` lines | `+n −m` |
| `delete` / `move` | `title` | `rawInput.path` / `from→to` | — | destructive tint |
| `search` | `title` | pattern | hit list from `rawOutput` | hit count |
| `execute` | `title` (the command) | `$ cmd` in mono | `rawOutput` streamed by `outputDelta` | exit code |
| `fetch` | URL host | URL | response head | status |
| `think` | "Thinking" | — | collapsed | duration |
| `switch_mode` | `Plan mode` | — | — | — |
| `other` | `name` or `title` | `rawInput` (JSON, one line) | `rawOutput` JSON | — |

The `switch_mode` kind is worth calling out: ACP can tell Kabmo "the agent just
changed its own mode", which omp RPC cannot. Where a harness emits it, the
`◐`/`⚙` pills in the composer update from the transcript, not from a local
guess.

### 5.3 The three timeline behaviours that need explicit design

**1. Message boundaries.** ACP streams `agent_message_chunk` with a
`messageId`, and **no `message_end`**. The mapper closes a row when
`messageId` changes or `session/prompt` resolves. Measured: 6 chunks for a
5-word answer, 168 chunks for a long one — so chunk-level "new message"
detection without `messageId` would split one answer into 168 rows.

**2. Reattach.** Today `session:<id>` snapshot + `pendingUiRequests` replay
restores a reloaded tab. For ACP:
- omp/claude/opencode/minimax/pi/codex: `session/load` replays history as
  `user_message_chunk` / `agent_message_chunk` / `tool_call` / `tool_call_update`
  (measured: 4 frames for a full turn, answered in 8 ms). The mapper turns
  replay into rows **without** live styling.
- **dsh has no `loadSession`**: Kabmo replays from its own stored event log.
  This is the one harness where Kabmo must persist frames, so the persistence
  layer is not optional — see §8.

**3. Approvals.** `session/request_permission` carries the full `toolCall`
(`title`, `kind`, `rawInput.command`) plus `options[]` with
`allow_once|allow_always|reject_once|reject_always`. Kabmo's existing approval
dialog renders that directly. Two measured traps: `reject_once` is **not
sticky** (the agent re-asked for the same `rm`), and a rejected request must
resolve with `{outcome:"cancelled"}` if the turn was cancelled, or the agent
hangs.

### 5.4 What degrades, and is said out loud

```
┌─ unsupported on this harness ──────────────────────────────────────┐
│  ⓘ  The subagent and todo views are not available for claude.      │
│     omp reports them; this agent does not.                         │
└────────────────────────────────────────────────────────────────────┘
```

A single, dismissible strip at the top of the timeline when the session's
harness lacks something the layout would otherwise show. Never an empty panel
that looks broken.

---

## 6. Context panel

Today: `/api/telemetry/context` reads omp's transcript + usage index.

```
┌─ CONTEXT ──────────────────────────────────────────────────────────┐
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │   CONTEXT WINDOW                                             │  │
│   │   ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░   8.8K / 1M   0.9%  │  │
│   │   omp · kenari-jatis/deepseek-v4-1-flash                     │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│   ┌─ DISTRIBUTION ─────────┐  ┌─ SESSION ───────────────────────┐   │
│   │ user      1.2K   13.6% │  │ messages          12            │   │
│   │ assistant 3.4K   38.6% │  │ user / assistant  5 / 7         │   │
│   │ tools     4.2K   47.8% │  │ cost              $0.0142       │   │
│   └────────────────────────┘  └─────────────────────────────────┘   │
│                                                                     │
│   ┌─ LAST MESSAGE ─────────────────────────────────────────────┐    │
│   │ in 8 503   out 2   cache read 256   hit 1.0%               │    │
│   └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│   ▸ raw messages (12)                            [ refresh ]        │
└─────────────────────────────────────────────────────────────────────┘
```

For ACP sessions the layout is identical, but the **source** changes:

| Field | omp RPC | ACP with `usage_update` (omp) | ACP without it (all others) |
|---|---|---|---|
| used / size | transcript + stats | `usage_update {used, size}` | **"not reported"** |
| cost | usage index | `usage_update.cost` | **"not reported"** |
| distribution | transcript block sizes | transcript block sizes (Kabmo counts frames) | transcript block sizes |
| messages / counts | `get_session_stats` | counted from frames | counted from frames |
| last-message tokens | message `usage` | — | — |

Design rule: **the card renders only what the harness reported.** When
`usage_update` is absent the window card is replaced by:

```
┌──────────────────────────────────────────────────────────────────┐
│  CONTEXT WINDOW                                                  │
│  Not reported by claude.                                         │
│  Kabmo can still count the messages it streamed (12).            │
└──────────────────────────────────────────────────────────────────┘
```

Not a greyed-out bar, not an estimate — an estimate would be the
"substituted failure" the repo rules forbid, and it would sit next to omp's real
number and look identical.

---

## 7. Todo panel and Plan panel

Both read the session's own record; both must tolerate a harness that reports
nothing.

```
TODO (omp RPC)                     TODO (claude / opencode / dsh …)
┌───────────────────────────────┐  ┌───────────────────────────────┐
│ Renaming the token            │  │  ◇                           │
│ ████░░░░░░░░░░░  2/5          │  │  No todo list for this        │
│                               │  │  session.                     │
│ ● Phase 1 — Investigate       │  │                               │
│   ✓ Find every caller         │  │  omp reports todos through    │
│   ✓ Read the signing module   │  │  its own tool; this harness   │
│ ◐ Phase 2 — Rewrite           │  │  does not expose one.         │
│   ◐ Rewrite issueToken        │  │                               │
│   ○ Update session.ts         │  │  [ open the plan panel ]      │
│   ○ Run the focused tests     │  │                               │
└───────────────────────────────┘  └───────────────────────────────┘
```

Plan panel: ACP defines a `plan` update (`entries[]` with
`content/priority/status`, full list every time). **Measured: no agent emitted
one**, including omp in plan mode. So:

1. The panel subscribes to `plan` frames.
2. When non-empty → render with the existing `todo-panel/PhaseGroup` primitives
   (plan entries are flat, so a single phase group with `priority` as the
   ordering).
3. When empty AND the harness never sent one → the empty state above, with the
   harness named. `Plan` as a **mode** still works everywhere it exists
   (`configOptions[mode]` → `plan` measured on omp, claude has `plan` among its
   5 modes); it is the *plan document* that is not universally reported.

The distinction matters: mode is a control Kabmo can set; the plan text is data
only some agents produce.

---

## 8. Usage panel

```
┌─ USAGE ────────────────────────────────────────────────────────────┐
│  provider [ kenari ▾ ]                                             │
│                                                                    │
│  ┌─ QUOTA ──────────────────────────────────────────────────────┐  │
│  │ 5-hour window    ████████░░░░░░░░  41%   resets in 2h 14m    │  │
│  │ weekly           ███░░░░░░░░░░░░░  18%   resets Mon 00:00    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ THIS SESSION ───────────────────────────────────────────────┐  │
│  │ $0.0142 across 8 turns     input 61K · output 3.1K           │  │
│  │ from usage_update (omp)                                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ NOT AVAILABLE FOR THIS SESSION ─────────────────────────────┐  │
│  │ claude does not report token usage or cost over ACP.         │  │
│  │ Provider quota still applies to your claude.ai account, but  │  │
│  │ Kabmo cannot read it from this agent.                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

Three distinct sources, and the panel says which one it is showing:

| Section | omp RPC | omp ACP | other ACP |
|---|---|---|---|
| QUOTA (provider limits) | omp usage index (`/api/usage`) | same (provider-level, not session) | **not available** |
| THIS SESSION | `get_session_stats` + usage index | `usage_update` (measured `{size, used, cost}`) | **not available** |
| Cost breakdown popup | per-category from the index | **not available** (only a total) | — |

The "from `usage_update` (omp)" caption is deliberate: it is the difference
between a measured total and the index's per-category rollup, and a reader who
sees `$0.0142` in both places should know they are different objects.

---

## 9. Data model (what makes the sidebar and reattach possible)

```sql
-- one row per session Kabmo knows about, whichever harness runs it
CREATE TABLE IF NOT EXISTS harness_sessions (
  session_id     TEXT PRIMARY KEY,   -- "omp:<uuid>" | "claude:<uuid>" | …
  harness        TEXT NOT NULL,      -- 'omp-rpc' | 'omp-acp' | 'claude' | …
  native_id      TEXT NOT NULL,      -- the agent's own id, as it reports it
  cwd            TEXT NOT NULL,
  title          TEXT,               -- null until the agent tells us
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- what this agent can do, cached from initialize, so the UI never guesses
  can_load       INTEGER DEFAULT 0,
  can_fork       INTEGER DEFAULT 0,
  can_delete     INTEGER DEFAULT 0,
  can_list       INTEGER DEFAULT 0,
  has_usage      INTEGER DEFAULT 0,
  has_plan       INTEGER DEFAULT 0,
  steer_mode     TEXT,               -- 'steer' | 'follow-up' | null
  source         TEXT NOT NULL       -- 'kabmo' | 'imported'
);

-- only for harnesses without loadSession (dsh today): Kabmo replays from here
CREATE TABLE IF NOT EXISTS harness_events (
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  frame      TEXT NOT NULL,          -- the NORMALISED AgentEvent, not the ACP frame
  PRIMARY KEY (session_id, seq)
);

-- the existing per-session mode/model row gains a harness column
ALTER TABLE session_ui_state ADD COLUMN harness TEXT;  -- migration
```

Why normalised frames in `harness_events`, not raw ACP: the replay path then
feeds `foldAgentEvent` exactly like a live stream, so a resumed dsh session
cannot render differently from the live one. Storing raw ACP would need the
mapper to be replayed, and the mapper's merge rules are stateful.

**Title resolution order** (measured per agent):
`session_info_update` push → `session/list.title` (claude, opencode) →
first `user_message_chunk` on load/import → `Untitled · <harness>`.

---

## 10. Capability-gated layout (one table drives every hide/show)

```ts
// one place; every panel and control reads this and not its own guess
const UI = {
  composer: {
    tab:        () => true,
    modelList:  (c) => c.configModel > 0,
    thinking:   (c) => c.configThinking > 0,
    mode:       (c) => c.configMode > 0,
    planToggle: (c) => c.configModeValues.includes('plan'),
    goalToggle: (c) => c.harness === 'omp-rpc',        // Kabmo extension only
    steer:      (c) => c.steerMode === 'steer',
    queue:      (c) => c.steerMode === 'follow-up',
  },
  sidebar: {
    history:    (c) => c.canList,
    resume:     (c) => c.canLoad,
    fork:       (c) => c.canFork,
    delete:     (c) => c.canDelete,
  },
  panels: {
    context:    (c) => c.hasUsage,
    usage:      (c) => c.hasUsage,
    todo:       (c) => c.harness === 'omp-rpc',
    plan:       (c) => c.hasPlan,
    subagents:  (c) => c.harness === 'omp-rpc',
  },
};
```

A hidden control is wrong; a **disabled control with the reason** is right. The
matrix above decides which, and the reason string is always the harness's own
word for it (`loadSession` absent, `session/list` → `-32601`, `-32000
Authentication required`).

---

## 11. Build order (each step is shippable alone)

1. **`harness_sessions` + capability cache + the tab strip, omp RPC only.**
   Nothing changes behaviourally; the sidebar gains the glyph column and the
   settings gains the Harnesses page.
2. **omp ACP as a second tab.** Proves the mapper against a known agent:
   measured handshake 0.08 s, 221 models, `usage_update`, `_session/steering`.
3. **Generic ACP adapter + the permission bridge.** Unlocks claude (5
   selectors), opencode (102 models), gemini, minimax.
4. **`session/list` import + `session/load` reattach**, with the read-only
   fallback for dsh.
5. **`harness_events` persistence**, needed only by dsh but also the safety net
   for a crashed adapter.
6. **Native upgrades — none planned.** If a harness later outgrows ACP
   (steering that ACP cannot express, a capability Kabmo shows), it gets its own
   driver behind the same seam; the UI does not change.

## 12. Risks this design accepts

| Risk | Mitigation in the design |
|---|---|
| 8 spawned agent processes if a user opens the tab strip eagerly | tabs spawn **lazily**: `initialize` on first tab activation, cached per harness for the process lifetime, disposed by the same recovery action as `standby.server.ts` |
| Sidebar wrong for sessions created outside Kabmo | Discover is explicit and per-harness; imported rows are labelled `source: imported` |
| An agent's `kind` is `other` for everything (lazy adapters) | fall back to `name`, then to the `title` + raw JSON body; never hide the card |
| ACP spec drift (v2 draft is live in claude's adapter) | pin `protocolVersion: 1` at initialize; claude serves v2 only when asked |
| Auth strings leak as raw errors into the UI | every `-32000` is parsed into a harness row with its `authMethods[]`, never shown as a toast |
