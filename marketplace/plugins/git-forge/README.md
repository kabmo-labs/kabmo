# Forge

A right-panel view of a repository's **issues**, **pull / merge requests** and
**releases**, read from GitHub, GitLab, Gitea/Forgejo or Bitbucket — with the
comment, review, close and merge verbs each host actually supports.

It is the review side of a checkout: Source Control shows what you have changed,
this shows what is waiting on the host.

## One plugin, three sections

The sidebar lists the three collections with their counts, in the shape the wiki
panel's nav already taught: a section is a place you go, not a filter you toggle.
A `+` on a count means the host returned a full page.

**The vocabulary follows the host**: `Pull requests` on GitHub, `Merge requests`
on GitLab, and the provider badge in the header says which one you are looking
at. One component, one data shape, one word per vendor.

## Four hosts, one shape

| Host | Read from | Notes |
|---|---|---|
| GitHub | `search/issues` + `/pulls` + `/releases` | Issues AND pull requests come from the search endpoint — see below |
| GitLab | `/projects/:id/{issues,merge_requests,releases}` | Project path URL-encoded; `opened` not `open` |
| Gitea / Forgejo | `/repos/:id/issues?type=…` + `/releases` | One endpoint for issues and pull requests, split by `type` |
| Bitbucket Cloud | `api.bitbucket.org/2.0/repositories/:ws/:repo/…` | Paged envelopes, uppercase states, no label parameter |

The provider is derived from the remote's host name, and `auto` is the default:
`github.com` (or any host containing `github`) is GitHub, `bitbucket.org` is
Bitbucket, a name containing `gitea`/`forgejo`/`codeberg` is Gitea, and
everything else is GitLab — which is what a self-hosted GitLab needs.

### Why GitHub's issues come from the search endpoint

`/repos/:owner/:repo/issues` returns pull requests too — they carry a
`pull_request` key — and the documented workaround is to filter them out of the
response. That works until a page is *full* of pull requests: measured on
`oven-sh/bun` with `state=open`, the five newest "issues" were all PRs, so
filtering left **zero** issues on screen while 3 595 were open.

`search/issues?q=repo:x is:issue` answers exactly the issue collection, and it
takes the same qualifier grammar as the pull-request search — so ONE path serves
both sections AND every filter. The cost is stated rather than hidden: search has
its own budget (30/min authenticated) and sends **no `ETag`**, so its re-read is
always a full response. The other sections revalidate and cost nothing while
nothing changed.

## Filters

| Control | GitHub | GitLab | Gitea | Bitbucket |
|---|---|---|---|---|
| Open / Closed / All | `state:` | `state=opened\|closed` | `state=` | BBQL `state="…"` |
| Mine | `assignee:@me` | `scope=assigned_to_me` | `assigned=true` | not offered |
| Label | `label:` (quoted) | `labels=` | `labels=` | BBQL `labels ~` |
| Text | free qualifier | `search=` | `q=` | BBQL `title ~` |

Two rules are load-bearing and each was a defect first. **A label with a space
must be quoted** (`label:"good first issue"`), or the host reads the second word
as another qualifier and the filter returns nothing. **`all` is not a value on
GitHub** — the state qualifier is omitted rather than sent as `state:all`, which
matches nothing.

Typed filters are committed after a pause (400 ms): every keystroke would
otherwise be one request against a 30/minute budget.

## Reading an item

A row opens the item: title, state badge, labels, the description rendered
through Kabmo's own markdown pipeline, and then — folded, with counts — the
change's **files** and **commits**, and the conversation below them.

- **Files** show path, status and `+n −n`; a row expands to its hunk. A binary
  change is listed with no disclosure, because a code block over `Binary files
  differ` reads as a broken diff.
- **Commits** show the first line, the short sha and the age.
- **The CI badge** is detail-only, and that is a measured decision: no host puts a
  pipeline on a LIST response (GitLab's `head_pipeline` is `failed` on the merge
  request and `null` on every collection row; GitHub's PR list carries no checks).
  A row badge would cost one request per row.
- **A system or bot entry is drawn differently.** GitLab's `system` notes are
  "changed the description", "approved this merge request"; GitHub's App accounts
  are `dependabot[bot]`. Both are worth showing — an approval recorded only as a
  system note is the one place a reader learns who approved — and neither is a
  reply, so both are a muted line rather than a message.

## Writing

The verbs come from the **server's** capability table, computed per read from the
provider, the section and whether a credential exists — so a public repository
read anonymously offers nothing, and the panel never has to guess.

| Verb | GitHub | GitLab | Gitea | Bitbucket |
|---|---|---|---|---|
| Comment | `POST …/issues/:n/comments` | `POST …/notes` | `POST …/issues/:n/comments` | `POST …/comments` with `{content:{raw}}` |
| Close / reopen | `PATCH {state}` | `PUT {state_event}` | `PATCH {state}` | `POST …/decline` (pull), `PUT {state}` (issue) |
| Approve | `POST …/reviews` | `POST …/approve` | `POST …/reviews` | `POST …/approve` |
| Request changes | `POST …/reviews` | **not offered** | `POST …/reviews` | **not offered** |
| Merge | `PUT …/merge {merge_method}` | `PUT …/merge {squash}` | `POST …/merge {Do}` | `POST …/merge {merge_strategy}` |

Three of those differences are silent when wrong, which is why they are stated
per host rather than assumed: **GitLab's close is an event** (`state_event`) and
sending `state: closed` is accepted and ignored, so the merge request stays open
while the panel reports success; **Bitbucket has no comment body at the top
level** and no state field on a pull request; **Gitea's merge style is `Do`**.

Every verb is confirmed by a dialog that names the consequence — the method, the
branch pair, that a squash discards the branch history — rather than asking
"are you sure?". A dialog that only asks whether you meant to click teaches you to
click through it.

**GitLab has no "request changes" event**, so that button is absent there and the
server refuses the verb by name with the alternative (add a comment, or approve).
Bitbucket has no review verdict at all.

After a write, every cached entry for the repository is dropped: a write changes
the item AND the list it came from, and those are different URLs.

## Credential

Three sources, tried in this order:

1. `GITHUB_TOKEN` / `GH_TOKEN` / `GITLAB_TOKEN` / `GITEA_TOKEN` /
   `BITBUCKET_TOKEN` in the **server's** environment (the process that runs
   `kabmo serve`, not your shell — restart it after exporting one);
2. the vendor CLI — `gh auth token`, or `glab auth status` — read **once** per
   process and cached, including a failure, so a logged-out machine pays one
   spawn rather than one per panel open. Gitea and Bitbucket have no such CLI;
3. nothing, which is legitimate: a public repository reads anonymously, and the
   panel says so above the list.

Bitbucket accepts an access token (`Bearer`) or an app password
(`user:app-password`, sent as Basic) — the colon is what tells them apart.

The manifest also declares a `token` setting, and the server half reads it first —
but **this host has no editor for a panel plugin's declared settings yet** (no
route, no form), so today that value is only reachable if something else writes
it. The environment and CLI above are the sources that work out of the box, and
the panel's own sentences name them rather than pointing at a screen that does
not exist. The same applies to `provider`, `apiBase` and `perPage`.

## The navbar readout and `/issue`

- **`Waiting on me`** in the navbar shows open issues and open requests assigned
  to you, and opens the panel. It reads at most once every five minutes, and only
  with a credential — an anonymous read has no authenticated user, so "assigned
  to me" is a question the host cannot answer (measured: GitHub answers
  `assignee:@me` with a total of 0, which would draw a confident zero over an
  unanswerable question).
- **`/issue <number>`** quotes an item into the composer: its id, title, link and
  the first paragraph of its description, then a `---` divider so you type your
  question under it. `#12` and a full URL work too. The quote is INSERTED, not
  set, so a draft you already had is kept.

## What it does not do

- **No pagination past one page.** A section asks for `per_page` (default 30) and
  says when it came back full rather than pretending the list is complete.
- **No review threads or inline comments.** The conversation is shown; a
  per-line review needs a diff view this panel does not own.
- **No notifications.** Nothing polls in the background except the readout's own
  five-minute timer.
- **No search across repositories.** The scope is one checkout.
- **No issue-tracker features** (milestones, assignee editing, boards).

## Settings

Declared in the manifest and read by the server half. **There is no editor for
these yet** — the host has no form or route for a panel plugin's declared
settings — so what an install runs on is the default column, plus the
environment/CLI credential above.

| Setting | Default | What it does |
|---|---|---|
| API token | empty | A token, read before the environment. |
| Forge | `auto` | `auto`, `github`, `gitlab`, `gitea` or `bitbucket`. |
| API base URL | empty | Overrides the derived API root, e.g. `https://github.mycorp.com/api/v3`. |
| Items per section | 30 | How many items one read asks for. |

## Tests

```
bun test marketplace/plugins/git-forge/
```

172 assertions across 14 files. Each suite owns one rule that fails silently:

- `remote.test.ts` — the remote parser: credentials, ports, subgroups, local
  paths, and the four hosts' API roots.
- `token.test.ts` — the credential ladder, and that a CLI answer is read once.
- `http.test.ts` / `write-http.test.ts` — the conditional read (a second read of
  an unchanged resource, a changed one, the cache bound) and the write path (no
  validator, invalidation by repository).
- `filters.test.ts` — four hosts' filter grammars, including the quoting rule.
- `ci.test.ts` — the CI vocabulary: an in-flight run is pending, a skipped job is
  not a failure, and an unknown word is neutral rather than red.
- `diff.test.ts` — the unified diff parser for the two hosts that answer text.
- `capabilities.test.ts` — what a read may offer, and the sentence a refusal uses.
- `writes.test.ts` — every verb on every host, through the injected fetch, so
  nothing here can reach a real repository.
- `adapters.test.ts` / `gitlab.test.ts` / `forges.test.ts` — the four adapters
  against recorded bodies.
- `command.test.ts` — `/issue`'s parsing, the quotation and the insert.
- `panel/index.test.tsx` — the assembled panel in a real DOM.
