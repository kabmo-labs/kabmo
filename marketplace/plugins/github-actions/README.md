# Actions

A right-panel view of a repository's **GitHub Actions** runs: which workflows ran,
how far each has got, which job failed and what it printed — with cancel and
re-run where the token allows them.

It is the monitoring side of a checkout. Source Control shows what you changed;
this shows what the host is doing with it.

## Surfaces

| Surface | What it draws |
|---|---|
| `rightPanel` — **Runs** | filter (`branch`, state) → run list → one run's jobs and steps → a job's log; cancel / re-run / re-run failed |

There is no navbar readout. A failing-count badge would have to keep a poll
running for a number nobody is looking at, and the panel is the only reader of
what it would print.

The repository is the **shared pick** (`useRepoScope`), so switching repos in
Files, Search, Source Control, Terminal or Forge moves this panel too.

## What one read costs

Measured on this repository (591 runs, 23 workflows) with a token carrying
`repo,workflow`:

| Read | Payload |
|---|---|
| 30 runs | 481 KB (~16 KB per run — every row embeds the repository object) |
| 100 runs | 1.6 MB |
| one run | 16.8 KB |
| its 31 jobs (steps included) | 75.8 KB |
| one job's log | 17 KB (small job) / 63 KB (an E2E shard) |
| the whole run's log archive (not fetched) | 2.1 MB zipped, 8.5 MB inflated, 179 entries |

A second read of an unchanged resource answers `304` and is **free**: six
consecutive conditional reads left `x-ratelimit-remaining` untouched. That is why
the list, the run and the jobs are all read conditionally.

## Progress is counted, not invented

GitHub's API has no percentage and no ETA. A run is jobs, a job is steps, and each
carries `status` plus `conclusion`, so the panel prints what it can prove:

```
14/31 jobs · 2 failing · 7/13 Test
```

A percentage would move backwards the moment a dynamic matrix adds a job.

## The log redirect is two requests

`GET /actions/jobs/{id}/logs` answers `302` to a signed blob URL. **Forwarding the
GitHub token to that URL returns `401 InvalidAuthenticationInfo`** (measured), so
the first request follows the redirect manually and the second carries no headers
at all. `Range` is ignored by the blob host (a `bytes=-2000` request answered
`200` with all 63,430 bytes), so the tail is taken after the download.

Logs **require a token**: the same endpoint answers `403 Must have admin rights`
to an anonymous read, even on a public repository. The panel says that instead of
drawing an empty pane.

The text is a runner transcript: UTF-8 BOM, an ISO timestamp before every line,
ANSI colour, and `##[group]` markers. The server strips the first three and turns
the markers into `▸`, `⚠` and `✗`; nothing else is removed, because a log is
evidence.

## Credential

Three sources, in order:

1. the plugin's `token` setting (Settings → Plugins Kabmo → Actions);
2. `GITHUB_TOKEN` / `GH_TOKEN` in the **server's** environment;
3. `gh auth token --hostname <host>`, read once per host (failures included).

No token is a legitimate state for reading: runs and jobs are visible on a public
repository. Logs and the three verbs are not.

## Writes

| Verb | When offered | What GitHub answers |
|---|---|---|
| Cancel | the token exists and the run is not finished | `202`, or `409` when it already completed |
| Re-run | the token exists and the run finished | `201` |
| Re-run failed | the token exists and at least one job failed | `201` |

A verb the token cannot perform is **not rendered**, and each confirmation names
the consequence (how many jobs will be stopped) rather than asking "are you
sure?". A refusal is GitHub's own sentence, verbatim.

## What it does not do

- **No webhooks.** A webhook needs ingress and a secret; Kabmo is usually behind
  NAT. The panel reads when it opens and on Refresh, and an unchanged read is a
  free `304`, so a reader always sees the state the last read proved.
- **No artifacts, deployments or workflow dispatch.** Dispatch exists in the API
  (a request without `ref` answers `422`), but its inputs are the workflow file's
  own schema — a second feature.
- **No run-level log archive.** A job's own log is one request and 17–63 KB; the
  whole run is a 2.1 MB zip (8.5 MB inflated) that would need an inflater only for
  a file the reader has to pick out of 179 entries anyway.
- **No percentage, no ETA** (see above), and no cross-repository list.
- **No GitLab/Gitea/Bitbucket.** Actions is GitHub's vocabulary; another host is
  refused by name.
- **No notifications.** The kit has no toast or OS-notification surface, and this
  plugin draws no navbar badge: a red `main` is seen by opening the panel.

## Settings

| Setting | Default | What it does |
|---|---|---|
| GitHub token | empty | Read before the environment and `gh`. Stored as a secret. |
| API base URL | empty | GitHub Enterprise, e.g. `https://github.example.com/api/v3`. |
| Runs per read | 30 | 1–100. A full page is reported as truncated. |
| Log tail | 64 KB | The tail kept by default; "Whole log" asks for more. |

## Tests

```
bun test marketplace/plugins/github-actions/
```

Each suite owns a rule that fails silently:

- `state.test.ts` — the vocabulary: an unfinished run is pending, a skipped job is
  not a pass, an unknown word is neutral rather than red.
- `progress.test.ts` — the count, the roll-up, and the step line.
- `logtext.test.ts` — BOM, ANSI, timestamp and `##[group]` folding; a tail cut on a
  line boundary.
- `github.test.ts` — the mapping over recorded bodies, the anonymous note, and the
  log path that must not forward the token.
- `http.test.ts` — a second read of an unchanged resource is a `304` and writes
  nothing new; a changed one replaces the body.
- `panel/index.test.tsx` — the assembled panel: rows open a run, a failed read is
  not an empty list, a log refusal names the token.
- `panel/picker.test.tsx` — a repo pick writes the SHARED slot, and a pick that
  cannot be read drops the previous scope's rows instead of leaving them on
  screen under a moved trigger.

The panel suites mount through `panel/test-harness.tsx` (real DOM, faked kit
services) and read the bodies in `panel/test-fixtures.ts`.
