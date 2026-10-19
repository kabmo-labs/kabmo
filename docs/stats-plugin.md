# Stats Kabmo — resource panel plugin

A right-panel view of the CPU and RAM the omp stack actually consumes — the
Kabmo server, every omp child it spawned, the omp daemon brokers and their
daemons, and the PTY shells.

**Shipped as a plugin**, not as a built-in view: `marketplace/plugins/stats`.
It installs from the bundled marketplace like any other panel plugin, is
switchable from the activity bar's right-click menu and from Settings → Panel
Plugins, and ships as two bundles (`dist/app.js` for the panel, `dist/server.js`
for the sampler).

Status: **complete and verified end to end.** The measurements below are from
this machine; the smoke run is described at the end.

## Why a plugin rather than a built-in view

The Kabmo's plugin platform exists for exactly this shape — a self-contained
view with its own server half — and this panel needs one: a browser cannot read
another process's RSS or CPU, so the measuring has to happen in the server's
process. That is `api.background.service` + `api.rpc` + `api.realtime`, all of
which the SDK already provides.

The alternative (a twelfth built-in view) would have moved core files, changed
the panel count stated in `AGENTS.md` and `BUILTIN-PANELS.md`, and given the
user no way to put it away. A plugin installs, can be disabled, and leaves
`src/` untouched.

## The two findings that decided the design

### F1 — The obvious probe reads the wrong struct

The Kabmo's own liveness probe (`src/server/lib/lifecycle/proc/`) answers
"alive? zombie? command line? parent? foreground group?" — subprocess-free, per
platform. It has no CPU and no RSS, because nothing had needed them, and the
call that carries them is a *different flavor of the same call* on macOS.

`proc_pidinfo(PROC_PIDTASKINFO)` (flavor 4), 96-byte reply, measured:

```
off  0  u64  pti_virtual_size      (506 451 165 184)
off  8  u64  pti_resident_size     ( 12 795 904)   <- RSS bytes
off 16  u64  pti_total_user        (    128 093)   <- mach ticks, NOT ns
off 24  u64  pti_total_system      (    129 290)
off 84  i32  pti_threadnum         (         23)
```

Two traps, both verified:

- **Those CPU fields are mach absolute-time ticks.** The conversion is
  `ticks * numer / denom` from `mach_timebase_info` — **125/3** on this
  Apple-silicon host. Read as nanoseconds they understate CPU by ~41x.
  Cross-checked against `ps`: a spin loop measured 1003.8 ms of CPU over
  1002 ms of wall, and `ps -o %cpu=` printed `100.0`.
- **`proc_pid_rusage` is a decoy.** It returns 0 and its first two u64s are also
  ticks, but its resident field reads **zero** for a 200 MB allocation on this
  host, while `pti_resident_size` matched `ps rss` and Bun's own
  `process.memoryUsage().rss` to within 0.3%.

Linux needs no new file: `/proc/<pid>/stat` (already read for liveness) carries
`utime`/`stime` at indices 11/12 of the tail, and `/proc/<pid>/status` carries
`VmRSS` and `Threads`. **`status`, not `statm`** — `statm` counts pages and the
page size is 4096 in a container against 16384 on an Apple-silicon host, while
`VmRSS` is already in kB. It also measured faster (0.47 ms against 0.58 ms per
sweep over 61 processes).

### F2 — A daemon broker can be parented OUTSIDE Kabmo

This is the finding the whole plugin exists for. Walking the ppid tree from the
Kabmo's pid is *almost* the answer, and the gap is a real resource.

```
broker 10466  parent = 7010 (an omp child of the server)   -> INSIDE the tree
broker 62457  parent = 1                                   -> OUTSIDE the tree
```

The mechanism is in omp's own source: `launch/client.ts` spawns the broker with
`{ detached: true }` and then `child.unref()`s it, so it survives the omp process
that started it and is reparented to `1`. Broker `62457` supervised
`~/.omp/run/daemons/1f1e40d033e7375e/` whose `scope.json` reads
`{"projectDir":"/Users/rajebdev/JatisMobile/kabmo"}` — **this project** —
and its subtree is a Chromium plus its helpers.

So the process set is the **union** of:

1. the ppid tree rooted at Kabmo's pid; and
2. the subtree under every daemon registry entry (broker and daemon alike),
   deduped by pid.

`detached: true` does **not** break the ppid link — verified for both the PTY
shell and the omp child; detaching changes the process *group*, which is what
the group-kill uses. Measured union on the live production instance:

| Set | Processes | RSS |
|---|---|---|
| ppid-tree from the server pid alone | 27–29 | 3.2–3.6 GB |
| broker `62457` (parent = `1`, so outside it) | 9 | 0.44–0.49 GB |
| union, deduped | 36–38 | 3.7–4.1 GB |

The orphan block is the entire difference between a tree walk and the truth.

### Cost

| Path | Processes | Time |
|---|---|---|
| `proc_listpids` + `proc_pidinfo` ×2 per pid | 590 | **0.75 ms** |
| Linux `/proc` sweep | 61 | **0.65 ms** |
| `ps -axo pid=,ppid=,rss=,%cpu=` (one spawn) | 547 | **10.0 ms** |
| `omp ps --json` (spawn + registry read) | — | **455 ms** |

`proc_listpids` answers in **bytes** (two calls: a size probe, then the read);
`proc_listchildpids` answers a **pid count**. Assuming the wrong one silently
reads a quarter of the table. `omp ps --json` is not used at all: the same facts
are three JSON files on disk (`scope.json`, `broker.pid`,
`daemons/*/meta.json`), read for free.

## Design decisions

**D1 — Sample in the server, on a loop that only runs while a panel is open.**
`api.background.service` owns the interval (re-read from `sampleMs` each tick, so
a settings change applies without a reload), and `watch`/`unwatch` RPC calls arm
and disarm it. Closing the panel stops the sampling; nothing walks the process
table in the background.

The loop is ended by `onDispose` through an `AbortController`, **not** by the
service's own `stop`, and that is deliberate: the host records a service's
`stop` in `LoadedPlugin.background` and, as of this writing, reads that handle
from nowhere — so a plugin's `stop` is never invoked and its schedules never
fire. A loop that relied on `stop` would outlive every reload. This is a host
gap, not a plugin one, and it is noted here rather than fixed in `src/` because
this change ships a plugin. The `AbortController` also makes the wait
interruptible, so disposal ends the loop at once instead of after the current
interval.

**D2 — The topic is the read path; the route is the first paint and Refresh.**
The panel renders what `api.realtime` pushed. `GET …/http/snapshot?refresh=1`
forces a sample — a user pressing Refresh is not asking for a cached second.

The panel's **⟳ Refresh** button calls the same thing over RPC
(`snapshot {force:true}`), and it deliberately does NOT render the value the call
answers with: the call publishes to the topic, so the topic stays the one source
of truth for every subscriber and the panel cannot end up showing a second copy
of the same snapshot. It disables itself while in flight. Verified in the
browser: a forced push lands within 400 ms of the click, and the server's own
auto-push was measured independently (7 → 11 frames over 4 s idle).

**D3 — CPU is a rate, so the first sample has none.** The sampler keeps the
previous sweep's `cpuNs` per pid plus the wall clock and reports
`Δcpu / Δwall`. A process that appeared since the last sweep has no baseline
either. Both report `null`, and the panel prints `—` — `0.0%` would claim the
process is idle.

**D4 — Attribution is best-effort and never drops a process.** Categories come
from argv (plus the tree root's identity, plus omp's daemon registry) and an
unlabelled process inherits its nearest labelled ancestor's category. A process
that cannot be read at all is still counted, as `Other`; an uncounted process
would make the total a lie.

**D5 — Two honest aggregates.** The stack's own total, and the machine's
`totalmem`/`cpus`/`loadavg` as context. No percentage the panel computed from
its own numbers.

**D6 — The process list is LABELLED, once, in a sticky header.** The columns are
`PID`, `Process`, `Memory`, `CPU`, `Thr`, each with a `title` naming the quantity
(`Resident set size`, `CPU time over the last sample interval`, `Thread count`) —
a row of bare figures is otherwise unreadable. One header for the whole table,
not one per category group, and each group's rollup sits in the **same columns**
as the rows it sums, so a total is never a number without a column. Verified in
the browser: the header pins while the list scrolls, and the group labels stay
below it.

Two properties of that pinning are not visible in the class list and were both
measured as real artifacts before they were fixed:

- **The pin is `-top-3`, not `top-0`.** The host panel body is `overflow-auto
  p-3`, and a sticky element sticks at the **content box** — 12px below the
  scrollport edge. The header therefore left a 12px band above itself where rows
  scrolled through, un-covered (measured: a dark text pixel at the very top of
  the panel, above the pinned labels). Negating the host's own padding makes the
  header cover that band, which is what the wrapper's `-m-3 p-2` already assumes.
- **The bottom rule is a `box-shadow`, not `border-b`.** With
  `border-collapse: collapse` a border on a sticky header does not travel with
  it: pinned, the rule rendered as a broken run — **112 of 776px** — because each
  cell drew its own edge against the rows scrolling under it. A shadow on the
  `thead` paints one continuous line (**776/776px**) and sits above the rows
  rather than between them. Verified by toggling the shadow off in place: the
  same row read 46px.

**D7 — Windows says it cannot measure.** No `/proc`, no `ps`, and the only
subprocess-free route to a foreign process's CPU (`Get-Counter`) reports a
*sampled* percentage with no cumulative counter and no resident size — a
different quantity in the same column. The probe is `supported: false` with a
reason, and the panel shows it.

## Files

| Path | Role |
|---|---|
| `src/proc/types.ts` | `ProcessInfo` (cumulative `cpuNs`, `rss` in bytes, `cwd`, `startedAt`) and `ProcProbe` |
| `src/proc/darwin.ts` | `libproc` + `sysctl`: taskinfo, bsdinfo (+ start time), vnodepathinfo (cwd), argv |
| `src/proc/linux.ts` | `/proc/<pid>/stat` (+ `starttime`, `btime`) + `/status` + `cmdline` + `/proc/<pid>/cwd` |
| `src/proc/ps.ts` | the `ps` fallback, for a platform with no native probe |
| `src/proc/identity.ts` | the two per-pid lookups the sweep cannot give: `cwdOf`, `leaseOfPid` |
| `src/proc/index.ts` | the platform selector |
| `src/sessions.ts` | the session title (first JSONL line) and the id→file lookup |
| `src/labels.ts` | `describeProcess` — the title and detail a row shows |
| `src/groups.ts` | `assignGroups` — which processes belong to one session |
| `src/daemons.ts` | omp's daemon registry, read off disk |
| `src/snapshot.ts` | `ProcessRow` / `GroupSummary` / `StatsSnapshot` — the wire shapes |
| `src/sampler.ts` | the union, the delta, the rollups, the history |
| `src/format.ts` | the byte/percent/age formatters |
| `src/server.ts` | the service, the RPC methods, the HTTP route, the topic, the settings |
| `src/app.tsx` | the right-panel view |
| `src/TotalsBar.tsx`, `src/ProcessTable.tsx`, `src/Sparkline.tsx` | the three render blocks |
| `src/labels.test.ts`, `src/groups.test.ts`, `src/sessions.test.ts`, `src/sampler.test.ts`, `src/format.test.ts` | the tests |

## Rows say what a process IS, and belong to the session that owns them

The first cut printed one column — the executable's basename — and bucketed by
category. Measured on this machine, that made twelve of forty rows unreadable
(`node` ten times, `cli.js` six, `omp` five) and put four prewarms, a live
session, five js-eval sandboxes and a broker in ONE `omp` bucket. Every
distinction was already in data the sweep had read.

**Two facts are not in argv, and both are needed.**

- **The session LEASE.** argv is fixed at spawn — `buildSessionSpawnArgs('')`
  carries no `--resume` — so a host that ADOPTED a prewarm keeps the prewarm's
  argv for its whole life. Measured: three rows that read as idle prewarms were
  live sessions with titles and hundreds of messages. omp takes an OS `flock` on
  `<configRoot>/run/session-owners/<id>.lock`, so an open descriptor on that file
  is the answer (`leaseOfPid`, 0.70 ms for 9 pids). The same primitive the
  Kabmo's own `lease-holder.server.ts` uses, walked in the other direction.
- **The cwd.** A `tsserver`, a Chromium helper and a `codegraph` MCP server are
  identical in argv, and the directory they run in is what names the checkout.
  Darwin: `proc_pidinfo(PROC_PIDVNODEPATHINFO)`, `vip_path` at 152 of a 2352-byte
  reply (TWO `vnode_info_path`s — a one-struct buffer answers 0 and reads as "no
  cwd" for every process). Linux: `readlink /proc/<pid>/cwd`.

**Grouping follows the ppid links.** A group root is a direct child of the
Kabmo (a session host, a prewarm, a utility, a PTY shell), a daemon root from
omp's registry, or a broker. Three orderings are load-bearing and each was
measured: the direct-child test runs BEFORE the registry test (a session can
spawn its own broker — pid 66310 — which must stay inside that session); daemon
roots come from the registry, never from `broker.pid` (a broker supervises more
daemons than that file names, and `omp.browser.headed` was dropped); and a broker
gets its OWN group, because folding it into whichever daemon a map named first
is arbitrary. A group's figures are the whole subtree's, and `depth` renders as
indentation so the chain (host → broker → relay) is visible.

Cost: the sweep went 3.9 → 6.5 ms for 410 pids (the cwd read), the lease walk
0.40 ms for 5 hosts, and the title read 0.65 ms per file. Against a 1 s interval
that is noise.

## Verification

```bash
bun test marketplace/plugins/stats/src     # 64 tests: labels, groups, sessions, the union, the delta, the live probe
bun run lint && bunx tsc --noEmit --noUnusedLocals --noUnusedParameters
bun run build
bun src/cli/kabmo.js plugin build marketplace/plugins/stats
```

Smoke, run end to end against a real server on a temp data dir:

1. Installed from the bundled marketplace through `POST /api/panels/install`;
   the server logged `[plugin:stats] stats server half loaded`.
2. `GET /api/plugins/stats/http/snapshot?refresh=1` → 22 rows in 5 groups,
   probe `darwin`: `chamber` (1 proc), `utility` (3), `daemon`
   `omp.browser.headless` (8), `daemon` `omp.lsp.mux` (9), `broker` (1) — each
   header carrying its own subtree rollup, each row its two lines.
3. The Kabmo's own row read `Kabmo server — the server itself · 34s`, not
   `index.ts`: the label is decided by PID identity, because a dev boot
   (`bun run src/server/index.ts`) carries no `--kabmo-server`.
4. In a real Chromium at a 420px panel: 31 rows across 5 groups, every group
   header with its `⇄` marker and rollup, indentation rendering as 2 spaces per
   depth, Kabmo's row marked `self` under its pid, and titles in the UI
   stack (`-apple-system`, i.e. `--font-sans` with the Nerd Font fallback) so a
   session's card icon paints rather than tofu. `table.scrollWidth ===
   clientWidth === 420` — no overflow.

The lease rule was proved against the live machine before it was coded: three
hosts whose argv said `prewarm` held open descriptors on
`~/.omp/run/session-owners/<id>.lock`, and their session files carried titles
(`Make PID process display informative`, 500 lines) and current mtimes. The same
sweep with `--resume` alone reported them as idle hosts.

The loop's termination was verified separately, against the built bundle: with
the panel watching, samples published on every tick; after `onDispose` fired,
the count stopped advancing.
