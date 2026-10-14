# Stats OMPChamber — resource panel plugin

A right-panel view of the CPU and RAM the omp stack actually consumes — the
chamber server, every omp child it spawned, the omp daemon brokers and their
daemons, and the PTY shells.

**Shipped as a plugin**, not as a built-in view: `marketplace/plugins/stats`.
It installs from the bundled marketplace like any other panel plugin, is
switchable from the activity bar's right-click menu and from Settings → Panel
Plugins, and ships as two bundles (`dist/app.js` for the panel, `dist/server.js`
for the sampler).

Status: **complete and verified end to end.** The measurements below are from
this machine; the smoke run is described at the end.

## Why a plugin rather than a built-in view

The chamber's plugin platform exists for exactly this shape — a self-contained
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

The chamber's own liveness probe (`src/server/lib/lifecycle/proc/`) answers
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

### F2 — A daemon broker can be parented OUTSIDE the chamber

This is the finding the whole plugin exists for. Walking the ppid tree from the
chamber's pid is *almost* the answer, and the gap is a real resource.

```
broker 10466  parent = 7010 (an omp child of the server)   -> INSIDE the tree
broker 62457  parent = 1                                   -> OUTSIDE the tree
```

The mechanism is in omp's own source: `launch/client.ts` spawns the broker with
`{ detached: true }` and then `child.unref()`s it, so it survives the omp process
that started it and is reparented to `1`. Broker `62457` supervised
`~/.omp/run/daemons/1f1e40d033e7375e/` whose `scope.json` reads
`{"projectDir":"/Users/rajebdev/JatisMobile/ompchamber"}` — **this project** —
and its subtree is a Chromium plus its helpers.

So the process set is the **union** of:

1. the ppid tree rooted at the chamber's pid; and
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

**D7 — Windows says it cannot measure.** No `/proc`, no `ps`, and the only
subprocess-free route to a foreign process's CPU (`Get-Counter`) reports a
*sampled* percentage with no cumulative counter and no resident size — a
different quantity in the same column. The probe is `supported: false` with a
reason, and the panel shows it.

## Files

| Path | Role |
|---|---|
| `src/proc/types.ts` | `ProcessInfo` (cumulative `cpuNs`, `rss` in bytes) and `ProcProbe` |
| `src/proc/darwin.ts` | `libproc` + `sysctl`: taskinfo, bsdinfo, argv |
| `src/proc/linux.ts` | `/proc/<pid>/stat` + `/status` + `cmdline` |
| `src/proc/ps.ts` | the `ps` fallback, for a platform with no native probe |
| `src/proc/index.ts` | the platform selector |
| `src/classify.ts` | argv → category, daemon subtrees, ancestor inheritance |
| `src/daemons.ts` | omp's daemon registry, read off disk |
| `src/sampler.ts` | the union, the delta, the rollups, the history |
| `src/format.ts` | the label/byte/percent formatters |
| `src/server.ts` | the service, the RPC methods, the HTTP route, the topic, the settings |
| `src/app.tsx` | the right-panel view |
| `src/TotalsBar.tsx`, `src/ProcessTable.tsx`, `src/Sparkline.tsx` | the three render blocks |
| `src/sampler.test.ts`, `src/format.test.ts` | the tests |

## Verification

```bash
bun test marketplace/plugins/stats/src     # 25 tests: classification, the union, the delta, the live probe
bun run lint && bunx tsc --noEmit --noUnusedLocals --noUnusedParameters
bun run build
bun src/cli/ompchamber.js plugin build marketplace/plugins/stats
```

Smoke, run end to end against a real server on a temp data dir:

1. Installed from the bundled marketplace through `POST /api/panels/install`;
   the server logged `[plugin:stats] stats server half loaded`.
2. `GET /api/plugins/stats/http/snapshot?refresh=1` → 20 rows, probe `darwin`,
   totals grouped into `chamber`, `omp`, `daemon:omp.browser.headless`,
   `daemon:omp.lsp.mux`, and the test servers' own daemons.
3. `POST …/rpc/watch` → `{watching:1}`; `POST …/rpc/snapshot {force:true}` →
   `cpu 14.3`, with the chamber's own row carrying a real CPU percent.
4. In a real Chromium: the activity bar shows `Resources — Stats`; clicking it
   renders 20 process rows across 7 category groups, live CPU percentages in
   every cell (no `—` after the first sample), both sparklines, the machine
   facts, and the daemon block.

Two bugs were found by the tests and fixed before the smoke run: the ancestor
walk treated an already-resolved ancestor as "no label" (so a `bash` under an
omp child read as `Other` whenever the omp child was visited first), and the
chamber's own row was labelled from argv (so a `bun run` boot left it `Other`,
and its command read `run`).

The loop's termination was verified separately, against the built bundle: with
the panel watching, samples published on every tick; after `onDispose` fired,
the count stopped advancing.
