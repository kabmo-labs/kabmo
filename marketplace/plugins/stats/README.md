# Stats

A right-panel view of what the omp stack actually consumes — CPU and RAM, per
process, across the chamber and everything it spawned.

## What it shows

| Block | What you get |
|---|---|
| Totals | Memory and CPU for the whole stack, against the machine's own total and core count |
| Trend | Two sparklines (RSS, CPU) over the last `historyPoints` samples |
| Process table | One row per process, grouped by category, heaviest first — under a sticky column header (`PID`, `Process`, `Memory`, `CPU`, `Thr`) |
| Machine | Total/free memory, cores, 1-minute load per core |
| Daemons | Every daemon omp's registry reports, with its pid, state and supervising broker |

The process list carries **one** column header for the whole table rather than
one per group: the labels are the thing that must not be ambiguous, and a row of
bare numbers (`417.5 MB`, `1.5%`, `41`) is unreadable without them. Each column
label also carries a `title` naming what the figure is (`Resident set size`,
`CPU time over the last sample interval`, `Thread count`). A group's rollup puts
its figures in the **same columns** as the rows it sums, so a total lines up with
what it totals.

Categories are `Chamber`, `omp`, `Terminal`, `Dictation`, `Tray`, and one group
per omp daemon (`omp.browser.headless`, `omp.lsp.mux`, …). A process that cannot
be attributed is still counted, as `Other`.

## What counts as "the omp app"

The process set is a **union**, and the second half is the reason this plugin
exists:

1. the parent/child tree rooted at the chamber's own pid — omp session children
   and their LSP grandchildren, the utility children, prewarm entries, the PTY
   shells and whatever they run, the STT worker, the tray host; **plus**
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

The server half samples **only while a Stats panel is open**. Opening the panel
arms the loop; closing it disarms it. Nothing walks the process table in the
background.

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
