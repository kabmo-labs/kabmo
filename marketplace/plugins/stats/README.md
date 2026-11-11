# Stats

A right-panel view of what the omp stack actually consumes — CPU and RAM, per
process, across Kabmo and everything it spawned — plus a navbar readout of the
same two figures.

## The navbar readout

Two columns in the header, on both layouts:

```
CPU   RAM
18%   2.5G
```

It is the same measurement as the panel's totals, spelled for a header (one
character of unit, one decimal past megabytes). Clicking it opens the panel —
wherever the panel lives, which is the user's placement: the right column, the
left dock, or the phone drawer that holds it. On a phone narrower than 430px the
entry moves into the header's `⋯` menu rather than crowding the session title.

The readout arms the sampler while it is on screen and releases it on unmount or
while the tab is hidden, so a figure nobody is looking at costs nothing. Before
the first sample both columns read `—`; the first sample has no CPU rate (a rate
needs two readings), and a platform with no probe reports `—` in both rather
than printing zeros as measurements.

## What it shows

| Block | What you get |
|---|---|
| Totals | Memory and CPU for the whole stack, against the machine's own total and core count, saying which figure the memory is (`footprint` / `resident` / `footprint + rss`) |
| Trend | Two sparklines (memory, CPU) over the last `historyPoints` samples |
| Process table | One row per process, grouped by category, heaviest first — under a sticky column header (`PID`, `Process`, `Memory`, `CPU`, `Thr`), each row with a `×` that stops it |
| Machine | Total memory, **memory available**, cores, 1-minute load per core |
| Daemons | Every daemon omp's registry reports, with its pid, state and supervising broker |

The process list carries **one** column header for the whole table rather than
one per group: the labels are the thing that must not be ambiguous, and a row of
bare numbers (`417.5 MB`, `1.5%`, `41`) is unreadable without them. Each column
label also carries a `title` naming what the figure is (`Physical footprint where
the OS reports one (macOS); resident size otherwise`, `CPU time over the last
sample interval`, `Thread count`). A group's rollup puts its figures in the
**same columns** as the rows it sums, so a total lines up with what it totals.

**Memory is the operating system's charge, not RSS.** On macOS a Bun process that
has read and dropped a transcript keeps the freed pages resident — measured on
the live server, 317 MB resident for a 134 MB physical footprint — so each row
shows `footprint` where the OS reports one and falls back to RSS otherwise, with
the source in the row's tooltip and the totals' caption. `memory available` is
free + inactive + speculative (`vm_stat`) / `MemAvailable`, not `os.freemem()`,
which counts only free pages (1.05 GB against 5.60 GB available on this host).

## Stopping a process

Every row except Kabmo's own carries a `×`. It opens a confirmation naming the
process, its pid, its memory and its thread count; Cancel holds focus, Escape
cancels. Confirming sends `SIGTERM` (omp children flush their transcript on it)
and takes a fresh sample so the row disappears instead of leaving a dead pid on
screen. Refused, with the reason shown in the dialog: the Kabmo itself (that is
`kabmo stop`), a pid outside the stack this panel measures (the table may be
stale, and a recycled pid belongs to something the user never looked at), and
anything that is not an integer above 1.

Groups are the **owners**, not categories: Kabmo itself, one group per live
session (omp over RPC, or any ACP harness — `claude`, `codex`, `opencode`, …),
one per idle prewarm, one per PTY shell, and one per omp daemon
(`omp.browser.headless`, `omp.lsp.mux`, …). A process that cannot be attributed
is still counted, as `Other`.

An ACP chat is named from the lease Kabmo writes for its child
(`<data>/run/harness-sessions/<pid>.json`): the chat's title, its short session
id and the harness. An ACP agent holds no omp session lease and its transcript
lives behind the agent, so argv alone names neither the chat nor the harness —
measured against the real launch table, 12 of the 13 ACP harnesses were drawn as
a bare `npx` row inside Kabmo's own group before the lease existed. A lease
whose spawn time does not match the process's own start time is ignored, so a
recycled pid is never named after a chat that no longer exists.

## What counts as "the omp app"

The process set is a **union**, and the second half is the reason this plugin
exists:

1. the parent/child tree rooted at Kabmo's own pid — omp session children
   and their LSP grandchildren, the utility children, prewarm entries, every
   ACP harness child (`claude`, `codex`, `opencode`, …) and whatever it spawns,
   the PTY shells and whatever they run, the STT worker, the tray host; **plus**
2. the subtree under every daemon in omp's registry (`~/.omp/run/daemons/*`).

A daemon broker is spawned detached and `unref`ed by omp, so it outlives the omp
process that started it and its parent becomes `1`. Measured on the author's
machine: one broker sat under the server and another did not — the orphan
supervised that project's Chromium, 9 processes and ~470 MB that a tree walk can
never reach. Both are followed.

## How it reads them

No subprocess, on macOS and Linux:

- **macOS** — `libproc` (`proc_pidinfo(PROC_PIDTASKINFO)` for RSS/CPU/threads,
  `PROC_PIDTBSDINFO` for the parent) plus `sysctl(KERN_PROCARGS2)` for argv. A
  full sweep is ~0.75 ms.
- **Linux** — `/proc/<pid>/stat` (parent, utime, stime) and `/proc/<pid>/status`
  (VmRSS, Threads). ~0.5 ms.
- **Other platforms** — one `ps` spawn.
- **Windows** — deliberately reports that it cannot measure rather than showing
  a different quantity in the same column.

CPU is a rate, so it needs two readings: the first sample shows RSS and the
process list with `—` in the CPU column, and the figure appears on the next tick.
A process that appeared since the last sample shows `—` too, for the same reason.

## Sampling only while you are looking

The server half samples **only while a Stats panel — or the navbar readout — is
on screen**. Opening either arms the loop; closing it disarms it. Nothing walks
the process table in the background, and a hidden tab releases its watch.

## Auto-refresh, and the Refresh button

The panel updates **by itself** — no polling in the browser. The server samples
on a loop (`sampleMs`, default 1 s) and pushes each sample onto the plugin's
realtime topic, so every open panel re-renders on arrival. Closing the panel
disarms the loop; nothing samples while nobody is looking.

**⟳ Refresh** in the top-right of the stack strip forces a sample immediately
instead of waiting for the next tick — the same thing
`GET …/http/snapshot?refresh=1` does. It disables itself while the call is in
flight, so a second click cannot queue a second sample.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `sampleMs` | `1000` | Sampling interval, floor 200 ms |
| `includeBrokers` | `true` | Follow the omp daemon registry (see above) |
| `historyPoints` | `60` | Samples retained for the sparklines; `0` disables them |

## HTTP surface

`GET /api/plugins/stats/http/snapshot` returns the current snapshot as JSON;
`?refresh=1` forces a fresh sample. Useful for a monitor or a shell script:

```bash
curl -s localhost:3000/api/plugins/stats/http/snapshot | jq '.total'
```

## Notes

Everything is read locally from this machine's own process table. Nothing is
sent anywhere, and no credential is involved.
