<!-- Do not delete a section. If one does not apply, write `n/a — <reason>` instead. -->

## What changed

<!-- Intent and resulting behavior in plain words: what was wrong for someone using Kabmo, and what they see now. Name any nearby behavior you deliberately left unchanged. -->

## Why

<!-- The problem as it was hit — the error text, log line or screenshot that proves it — rather than a summary of the diff. -->

## Surface

<!-- Tick every area and mode this change touches. A blank row is an unanswered question. -->

| Area | Touched |
| --- | --- |
| `src/server` (Bun/Elysia, omp bridge, SQLite) | [ ] |
| `src/client` (Preact UI) | [ ] |
| `src/shared` (server and client) | [ ] |
| `src/cli` (`kabmo serve/update/stop/status/logs`) | [ ] |
| docs, CI, packaging | [ ] |

| Mode you actually ran | Ran |
| --- | --- |
| `MOCK=true` (runs with no `omp` install) | [ ] |
| a real `omp` session | [ ] |
| production build (`bun run build`, then `bun run start` or `kabmo serve --prod`) | [ ] |

## Validation

<!-- Exact commands and what they printed, plus what you did NOT verify. The four gates are mandatory:
       bun run lint                                                   (tsc --noEmit)
       bunx tsc --noEmit --noUnusedLocals --noUnusedParameters
       find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | grep -v total | awk '$1>350'   (prints nothing)
       bun run build -->

## Evidence

<!-- Live-run statement: how you started it (`bun run dev`, `bun run start`, `kabmo serve --prod`), which mode it ran in (`MOCK=true` or a real omp session), the browser and OS, and what you observed on the changed path. Then only what the change calls for:
       - UI change: before/after screenshots; add the mobile view when shared layout is affected
       - motion — panel resize or drag, terminal output, streaming, the diagram viewer: a short recording
       - a performance, memory or rendering claim: before/after measurements
     If none of those applies, give the concrete reason. Evidence must be from the current HEAD. -->

## Risk

<!-- Failure modes and rollback, and which state this touches: `session_ui_state`, `omp_chamber_settings`, the SQLite files, a live PTY terminal, a running daemon. -->
