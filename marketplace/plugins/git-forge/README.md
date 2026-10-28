# Forge

A right-panel view of a repository's **issues**, **pull / merge requests** and
**releases**, read from GitHub or GitLab over their own APIs.

It is the review side of a checkout: Source Control shows what you have changed,
this shows what is waiting on the host.

## One plugin, three sections

The sidebar lists the three collections with their counts, in the shape the wiki
panel's nav already taught: a section is a place you go, not a filter you toggle.

| Section | GitHub | GitLab |
|---|---|---|
| Issues | `search/issues?q=repo:x is:issue` | `/projects/:id/issues` |
| Pull / merge requests | `/repos/:id/pulls` | `/projects/:id/merge_requests` |
| Releases | `/repos/:id/releases` | `/projects/:id/releases` |

**The vocabulary follows the host**: the sidebar says `Pull requests` on GitHub
and `Merge requests` on GitLab, and the provider badge in the header says which
one you are looking at. One component, one data shape, one word per vendor.

### Why issues come from the search endpoint

`/repos/:owner/:repo/issues` returns pull requests too — they carry a
`pull_request` key — and the documented workaround is to filter them out of the
response. That works until a page is *full* of pull requests: measured on
`oven-sh/bun` with `state=open`, the five newest "issues" were all PRs, so
filtering left **zero** issues on screen while 3 595 were open. The search
endpoint answers exactly the issue collection, so the page is spent on issues.

The cost is stated rather than hidden: search has its own rate limit (30/min
authenticated) and sends **no `ETag`**, so its re-read is always a full response.
The other two sections revalidate and cost nothing while nothing changed.

## The repository is the shared pick

The header carries the same nested-repo picker the Files, Search, Source Control,
Terminal, Wiki and Commands panels use — one selection (`workspace.activeRepo`)
for all of them, so switching repos in any of them moves this panel too.

The panel reads that checkout's `origin` remote and derives everything from it:
the host, the `owner/name` slug, the provider and the API root. There is no
per-workspace host setting, because the checkout has already answered where it
lives.

| Remote | Read as |
|---|---|
| `git@github.com:o/n.git` | GitHub, `https://api.github.com` |
| `https://github.com/o/n` | GitHub |
| `https://github.mycorp.com/o/n` | GitHub Enterprise, `…/api/v3` |
| `https://gitlab.com/group/sub/project.git` | GitLab, `…/api/v4`, slug `group/sub/project` |
| `https://git-rbi.example.com/o/n.git` | GitLab (self-hosted) |
| `/srv/repo`, `C:\repo` | refused — a local path has no forge behind it |

A remote with credentials (`https://user:token@host/o/n.git`) is parsed and the
credential is **dropped**: it never reaches the page, a note or a log line.

## Credential

Three sources, tried in this order:

1. `GITHUB_TOKEN` / `GH_TOKEN` / `GITLAB_TOKEN` in the **server's** environment
   (the process that runs `kabmo serve`, not your shell — restart it after
   exporting one);
2. the vendor CLI — `gh auth token`, or `glab auth status` — read **once** per
   process and cached, including a failure, so a logged-out machine pays one
   spawn rather than one per panel open;
3. nothing, which is legitimate: a public repository reads anonymously, and the
   panel says so above the list.

The manifest also declares a `token` setting, and the server half reads it
first — but **this host has no editor for a panel plugin's declared settings
yet** (no route, no form), so today that value is only reachable if something
else writes it. The two sources above are the ones that work out of the box, and
the panel's own sentences name them rather than pointing at a screen that does
not exist. The same applies to `provider`, `apiBase` and `perPage`: they are
declared and honoured, and their defaults are what an install runs on.

A missing CLI is not an error. Measured: `Bun.spawnSync` **throws**
`Executable not found in $PATH: glab` on a machine without `glab`, and that throw
failed the whole read until it was caught.

## Reading an item

A row opens the item: title, state badge, labels, the description rendered
through Kabmo's own markdown pipeline (so fenced code, KaTeX and mermaid read the
same as in the chat), and the conversation below it.

Facts the host reports are shown as chips — a request's `base ← head`, its
`+n −n`, its file count, whether it merges, and a pipeline status on GitLab.
GitLab's **system notes are filtered out** of the conversation: "changed the
description" is an audit trail, not a reply.

The panel **reads**. Commenting, reviewing and merging happen on the host, and the
header's link opens the item there.

## What it does not do

- **No writes.** No comment box, no review, no merge, no state change. That would
  need a scope, a confirmation flow and a failure story the panel does not have.
- **No pagination past one page.** A section asks for `per_page` (default 30) and
  says when it came back full — "Showing the first 30" — rather than pretending
  the list is complete.
- **No search across repositories.** The scope is one checkout.
- **No notifications or polling.** A read happens when the panel is the visible
  view and when you press refresh.

## Settings

Declared in the manifest and read by the server half. **There is no editor for
these yet** — the host has no form or route for a panel plugin's declared
settings — so what an install runs on is the default column, plus the
environment/CLI credential above.

| Setting | Default | What it does |
|---|---|---|
| API token | empty | A GitHub or GitLab token, read before the environment. |
| Forge | `auto` | `github`, `gitlab`, or `auto` — which reads `github.com` (and any host with `github` in its name) as GitHub and everything else as GitLab. |
| API base URL | empty | Overrides the derived API root, e.g. `https://github.mycorp.com/api/v3`. |
| Items per section | 30 | How many issues, requests and releases one read asks for. |

## Tests

```
bun test marketplace/plugins/git-forge/
```

- `server/remote.test.ts` — the remote parser over every shape a checkout holds,
  including credentials, ports, subgroups and local paths.
- `server/token.test.ts` — the credential ladder, and that a CLI answer is read
  once.
- `server/http.test.ts` — the conditional read: a second read of an unchanged
  resource, a changed one, the 401/403/404 wording, and the cache bound.
- `server/adapters.test.ts` — both vendors' mapping against recorded bodies,
  including the pull-request-in-issues trap, GitLab's `opened`, its
  string-valued `changes_count`, and a project whose releases 404.
- `panel/index.test.tsx` — the assembled panel in a real DOM: the counts, the
  vendor vocabulary, an empty section versus a refusal, the state filter, and a
  row opening its detail.
