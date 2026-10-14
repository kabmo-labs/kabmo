# Git panel — merge/conflict, branch rename, branch management, and the rest

Research for the Source Control panel (`src/client/components/workspace/git-panel/`,
route `src/server/routes/fs/git.ts`). Status: **research only, nothing implemented.**

Four questions, answered in order, each with the current state measured against
the code and against real repositories:

1. Merge — how a `git merge` feature should work, including conflict resolution.
2. Branch rename — local and remote.
3. Branch management modal — opened from the branch dropdown.
4. Which git features are worth adding at all (cheap × frequent).

The corpus for "frequent" is the author's own `~/.omp/agent/sessions` (every
`git` invocation the chamber's agent ever ran) plus `~/.zsh_history`, counted by
`rg -o 'git (merge|rebase|…)'`:

| verb | invocations | verb | invocations |
|---|---|---|---|
| `status` | 15300 | `fetch` | 1147 |
| `log` | 9906 | `init` | 1035 |
| `diff` | 9146 | `reset` | 1028 |
| `show` | 4907 | `clean` | 805 |
| `add` | 4576 | **`merge`** | **763** |
| `commit` | 4160 | `remote` | 727 |
| **`stash`** | **2784** | **`tag`** | **605** |
| `checkout` | 2610 | `worktree` | 588 |
| `push` | 1561 | `ls-files` | 539 |
| `config` | 1477 | `apply` | 467 |
| `rev-parse` | 1328 | **`rebase`** | **327** |
| `restore` | 1236 | `describe` | 297 |
| **`branch`** | **1235** | `for-each-ref` | 261 |
| `pull` | 1161 | **`cherry-pick`** | **144** |

Actual conflicts are rare but real: `CONFLICT (content)` appears in 8 session
files, and the author's own shell history is a normal small set (`git status`
14, `clone` 6, `log` 5, `pull` 4, `restore` 2, `checkout` 2, `add` 2, `revert` 1,
`reset` 1, `commit` 1, `branch` 1). So: merge is a top-ten verb, conflicts are
uncommon — which is exactly the shape where a UI must be *good at the 95% clean
case* and *not actively wrong in the 5% conflicted case*.

---

## 1. What the panel does today

### 1a. Merge exists, but only from the commit modal, and only by SHA

`src/client/components/workspace/git-panel/commit-modal/CommitActions.tsx`
renders seven buttons per commit row: `checkout`, `create branch here`,
`cherry-pick`, `revert`, `reset…`, `merge into current`, `rebase onto this`.
The last two reach `src/server/routes/fs/git.ts`:

```ts
} else if (actionType === 'merge_commit') {
  await expectOk(['merge', formData.get('hash') as string], targetDir);
} else if (actionType === 'rebase_commit') {
  await expectOk(['rebase', formData.get('hash') as string], targetDir);
```

Three consequences, each verified:

- **The merge message loses the branch name.** `git merge <sha>` produces
  `Merge commit '<sha>'`; `git merge <branch>` produces `Merge branch '<name>'`.
  Measured on a scratch repo. The panel therefore writes worse history than the
  user would have by hand, and there is no way to merge a branch by name at all.
- **There is no branch-level merge.** The branch dropdown
  (`BranchToolbar.tsx:57-109`) lists local and remote branches and offers exactly
  two actions: checkout, and "Create new branch…". Merging a branch is not
  reachable from where branches live.
- **A conflict is a toast.** The action is fire-and-forget through
  `actionFetcher.submit`; the route's `catch` turns git's exit 1 into
  `json({ success: false, error: reason }, { status: 400 })`, and
  `GitPanel` renders it via `pushToast(payload.error)`. The user sees
  `Auto-merging f.txt / CONFLICT (content): Merge conflict in f.txt / Automatic
  merge failed…` in a transient toast, and the panel keeps rendering a normal
  working tree. Nothing says a merge is in progress.

### 1b. A conflicted file renders as the wrong thing, and twice

This is the sharpest existing bug and it is pinned by a test that asserts the
wrong behaviour.

`parsePorcelainZ` (`src/server/lib/fs/git-run.ts:160`) reads the two porcelain
columns as `status` and derives `staged` as `status[0] !== ' ' && status[0] !== '?'`.
For an unmerged path the columns are `U`/`A`/`D` pairs — `UU`, `AA`, `DD`, `AU`,
`UA`, `DU`, `UD` — none of which is a space, so **every conflicted file is
reported as staged**. `getGitStatusInfo` (`src/shared/lib/fs/git-status.ts:32-95`)
then has no unmerged branch and falls through:

| porcelain | label today | correct label |
|---|---|---|
| `UU` | **Untracked** | Conflicted (both modified) |
| `AA` | Added (Staged) | Conflicted (both added) |
| `DD` | Deleted (Staged) | Conflicted (both deleted) |
| `AU` | Added (Staged) | Conflicted (added by us) |
| `UA` | **Untracked** | Conflicted (added by them) |
| `DU` | Deleted (Staged) | Conflicted (deleted by us) |
| `UD` | **Untracked** | Conflicted (deleted by them) |

Measured by driving the real parser + presenter over the seven codes.

And because `ChangesList.tsx:20-28` splits on the same columns, a `UU` file
satisfies **both** filters and is rendered in "Staged Changes" *and* in
"Changes" — the same path twice, in two sections, neither of which says it is
conflicted. `src/shared/lib/fs/git-status.test.ts:89-95` pins this as intended:

```ts
test('unmerged porcelain pairs carry no dedicated branch', () => {
  expect(getGitStatusInfo('UU').label).toBe('Untracked');
  expect(getGitStatusInfo('AU').label).toBe('Untracked');
  expect(getGitStatusInfo('UA').label).toBe('Added');
});
```

That test must be deleted, not re-pinned — it documents a bug.

### 1c. Nothing detects that an operation is in progress

There is no read of `MERGE_HEAD`, `rebase-merge`, `CHERRY_PICK_HEAD`,
`REVERT_HEAD` or `sequencer` anywhere in `src/`. `readGitStatus` returns
`{changes, branch, branches, remoteBranches, syncCount}` and nothing else.

The branch name during a conflict is also wrong in one case: `readGitStatus`
marks HEAD from `%(HEAD)` in `for-each-ref`. During a **merge** conflict that
still resolves (`main|*`); during a **rebase** conflict no local ref is marked,
so it falls to `git rev-parse --abbrev-ref HEAD` which prints the literal
`HEAD` — measured: the panel would show `HEAD` as the branch and list it as a
branch in the dropdown.

### 1d. A conflict is a dead end for the other actions

Verified against a real conflicted repo:

| action | result |
|---|---|
| Commit (the panel's Commit button) | `error: Committing is not possible because you have unmerged files.` |
| Discard / revert on the conflicted file | **silently discards the conflict and leaves the merge in progress** |
| Checkout another branch | `error: you need to resolve your current index first` |
| Pull / Sync | `error: Pulling is not possible because you have unmerged files.` |
| Create branch | succeeds (harmless) |

The discard case is the dangerous one. `revertPath` runs
`reset -q -- <file>` → `checkout -- <file>` → `clean -fd -- <file>`. On a
conflicted file that sequence throws away the conflicted content, restores the
pre-merge version of that file, and **leaves `MERGE_HEAD` in place** — measured:
`git status` afterwards reads "All conflicts fixed but you are still merging."
So a user who clicks the trash icon on a conflicted row is told nothing and ends
up in a merge that looks clean but is not concluded. This is the shape the AGENTS
rules call out repeatedly: a silent success that is not one.

### 1e. `merge_commit` takes a client string as an option

`['merge', hash]` with no `--` separator. Verified: `git merge --abort` runs
happily when the "hash" is `--abort`. Same for `reset_commit` (`['reset',
'--'+mode, hash]` — a `mode` of `hard` is fine, but the hash is unguarded) and
`cherry_pick`/`revert_commit`/`rebase_commit`. It is the same user's own
repository so this is not a privilege boundary, but it is the class of bug the
route's own header comment (`git-run.ts:9-22`) exists to prevent, and a
`--` separator plus a hash-shape guard costs one line.

---

## 2. Merge — the design

### 2.1 The conflict state is a first-class read

Add one module, `src/server/lib/fs/git-state.ts`, exporting

```ts
export type GitOperation =
  | 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'rebase-apply' | null;

export interface GitState {
  operation: GitOperation;
  /** Repo-relative paths with unmerged index entries, from `ls-files -u`. */
  conflicts: string[];
  /** The other side: `MERGE_HEAD`'s subject, or the branch being rebased onto. */
  detail?: string;
}

export async function readGitState(targetDir: string): Promise<GitState>;
```

Detection is a filesystem probe against the **absolute** git dir, not a
relative path:

```
git rev-parse --absolute-git-dir      →  /tmp/gd/.git
<dir>/MERGE_HEAD  <dir>/rebase-merge  <dir>/rebase-apply
<dir>/CHERRY_PICK_HEAD  <dir>/REVERT_HEAD
```

Two things were measured that rule out the obvious alternatives:

- **`git rev-parse --git-path <name>` cannot be batched.** Passing five names
  gives one path and then `fatal: ambiguous argument 'rebase-merge': unknown
  revision` — it takes a single name. Five spawns for one boolean is waste.
- **`--git-path` returns a RELATIVE path** (`../../.git/MERGE_HEAD` from a
  subdirectory), so it has to be joined against the cwd. `--absolute-git-dir`
  is absolute and resolves from any subdirectory — verified from `sub/deep/`.
  It also resolves correctly for a linked worktree (returns
  `<main>/.git/worktrees/<name>`), which is where a merge's state actually lives.

`conflicts` comes from one `git ls-files -u -z` (three records per conflicted
path, stages 1/2/3) or, equivalently, `git diff --name-only --diff-filter=U`.
`ls-files -u` is the better source: `-z` is lossless for the same reason
`parsePorcelainZ`'s `-z` is, and it names the path once per stage so a
dedupe is a map key.

Then `readGitStatus` gains `state: GitState` in its payload, which means it
rides the existing `git:<root>\0<repo>` realtime topic for free — the panel
learns a merge started without a second read path.

### 2.2 Conflict status codes get their own branch

`getGitStatusInfo` gains an unmerged branch **before** the staged/unstaged
split, and the two-character code is what selects it (not the columns):

```
UU  both modified      UA  added by them
AA  both added         DU  deleted by us
DD  both deleted       UD  deleted by them
AU  added by us
```

Presentation: one tone (`--theme-warning`, already in the palette) and a
`Conflicted` label with the specific pair in the tooltip. `staged` becomes
`false` for every unmerged code, which also fixes the double-listing: a
conflicted path belongs to a third section, "Conflicts", drawn above Staged and
Changes, with its own count — the shape every other git client converged on, and
the reason is that a conflicted file is neither.

`git-status.test.ts:89-95` is deleted and replaced with a table test over all
seven pairs.

### 2.3 A merge bar replaces the toolbar while an operation is live

When `state.operation !== null`, the panel renders an operation bar in place of
the commit box:

```
⛙ Merging feature/payments into main — 2 of 5 conflicts resolved
   [Take ours] [Take theirs] [Open in editor]        [Abort merge] [Continue]
```

The bar is the whole point of the feature: it is the only thing on screen that
says "you are in the middle of something", it carries the two actions that only
exist in that state (abort, continue), and it makes the conflict count a number
the user can drive to zero.

Rules that come out of the measurements:

- **Continue is enabled only when `conflicts.length === 0`.** `git commit -m`
  during a resolved merge concludes it — verified: `MERGE_HEAD` is gone
  afterwards. So the route action is `['commit', '--no-edit']`, not
  `merge --continue`.
- **`--no-edit` and a `GIT_EDITOR` override are both required, and both were
  measured.** With `GIT_EDITOR` unset and stdin closed, `git merge --continue`
  fails: `error: Terminal is dumb, but EDITOR unset`. With `GIT_EDITOR=vim`
  inherited, it *blocks on vim* until the timeout kills it. The route must spawn
  with `GIT_EDITOR=true` in the env (measured: overrides a `core.editor=vim`
  config and completes). `git commit --no-edit` does not need the editor at all
  and is the simpler verb.
- **Abort is a named verb per operation.** `git merge --abort`, `git rebase
  --abort`, `git cherry-pick --abort` — verified each. On a tree with no
  operation in progress all three exit **128** with their own message
  (`fatal: There is no merge to abort (MERGE_HEAD missing)`, `fatal: no rebase
  in progress`, `error: no cherry-pick or revert in progress`), so `expectOk`
  reports them correctly — but the button is only rendered when
  `state.operation` says so, and the route refuses otherwise, because a
  128-with-a-fatal is still a worse answer than an action that is not offered.
- **`git reset --merge HEAD` is the fallback for a stash-pop conflict**, which is
  the one conflict shape with no operation file: measured, a conflicting
  `stash pop` leaves `UU f` and **no** `MERGE_HEAD`/`rebase-merge`/
  `CHERRY_PICK_HEAD`, so every abort verb exits 128 with its own fatal.
  `git reset --merge HEAD` clears it (measured: `UU f` → clean) and the stash
  entry survives, so the user can retry the pop.

### 2.4 Per-file resolution, with the ours/theirs trap named

Per conflicted row: **Open in editor**, **Take ours**, **Take theirs**,
**Mark resolved**.

- `Take ours` / `Take theirs` = `git checkout --ours|--theirs -- <path>`
  followed by `git add -- <path>`. Both verified; both are single argv actions
  that fit the existing `expectOk` shape.
- **`ours`/`theirs` are inverted during a rebase, and this must be in the UI, not
  a footnote.** Measured on the same fixture:

  | state | `--ours` gives | `--theirs` gives |
  |---|---|---|
  | merge | `MAIN` (the branch you are on) | `FEAT` (the branch merged in) |
  | rebase | `FEAT` (the branch you are rebasing ONTO) | `MAIN` (your commit being replayed) |

  So during a rebase the button labels are wrong if they say "ours"/"theirs"
  literally. The honest labels are the ones git's own markers carry — read the
  `<<<<<<< ` and `>>>>>>> ` lines off the working file and label the buttons with
  those (`HEAD` / `feature/payments`, or the abbreviated commit subject during a
  rebase, which is what git itself writes: `>>>>>>> a563c8a (main)`). That is a
  file read the server can do and return alongside the conflict list.
- `Mark resolved` = `git add -- <path>`. That is exactly what git's own hint
  says, and it is the only thing that moves `ls-files -u` toward empty.
- **The diff view for a conflicted file already works and needs no change**:
  `fetchWorkingFileDiff` returns git's combined diff (`diff --cc`, `@@@`), and
  `parseUnifiedDiff` renders it — measured, the markers come through as
  add/context rows. What is missing is that the diff panel does not know it is
  looking at a conflict, so it should carry the same operation banner.
  `revertPath` must **refuse** a path in `state.conflicts` — see 1d.

### 2.5 Merge from the branch dropdown, by NAME

`git merge <branch>` (not the SHA) is what produces `Merge branch '<name>'`.
Add `merge_branch` to the route, taking the branch name, and put it in the
branch dropdown next to checkout. Guard the name with
`git check-ref-format --branch <name>` — the same helper `resolveRepoPath`-style
validation, and the thing that makes `--abort`-as-a-name impossible.

The `merge_commit` SHA path stays for the commit modal (merging an arbitrary
commit is a legitimate need) but gains a `--` separator and a hash-shape guard.

### 2.6 What merge should NOT do

- **No `--squash` and no `--no-commit` in v1.** Both measured: `--squash` leaves
  staged changes and **no** `MERGE_HEAD` (`SQUASH_MSG` instead), `--no-commit`
  leaves `MERGE_HEAD` — two extra states the operation model would have to
  represent for a rarely-used flag. Add later if asked.
- **No conflict-marker editing in the diff panel.** An inline "accept this hunk"
  UI over `<<<<<<<` blocks is a merge-tool implementation, and the panel already
  has "Open in editor" which is the honest answer. The editor has no
  conflict-marker awareness today (verified: no reference to `<<<<<<<` anywhere
  under `src/client/components/**/editor`), so opening the file shows the
  markers as text — which is correct and sufficient.

---

## 3. Branch rename

### 3.1 Local rename is one command

`git branch -m <old> <new>`. Measured behaviour:

- Renames the current branch or any other branch, and the working tree is
  untouched.
- **It carries the upstream config across**, which is the subtle part:
  `branch.feat2.remote=origin`, `branch.feat2.merge=refs/heads/feature`. So
  after renaming `feature`→`feat2`, the branch still tracks `origin/feature`
  and `git branch -vv` reads `[origin/feature]`. Correct, and exactly what
  should be shown to the user before they commit to the rename.
- **It refuses a collision**, including a case-only one:
  `fatal: a branch named 'Main' already exists` for `main`→`Main`. `-M` forces
  but does **not** help the case-only rename either (same fatal). So the modal
  must not offer "force" as a way to fix a case-only rename — it cannot.
- A name starting with `-` is refused by git itself
  (`'--help' is not a valid branch name`), and `git branch -m <old> -- <new>`
  is the argv form that cannot be read as a flag.

Route: `rename_branch` with `branch` and `newName`, validated by
`git check-ref-format --branch <newName>` before the rename, with the
collision answered as git's own message.

### 3.2 Remote rename is three commands and a decision

There is no `git branch -m --remote`. Publishing a rename is:

```
git push -u origin <new>          # create the new remote branch, set upstream
git push origin --delete <old>    # remove the old remote branch
git fetch --prune                 # drop the stale origin/<old> tracking ref
```

Two measured traps:

- **A local rename does NOT move the upstream.** After `git branch -m main
  trunk`, `git push` refuses outright: `fatal: The upstream branch of your
  current branch does not match the name of your current branch.` So the
  rename→publish sequence must be `push -u` (which re-points the upstream —
  verified: `branch.trunk.merge` becomes `refs/heads/trunk`) and **not** the
  panel's existing `pushBranch`, which reads the upstream first and issues a
  bare `git push`.
- **Deleting the old remote name can be refused by the server**: `remote: error:
  By default, deleting the current branch is denied`. On a bare repo whose HEAD
  still points at it, `--delete main` is rejected. That is a real answer the
  user has to see, not a generic failure — surface git's own line.
- **`--prune` is required**, or `origin/<old>` lingers and the branch dropdown
  keeps offering a branch that no longer exists on the remote.

Design decision: **the remote half is a checkbox in the rename dialog, off by
default, and it states the three commands it will run.** Renaming a local branch
is reversible and cheap; rewriting what other people have checked out is not.
Default-off is the conservative option and matches the user's own history
(71 `git branch -m`, 25 `git branch -d`, and the remote rename sequence appears
only in an explanatory note, never as an executed command).

The dialog shows, before the rename:
- the new name field, validated live against `check-ref-format`;
- a collision warning if the target exists;
- the current upstream (`origin/feature`) with a note that it is kept as-is;
- the remote checkbox with the three commands spelled out.

---

## 4. Branch management modal

### 4.1 What the dropdown is today

`BranchToolbar.tsx:57-109`: a 192px-wide absolute panel, `max-h-48`, two
labelled groups (Local / Remote), one button per branch, a check on the current
one, and a divider + "Create new branch…". No search, no metadata, no per-branch
actions, no virtualization — and the branch list is `data.branches` straight
from `readGitStatus`, which is **every** branch.

That is already a problem at scale and was measured: `git for-each-ref` over 501
branches is 0.01s, but rendering 501 `<button>`s in a 192px panel with a 192px
scroll area is not something to ship once a repo has feature branches in the
hundreds. The modal fixes the presentation; a search field fixes the volume.

### 4.2 The modal

Opened from the branch dropdown by a `Manage branches…` row (and from the
current-branch button's context menu). Follows the commit modal's shell — the
git panel already has that pattern (`commit-modal/index.tsx`:
`lg:w-[min(96vw,980px)] lg:h-[88vh]`, full-screen on phones), so this is a
sibling, not a new convention.

```
┌ Branches ──────────────────────────── [search] ────── [⟳] ── ✕ ┐
│ Local (12)                                                     │
│  ● main              ↑2 ↓0   origin/main    3h ago  fix(panels)…│
│    feature/payments          origin/…       2d ago  add refunds │
│    spike/ort         ahead 5 (unpublished)  6d ago  try ort     │
│ Remote (8)                                                     │
│    origin/main       3h ago  fix(panels)…                      │
└────────────────────────────────────────────────────────────────┘
```

Per row: checkout (click), and a `⋯` menu with **Rename…**, **Merge into
current**, **Delete**, **Copy name**. The current branch's row has no Delete.

Everything the row shows comes from **one** `for-each-ref` call, extending the
one `readGitStatus` already makes:

```
%(refname)%09%(refname:short)%09%(HEAD)
  %09%(upstream:short)%09%(upstream:track)
  %09%(committerdate:relative)%09%(subject)%09%(objectname:short)
```

`%(upstream:track)` was measured in every state it can be in:
`[ahead 1]`, `[behind 3]`, `[ahead 1, behind 3]`, `[gone]` (upstream deleted),
and **empty** for a branch with no upstream — including an unpublished branch
that is several commits ahead of everything, which is why
`gitSyncCount`'s `--not --remotes` fallback exists (`git-sync.ts:200-208`) and
why the modal must render that empty as "unpublished", not as "in sync".

`%(ahead-behind:HEAD)` is the newer atom (git 2.41 — verified against the 2.41
docs; absent from 2.40) and is deliberately **not** used: it answers "ahead of
the *current* branch", not "ahead of the upstream" (measured: a branch two
commits ahead of `main` reads `[2 0]` while its upstream track is empty), which
is a different question from the one the row is showing.

Cost measured on 501 branches: 0.01s → 0.03s for the extended format. Free.

### 4.3 Delete, and why it is a two-button decision

`git branch -d` refuses an unmerged branch (`error: the branch 'feat' is not
fully merged`) and `-D` forces. Verified. So:

- The row menu offers Delete; the route runs `git branch -d`.
- If git refuses, the dialog reports **git's own sentence** and offers a second,
  explicit "Delete anyway (`-D`)" — never a silent `-D`. Deleting a branch with
  unmerged commits is the one destructive action in this panel that has no
  undo outside the reflog.
- A branch that is checked out cannot be deleted; git says so.

### 4.4 What the modal deliberately omits in v1

- **No branch creation from here** — it exists in the dropdown already
  (`create_branch`, and `create_branch_at` from the commit modal), and a second
  entry point would be a second place for the same validation to drift.
- **No force-push / no `reset --hard`** — the modal is where a user lands by
  accident; it is not the place for a history rewrite.
- **No per-branch diff/log preview** — `git log <branch>` is one click away
  through the existing commit modal, and adding a second history surface means
  the graph, the paging and the diff viewer all need to work in two places.

---

## 5. Recommended features, ranked by cost × frequency

Ranked by the session corpus above, with implementation cost against this
codebase. "Cheap" means it fits the existing `actionType` branch in
`routes/fs/git.ts` plus one UI affordance.

| # | Feature | Corpus | Cost | Why / what it needs |
|---|---|---|---|---|
| 1 | **Conflict state + resolve** (§2) | 763 merge, 327 rebase, 144 cherry-pick | medium | The panel is *wrong* today, not merely incomplete (§1b, §1d). Everything else is additive; this is corrective. |
| 2 | **Fetch button** | 1147 | **cheap** | One `fetch` actionType + one button beside Sync. `refreshRemoteRefs` + `markRemoteRefsFresh` already exist in `git-sync.ts`; the only new code is the action. The panel has pull/push/sync but no way to see what the remote has without also moving the branch. |
| 3 | **Branch rename** (§3) | 71 `-m`, 1235 `branch` | cheap | One actionType, one dialog, one `check-ref-format` guard. |
| 4 | **Branch management modal** (§4) | 1235 `branch`, 261 `for-each-ref` | medium | The dropdown does not scale and cannot host per-branch actions. |
| 5 | **Amend last commit** | 4160 `commit` | **cheap** | One checkbox in `CommitBox` → `['commit', '--amend', '-m', msg]`. Extremely common, one line of state. Needs `--amend` to not run with an empty index (it would rewrite the message only — arguably fine, but should be a stated choice). |
| 6 | **Stash list / push / pop / drop** | 2784 | medium | The third-most-used verb in the corpus and the natural partner of the conflict work: `stash pop` is the one conflict shape with no operation file (§2.3). A small list with 4 buttons, one new topic or one actionType each. |
| 7 | **Branch delete** (§4.3) | 25 `-d` | cheap | Rides the branch modal. |
| 8 | **Tag list + create** | 605 | medium | `git tag` is common but the corpus is mostly *listing* tags; a create-tag dialog is a real surface (annotated vs lightweight, message, push). Defer. |
| 9 | **Blame** | 144 | medium | Needs a per-line attribution read and a rendering mode in the editor that does not exist. Defer. |
| 10 | **Interactive rebase** | 327 | **expensive** | A todo-list editor, a sequencer state machine, and its own conflict handling. Explicitly out of scope. |

Two more that are worth naming as *not* recommended, because they look cheap
and are not:

- **`git add -p` (partial staging).** The corpus shows 4576 `add` and 467
  `apply`; interactive staging is a per-hunk UI over the diff panel that already
  exists, but it needs a hunk-selection model the `parseUnifiedDiff` output does
  not carry (it produces flat lines and paired rows, not addressable hunks).
- **`git worktree`.** 588 invocations, but they are the agent's own sandboxing,
  not a workflow the panel's single-working-tree model can express.

---

## 6. Cross-cutting risks

**R1 — `ours`/`theirs` inversion (§2.4).** The single highest-value detail in
this document. A "Take ours" button that silently takes the other side during a
rebase is worse than no button. Labels must be derived from the conflict
markers, not from the words ours/theirs.

**R2 — The editor blocks.** Every `--continue` and every concluding commit must
spawn with `GIT_EDITOR=true` **and** prefer `--no-edit`. Both failure modes were
reproduced: `Terminal is dumb, but EDITOR unset` (fails) and an inherited
`GIT_EDITOR=vim` (hangs to timeout). `runGit` already sets `GIT_TERMINAL_PROMPT=0`
for the analogous reason; this is the same fix for the same class of bug.

**R3 — Detached HEAD is already mislabelled and the branch modal makes it
worse.** Measured: a detached checkout reports `branch: "HEAD"` and
`branches: ["HEAD", "main"]` — the literal string `HEAD` is offered as a branch
you can check out. The branch modal is where this becomes visible, so the state
read should carry `detached: true` and the modal should say
`HEAD (detached at 2b36741)` with no rename/delete.

**R4 — `revertPath` must refuse conflicted paths.** Otherwise the trash icon
keeps destroying the conflict and leaving the merge open (§1d). One guard:
`if (state.conflicts.includes(file)) throw new Error('This file is conflicted — resolve or take a side first.')`.

**R5 — Destructive verbs must not be one click.** The panel's existing
`ConfirmActionModal` covers discard. Branch delete (`-d` then an explicit `-D`)
and merge abort are the two new ones that need it. Note that omp's own bash tool
has a `bash.gitGuard` setting for exactly this ("Refuse git commands that
discard or move shared work…: stash, reset --hard … and checkout/switch/restore
outside a merge or rebase conflict") — the panel is the other surface where the
same care applies, and the setting's own wording is a good spec for which
actions deserve a confirmation.

**R6 — `merge_commit` argv (§1e).** Add `--` and a hash-shape guard.

**R7 — The realtime topic carries the new field for free, but only if
`readGitStatus` is the one place that reads it.** Both the HTTP route and the
`git:` topic resolver already call `readGitStatus` (the module header says so,
and `topics/workspace.server.ts:52-58` confirms). The state read must go there
and nowhere else, or the panel and the topic will disagree about whether a merge
is in progress — the exact drift that header exists to prevent.

---

## 7. Phasing

Each phase is independently shippable and independently verifiable.

**Phase 1 — correctness (no new features).**
`readGitState` + `state` on the payload; unmerged status codes and labels;
Conflicts section in the list; `revertPath` refusal; `GIT_EDITOR=true` on
`runGit`; `--`/hash guards. Verification: the deleted-and-replaced
`git-status.test.ts` table, a new `git-state.test.ts` driving a real conflicted
repository, and a browser check that a `UU` file is listed once under
"Conflicts".

**Phase 2 — merge as a feature.**
Merge bar (count, abort, continue), per-file take-ours/theirs/mark-resolved with
marker-derived labels, `merge_branch` from the dropdown. Verification: a real
merge conflict resolved through the UI, then `git log` shows a real merge commit
and `MERGE_HEAD` is gone.

**Phase 3 — branch management.**
Extended `for-each-ref`, the modal, rename (local + optional remote),
delete (`-d` with an explicit `-D` fallback). Verification: rename a branch with
an upstream and confirm the upstream line in the dialog matches
`git branch -vv`; publish a remote rename against a bare-repo fixture and
confirm `--prune` removed the old tracking ref.

**Phase 4 — the cheap wins.**
Fetch button, amend checkbox. Each is one actionType plus one control.

Phases 1 and 2 are one coherent change (a conflicted repository is untestable
without the state read), so they can ship together. Phases 3 and 4 are
independent of both and of each other.

---

## 8. Open questions for the author

1. **Remote rename default.** Plan says off-by-default with the three commands
   spelled out. If the intent is "rename the branch, and I do mean everywhere",
   the checkbox should default on for a branch whose upstream name equals the
   old name.
2. **Stash in scope?** 2784 invocations, and it is the natural companion to the
   conflict work — but it is a fourth surface (list, push, pop, drop) in a panel
   that already has three (toolbar, commit box, changes list, plus two modals).
3. **Conflicts section placement.** Above Staged (proposed) or in place of the
   whole list while an operation is live? The latter is more honest but hides
   the rest of the working tree, and a merge is often exactly when you want to
   see it.
