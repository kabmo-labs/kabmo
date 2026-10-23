# Worktree sessions — Kabmo-owned, UI modelled on OpenChamber

A chat can start in its own git worktree: its own branch, its own folder, its
own omp child. Parallel sessions stop stepping on each other's files.

Status: **plan only, nothing implemented.**

Two decisions up front, and everything below follows from them:

1. **Kabmo owns the worktree, not omp.** No `/wt`, no `omp worktree`. The
   session is *born* in the worktree (`POST /api/agent/new { cwd }`), so nothing
   is ever relocated — which removes the entire class of bugs measured in
   `docs/omp-worktree-research` (stale `wrapper.sessionFile`, a `session_info_update`
   that carries no cwd, `resolveSpawnCwd` silently falling back).
2. **The UI follows OpenChamber's shape.** Same entry points, same three-way
   "Start from", same composer target picker, same delete dialog. Their copy is
   reused nearly verbatim; their *implementation* is not, because they had to
   build it over OpenCode while omp already gives us `cwd`.

Every claim about this repo was read from this tree. Claims marked *measured*
were run on this machine (Bun 1.4.3, git 2.56.0, macOS APFS).

---

## 1. Why not omp's `/wt`

`/wt` already works from Kabmo's composer today (`get_available_commands`
advertises it with `source: builtin`, and `isTuiOnlySlashCommand('/wt')` is
false — verified). It is still the wrong foundation:

| omp `/wt` does | Consequence in Kabmo |
|---|---|
| `session.moveTo()` — rewrites the JSONL header and moves the FILE | `wrapper.sessionFile` stays stale → `reconcileSpawnApprovalMode()` silently no-ops |
| emits `session_info_update` with only `sessionId` | no cwd/branch reaches the client |
| keeps `wrapper.cwd` readonly at spawn value | skill watcher and goal driver keep reading the old checkout |
| carries **all** uncommitted changes | one checkout shared by two sessions loses work to the other |

None of that exists when the session starts in the worktree. `omp --mode rpc-ui
--cwd <worktree>` writes its session under
`…/sessions/--…-worktrees-<slug>--/` with `header.cwd` = the worktree
(*measured*), and `--resume` on that file reports the same cwd and the right
`messageCount` (*measured*).

---

## 2. UI map — what we take from OpenChamber

| Surface | OpenChamber | Kabmo plan |
|---|---|---|
| Project row in sidebar | `node-tree` icon beside the folder name, tooltip `New worktree...` | **row in the existing `⋯` menu** instead — see §3.3 |
| New session composer | branch/worktree `Select` above the input: `Project root`, `Quick worktree`, `New worktree…`, `Worktrees` group | **same**, beside the existing workspace picker in `EmptyWorkspacePrompt` |
| Dialog | two columns on desktop, one on phone: *Start from* + *item picker* | **same** — but only two tabs (no PR/issue) |
| Session row menu | `Move to worktree` submenu + `New worktree...` | **omit** (no relocation) |
| Delete | dialog listing what goes: worktree, sessions, local branch, remote branch | **same**, Kabmo's own ordering (§7) |
| Worktree list | project settings → Worktrees, one row per worktree + delete | **same**, in Settings → Projects → *Worktrees* |
| Status | `worktreeStatus`, `headState`, `attentionReason`, blocking reasons | **partial**: `ready` / `missing` / `detached` only |
| Composer warning | ⚠ icon when the target branch has uncommitted changes | **same** |
| Cleanup | auto-remove worktrees whose PR merged | **omit** (no PR status in scope) |
| Integrate | cherry-pick onto another branch from the Git view | **omit** (Source Control already has merge/rebase) |

Copy reused from OpenChamber's `en.ts` (their strings, our keys):
`New worktree`, `New branch` / `Existing branch`, `A fresh branch, based on the
branch you pick.` / `Check out a branch you already have.`, `Based on`,
`Folder name`, `Reset to match branch name`, `Create worktree`, `Creating...`,
`Quick worktree`, `Worktrees`, and the dirty-branch notice:
*"You have uncommitted changes on this branch. A new session could conflict with
them. You may want to commit them first or use another worktree."*

---

## 3. Screen by screen

### 3.1 New worktree dialog — `src/client/components/workspace/worktree-modal/`

Opened from three places: the folder row's `node-tree` button, the composer's
`New worktree…` row, and Settings → Projects → Worktrees. One component, one
`isOpen` flag per opener; state is NOT reset by an effect (mount the form
fresh — the `NewWorkspaceModal` lesson, where an effect-based reset lost typed
input).

Shell: the shared `common/Modal.tsx` with `maxWidthClass="max-w-[min(96vw,880px)]"`
(two columns need room; the repo modal already uses the same widening).

```
┌ New worktree ─────────────────────────────────────────── ✕ ┐
│                                                             │
│  Start from                    │  Branch name               │
│  ◉ New branch                  │  [ wt/20261023-141502   ]  │
│    A fresh branch, based on    │                            │
│    the branch you pick.        │  Based on                  │
│  ○ Existing branch             │  [ origin/main        ▾ ]  │
│    Check out a branch you      │                            │
│    already have.               │  Folder name               │
│                                │  [ wt-20261023-141502 ⟳ ]  │
│                                │                            │
│                                │  ⚠ 3 uncommitted files in  │
│                                │    this checkout stay here │
├─────────────────────────────────────────────────────────────┤
│  <error line, truncates>       [ Cancel ] [ Create worktree ]│
└─────────────────────────────────────────────────────────────┘
```

Phone (≤ 768 against the panel, `@container` not `sm:`): one column, order
*Start from → Branch → Based on → Folder*, footer buttons stacked full width,
error line above them. `handleWorktreeCreateKeyDown` (Enter submits, IME-safe)
is the same rule OpenChamber extracted into its own file — reimplement as
`submit-on-enter.ts` beside the modal.

**Field rules**

- *Start from* is a radio group of two, `SettingsRadioGroup`-equivalent: a
  bordered stack of rows with a description each.
- **New branch**: `Branch name` is free text; `Based on` is a branch picker
  defaulting to the **remote's default branch** (`origin/main`), never the
  checkout's current branch. OpenChamber's reason applies verbatim: a root
  sitting on a feature branch would carry its unmerged work in.
- **Existing branch**: `Branch name` becomes a searchable picker
  (`BranchPicker`) over local branches then remote ones, with a `Refresh`
  button that re-runs `git for-each-ref`. A branch already checked out in
  another worktree is refused inline, before submit.
- `Folder name` **follows** the branch until the user types in it; the `⟳`
  button re-syncs and is disabled while already in sync. Slug rule:
  `refs/heads/` stripped, `/`→`-`, non-`[A-Za-z0-9._-]`→`-`, collapsed, ≤80.
- The dirty notice is read once when the dialog opens
  (`git status --porcelain` on the project root) and states the truth of our
  design: uncommitted changes stay in the checkout.

**Validation** is server-side and debounced 300 ms after first touch (same
shape as OpenChamber's `validateInputs`), because the answers depend on git
state a client cannot trust: `POST /api/worktrees/validate` returns
`{ ok, errors: [{ code, field, message }] }` with
`branch_exists` | `branch_in_use` | `path_exists` | `not_a_repo` | `no_commits` | `invalid_name`.
Errors land on their field; the footer shows the first one truncated with the
full text in `title` (a footer that grows with a long git message moves the
buttons — OpenChamber pins one line and truncates).

### 3.2 Composer target picker — extend `EmptyWorkspacePrompt`

Today the pending chat shows one picker: `Select Workspace Context` → folders.
It becomes a **target** picker, one dropdown, grouped, exactly the shape
OpenChamber's `DraftTargetSelectors` uses:

```
┌ Project root ───────────────┐
│ ✓ kabmo · main              │
├ Quick worktree ─────────────┤
│ ⚡ Quick worktree           │
│ ⑂ New worktree…             │
├ Worktrees ──────────────────┤
│ wt/20261023-141502          │
│ (no worktree yet)           │
└─────────────────────────────┘
```

- The **project row** is the current behaviour (`folderId`).
- **Quick worktree** creates one immediately with a generated name and selects
  it; the row shows `⏳` while it is being created.
- **New worktree…** opens the dialog (§3.1) with this project preselected.
- **Worktrees** lists the project's worktrees; picking one targets it.
- The trigger reads `folder.name · branch` (or `folder.name` at root).

Selection persists in the session's UI state as `chat.spawnTarget`
(`{ folderId, worktreePath }`) **with a ref mirror**, because the composer is
remounted by a stretch, a tab switch and a reload while the send handler is
created once per deps record — the exact hazard `waiting/choice.ts` documents.
The send path resolves `spawnCwdForNewSession(folders, sessionId, folderId,
worktreePath)` → `worktreePath ?? project_path`.

A click on a folder row *clears* the worktree pick (the picker's groups are
mutually exclusive); a click on a worktree keeps its folder.

### 3.3 Sidebar rows

**Entry point: a row in the folder's existing `⋯` menu, not a third icon.**
OpenChamber draws a `node-tree` button beside the folder name; Kabmo's folder
header has no room for it — measured in this tree, the row is `h-7` and already
holds the disclosure slot, the project icon, the name, a `+` and a `⋯` at 264px
minimum width, and `CategoryHeader`'s own comment records that the actions used
to be hover-only and became always-visible precisely because a sidebar row is
where affordances get lost. A third glyph would either clip at the narrow end or
shrink the name further. So the worktree action is a named row —
`New worktree…` — inside `WorkspaceOptionsMenu`, the one body both layouts
render, with an icon and a label rather than a glyph a reader has to hover.

Everything else follows OpenChamber.

Kabmo already groups a worktree session under its **project** folder, because
`resolveProjectRoot(cwd)` maps a linked worktree back to the main repo root
(*measured*: `/Users/…/.omp/wt/x → /private/tmp/wt-test`). OpenChamber groups by
worktree instead, because OpenCode reports the worktree as the session's
directory.

**We keep Kabmo's grouping and add a badge**, which is the only visible
difference and it is a deliberate one:

```
▾ kabmo
   Fix the socket retry        2m    wt/fix-socket   ⑂
   Refactor panels             1h
   ● 3 changes in this repo
```

- `⑂ wt/fix-socket` — a muted chip after the title, `title` = the absolute
  worktree path, click = reveal in Files.
- A worktree whose folder is gone renders `⑂ wt/x — missing` in the warning
  tone, and its row menu offers **Re-register** (`git worktree prune`) and
  **Open without worktree** (clear the pick, open the session's transcript
  read-only). This is OpenChamber's `missing` + `getSessionWorktreeRepairActions`
  in our vocabulary.
- Detached HEAD shows `detached @ a1b2c3d`.

The badge is data, not a per-layout branch: `SessionItemData.worktree` travels
in the sidebar payload (§5), so desktop, phone and any plugin read one field.

### 3.4 Delete worktree — `worktree-delete-modal/`

Reached from a worktree session's row menu and from Settings → Projects →
Worktrees. Built on `common/Modal.tsx`, `max-w-md`.

```
┌ Remove worktree ────────────────────────────────────── ✕ ┐
│  wt/fix-socket                                           │
│  ~/.kabmo/worktrees/wt-fix-socket                        │
│                                                          │
│  This removes:                                           │
│   • the worktree folder                                  │
│   • 2 chats started here (archived first, then deleted)   │
│                                                          │
│  ☐ Delete local branch wt/fix-socket                     │
│    Disabled: the branch has 3 commits that are not on     │
│    any other branch.                                     │
│                                                          │
│  ⚠ 4 uncommitted files here will be lost.                 │
│                                                          │
│                        [ Cancel ]  [ Remove worktree ]    │
└──────────────────────────────────────────────────────────┘
```

Rules, each from a measured failure:

- **The branch checkbox is disabled, not destructive.** `git branch -d` refuses
  an unmerged branch — *measured*: `error: the branch 'work1' is not fully
  merged`, exit 1. So the checkbox is offered only when every commit is on the
  start ref; otherwise it is disabled with that sentence. `-D` is not offered at
  all in v1.
- **Dirty refuses.** A `git worktree remove` on a modified tree exits 128
  (`contains modified or untracked files`) — *measured*. We do not pass
  `--force`; the dialog states the count and requires the user to move the
  changes out first. (OpenChamber does the same in spirit and only skips its
  confirmation when nothing can be lost.)
- **The remote branch is out of scope** in v1 (no remote tracking story here).

### 3.5 Settings → Projects → *Worktrees*

One row per worktree of the selected project, mirroring OpenChamber's
`WorktreeSectionContent`:

```
wt/fix-socket           ~/.kabmo/worktrees/8c3a91f2/wt-fix-socket   [🗑]
feat/payments checked out here · 2 chats · clean
```

A second line, because it is the question a row of worktrees actually raises:
which branch is held here (and therefore cannot be checked out elsewhere),
how many chats start in it, and whether it is dirty.

with `loading` / `empty` (`No worktrees yet.`) / `not a git repository` states
spelled out, and the delete button only on hover except on touch.

Two fields below the list:

| field | copy | hint |
|---|---|---|
| Worktree location | `Worktree location` | `Where new worktrees are created. Relative paths are resolved against the project; ~ is your home directory.` — the placeholder is the **selected project's resolved default**, e.g. `~/.kabmo/worktrees/8c3a91f2` (the project id is per repository, so the folder differs per project while the setting is one field) |
| Carry ignored files | `Copy ignored files into new worktrees` | `A new worktree gets the project's ignored build folders (node_modules, .venv, target) copied in, so it works without reinstalling.` |

Both are the same rows `omp`'s own panel shows; neither takes effect on an
existing worktree.

---

## 4. Copy

New keys live in one module per area, following the existing
`client/data/settings/*` pattern; no i18n framework is introduced (Kabmo has
none — strings are English literals with comments).

| key | text |
|---|---|
| `worktree.new.title` | New worktree |
| `worktree.new.startFrom` | Start from |
| `worktree.new.mode.new` | New branch |
| `worktree.new.mode.newHint` | A fresh branch, based on the branch you pick. |
| `worktree.new.mode.existing` | Existing branch |
| `worktree.new.mode.existingHint` | Check out a branch you already have. |
| `worktree.new.branchName` | Branch name |
| `worktree.new.branchNamePlaceholder` | feature/my-awesome-feature |
| `worktree.new.basedOn` | Based on |
| `worktree.new.folderName` | Folder name |
| `worktree.new.resetFolderName` | Reset to match branch name |
| `worktree.new.create` | Create worktree |
| `worktree.new.creating` | Creating... |
| `worktree.new.quick` | Quick worktree |
| `worktree.new.custom` | New worktree… |
| `worktree.new.dirtyNotice` | You have uncommitted changes on this branch. A new session could conflict with them. You may want to commit them first or use another worktree. |
| `worktree.new.dirtyStays` | Uncommitted changes stay in {folder}. |
| `worktree.list.title` | Worktrees |
| `worktree.list.empty` | No worktrees yet. |
| `worktree.list.notRepo` | Worktrees need a Git repository. |
| `worktree.list.missing` | Worktree folder is missing |
| `worktree.list.detached` | detached @ {sha} |
| `worktree.delete.title` | Remove worktree |
| `worktree.delete.removes` | This removes: |
| `worktree.delete.folder` | the worktree folder |
| `worktree.delete.sessions` | {count} chats started here (archived first, then deleted) |
| `worktree.delete.localBranch` | Delete local branch {branch} |
| `worktree.delete.branchUnmerged` | Disabled: the branch has {count} commits that are not on any other branch. |
| `worktree.delete.dirtyWarning` | {count} uncommitted files here will be lost. |
| `worktree.delete.confirm` | Remove worktree |
| `worktree.toast.created` | Worktree created |
| `worktree.toast.createdDescription` | {branch} — starting in {folder} |
| `worktree.toast.removed` | Worktree removed |
| `worktree.error.branchExists` | Branch {branch} already exists. |
| `worktree.error.branchInUse` | {branch} is already checked out in {path}. |
| `worktree.error.pathExists` | {path} already exists. |
| `worktree.error.notARepo` | This folder is not a Git repository. |
| `worktree.error.noCommits` | This repository has no commits yet. |

Server sentences reuse git's own where it is clearer (`git` is the authority):
the dialog shows our sentence, the expanded error shows git's.

---

## 5. Data model

### 5.1 `SessionItemData` gains one field

```ts
/** The linked worktree this session runs in, when its cwd is one. */
worktree?: {
  /** Branch checked out there (`refs/heads/` stripped). */
  branch: string;
  /** Absolute path of the worktree root. */
  path: string;
  /** Main checkout this worktree belongs to — the folder's project_path. */
  primaryRoot: string;
  /** `missing` when git reports the entry prunable, or the directory is gone. */
  status: 'ready' | 'missing';
  /** HEAD is not on a branch. */
  detached: boolean;
};
```

Populated in `buildRealFolders` (`session/sidebar-data.server.ts`), where
`resolveProjectRoot` is already computed per cwd: one cached
`git worktree list --porcelain` per primary root (TTL 10 s, invalidated by our
own mutations and by `workspace-dirty`) answers every session of that project.
No client-side git, no per-row spawn.

### 5.2 `GET /api/worktrees` — the list surface

```
GET /api/worktrees?root=<project path>&repo=<rel>
→ { worktrees: WorktreeInfo[], base: string, isRepo: boolean, pending?: boolean }

interface WorktreeInfo {
  path: string;
  branch: string;
  detached: boolean;
  missing: boolean;           // prunable, or the directory is gone
  isPrimary: boolean;         // the checkout itself — never removable
  dirty: number;              // changed + untracked count
  aheadOfStart: number;       // commits not on the start ref
  startRef: string;           // recorded when we created it, else ''
  sessions: number;           // chats whose cwd is inside
}
```

Read on mount and after each mutation — **not** on a realtime topic. It costs a
`git` spawn per worktree, exactly the reasoning `git-repo-details.ts` records
for keeping the repo modal off the `git:` topic, which republishes on every
tool call.

### 5.3 Where worktrees land — copied from OpenChamber

OpenChamber's rule (`git/service.js` `resolveWorktreeProjectContext`, and
`opencode/worktree-directory.js`), adopted as-is:

```
root = configured worktree.directory (resolved)   ||  <data dir>/worktrees/<projectID>
path = <root>/<name>
```

- **`projectID` is the repository's identity, not a hash of its path**: the
  first root commit — `git rev-list --max-parents=0 --all`, sorted, first line.
  Two clones of one repository therefore share a folder key
  (*measured*: two clones of one bare repo both answer
  `c2738d53a7504e473a4ce80d3239761ed5d07bbd`), and a renamed checkout does not
  lose its worktrees.
  - **The derivation is not stable on its own, which is why OpenChamber caches
    it.** *Measured*: adding a branch with unrelated history (`git checkout
    --orphan`) inserts a second root, and the sorted-first value MOVED from
    `c2738d…` to `0639af…`. OpenChamber writes the first answer into
    `<primary>/.git/opencode` and never derives again.
  - **Kabmo does not write into the user's `.git`, so our table IS the cache**
    (§9), with one extra rule the cache would otherwise hide: a stored
    `project_id` for the same `primary_root` is reused, and the derivation only
    runs when there is none. A repository that gains an orphan branch keeps its
    folder; a clone that arrives later still derives the same value as its
    sibling and lands beside it. An unborn repository has no root commit at all
    (*measured*: the command prints nothing), which is the `no_commits` refusal
    of §6.1 step 3, not a crash.
- **Default root is `<data dir>/worktrees`, keyed per repository**
  (`~/.kabmo/worktrees/<projectID>/<name>`). Outside every checkout, so nothing
  shows up as `?? .worktrees/` in `git status` (*measured*), and two projects
  cannot collide on a worktree name.
- **The setting is a parent directory, never the worktree itself** — the name is
  always appended. Same three spellings:
  - relative (`../wt`, `.worktrees`) → resolved against the **canonical
    checkout**, so a linked worktree still reads the project's own setting;
  - absolute → used as-is (`/Volumes/work/wt`);
  - `~` / `~/x` → the home directory.
- A configured root may be **shared** (`..` is the repository's parent, holding
  sibling projects). Removal therefore deletes a directory inside it only when
  git listed it as one of this repository's worktrees (§6.2 step 3).
- **The name is the folder, and by default it follows the branch** —
  OpenChamber's rule, adopted:

  | path | branch | folder |
  |---|---|---|
  | dialog, new branch | the field, pre-filled `wt/<adjective>-<noun>` | `slug(branch)` with our own `wt/` namespace stripped — `wt/cosmic-dolphin` → `cosmic-dolphin`, `feat/x` → `feat-x`; until the user edits *Folder name* |
  | dialog, existing branch | that branch, checked out as-is | same rule |
  | Quick worktree | `wt/<adjective>-<noun>` | `<adjective>-<noun>` |

  So a folder never starts with `wt-`, and the repository's own namespaces
  (`feat/`, `fix/`) stay visible in the folder that holds them. The word pairs
  are OpenChamber's Ubuntu-style lists (33 adjectives × 29 nouns), and the pick
  is seeded from `crypto.randomUUID()`, not `Math.random`.

  Kabmo's prefix is `wt`, not OpenChamber's `openchamber`: omp's own `/wt`
  already creates `wt/*`, so a repository that has used either tool reads one
  convention instead of two. The prefix is applied to the **generated default
  only**; a branch the user types is used verbatim, and `slug()` is what keeps
  the folder a single path segment (`feat/x` → `feat-x`).

  A generated name is checked against **both** the folder and the branch
  (`wt/<name>`), so a quick worktree can never end up with a branch and a folder
  that disagree about which one is "the" name.

| key | where | default |
|---|---|---|
| `worktreeDirectory` | `kabmo_settings` blob | unset → `<data dir>/worktrees/<projectID>` |
| `worktreeCarryIgnored` | `kabmo_settings` blob | `true` |

`getDataDir()` already exists (`server/lib/lifecycle/paths.ts`, honouring
`KABMO_DATA_DIR`), which is Kabmo's `XDG_DATA_HOME`-equivalent.

### 5.4 Session UI state

| key | shape | why |
|---|---|---|
| `chat.spawnTarget` | `{ folderId: number; worktreePath: string \| null }` | the pending chat's target, survives a reload |
| `workspace.worktreeFilter` | `'all' \| 'session'` | list surface preference (later) |

---

## 6. Server: creation, carry-over, removal

### 6.1 Create — `POST /api/worktrees`

```
POST /api/worktrees?root=<project path>
{ branch, startRef?, worktreeName?, mode: 'new'|'existing' }
→ { worktree: WorktreeInfo } | { error, code, field }
```

Steps, in order, each a named refusal:

1. `resolveRoot(root)` — a client-supplied root is already gated by the
   app-root / registered-`project_path` allow-list.
2. `resolveProjectRoot(root)` → primary root. Refuse `not_a_repo`.
3. `git rev-parse --verify HEAD` → refuse `no_commits` (*measured*:
   `git worktree add` answers `object not found: HEAD`).
4. `git show-ref --verify refs/heads/<branch>` → `branch_exists`.
5. `git worktree list --porcelain` → `branch_in_use` (*measured*: git's own
   `'refs/heads/feat2' is already checked out`, and it refuses only after
   printing `Preparing worktree`).
6. Resolve the destination exactly as OpenChamber does:
   - `projectID` from `git rev-list --max-parents=0 --all` (sorted, first) —
     no `.git/opencode` write; cached in the `worktrees` project row.
   - root = the resolved `worktreeDirectory` setting, else
     `<data dir>/worktrees/<projectID>`.
   - name = slug of the dialog's *Folder name* (or of the generated name for
     Quick worktree). **Collisions are resolved, not refused**: try the slug,
     then `<slug>-<adjective>-<noun>`, up to 26 attempts — skipping a candidate
     whose directory exists *or* whose branch (`<prefix>/<name>`) already
     exists — and only then report `path_exists`. OpenChamber's word lists are
     copied (`adjectives`, `nouns`); the seed is `crypto.randomUUID()`'s first
     four bytes so the pick is not `Math.random`-repeatable.
   - refuse `path_exists` outright only for an **explicitly requested path**
     (never for a generated name). (*measured*: git exits 128 with
     `already exists`, after printing `Preparing worktree` — so the check has to
     happen before the branch is created.)
7. `git worktree add -b <branch> <path> <startRef>` (or plain
   `<path> <branch>` for `existing`), with `-c core.longpaths=true` and
   `-c core.hooksPath=<NUL|/dev/null>` on the argv — the data-dir prefix plus a
   nested repo path exceeds Windows' 260-char `MAX_PATH`, and OpenChamber
   carries the same two flags for the same reason (their issue #2746).
   Always argv, always through `runGit` with `GIT_ENV`.
8. **Carry-over (Kabmo's own step).** Plain git does **not** copy ignored
   files (*measured*: a repo with `node_modules` + `.gitignore` yields a
   worktree containing only the tracked files). So Kabmo copies the paths
   `git check-ignore` names as ignored and that exist — `node_modules`,
   `.venv`, `target`, `dist`, `.next`, `.turbo`, plus `.env*`. Mechanism per
   platform: `cp -cR` on APFS (*measured*: 2.1 MB in 3 ms, distinct inodes),
   `cp --reflink=auto -R` on Linux, `robocopy /MIR` on Windows.
   `git status` in the new worktree stays clean afterwards (*measured*).
   This is the one capability lost by not calling `omp worktree add`, so it is
   implemented here rather than dropped.
9. Record `{ path, branch, startRef, primaryRoot, createdAt }` in
   `app_settings`-backed table `worktrees` (§9) — `startRef` cannot be
   recomputed later, and `aheadOfStart` needs it.
10. `emitRealtimeSignal('sidebar-structure')` so every sidebar re-reads.

Response is the same `WorktreeInfo` the list returns, so the client adopts it
without a second read.

**Uncommitted changes are never carried.** Their edits are indistinguishable
from another session's in the same checkout; a `stash`+`apply` is a repo-wide
operation that can steal them. The dialog says so before the click
(`worktree.new.dirtyStays`).

### 6.2 Remove — `DELETE /api/worktrees`

```
DELETE /api/worktrees?root=<project path>
{ path, deleteBranch?: boolean }
→ { removed: true, branchDeleted: boolean, archived: string[] } | { error, code }
```

Order is load-bearing and is **the reverse of OpenChamber's**:

1. For every live session whose cwd is inside `path`: `destroyAndWait(child)`.
   A child still holding a deleted cwd is the failure `resolveSpawnCwd`
   papers over by silently falling back to the server's own directory.
2. Archive then delete those sessions (`removeSession`, the shared flow the
   batch delete and `DELETE /api/sessions/:id` already use).
3. `git worktree remove <path>` — **without `--force`**; a dirty tree refuses
   (exit 128, *measured*) and the refusal is reported with the count.
   When the destination sits in a **configured** (possibly shared) root, the
   path is only touched because `git worktree list --porcelain` named it as one
   of this repository's worktrees — a directory under a shared parent is never
   removed on our own authority (OpenChamber's `isManagedOrphan` rule, adopted).
   A path inside the data-dir root is ours alone and may be cleaned even after
   git stopped tracking it.
4. `git worktree prune`.
5. `deleteBranch` → `git branch -d <branch>` only. A refusal
   (*measured*: `not fully merged`) is reported as `branch_kept`, not as a
   failed removal — the worktree is already gone by then.
6. Delete the `worktrees` row; `sidebar-structure`.

### 6.3 Validate — `POST /api/worktrees/validate`

Runs steps 2–6 of §6.1 without touching disk, returns every error rather than
the first, and is what the dialog's debounce calls.

### 6.4 `resolveRoot` gains worktree roots

Today `resolveRoot('/Users/…/.omp/wt/x')` returns the fallback (*measured*),
so every right panel silently points at the app root. New rule, one branch:

> a candidate is allowed when it exists **and**
> `resolveProjectRoot(candidate)` equals a registered `project_path`.

That is narrow (still requires a real registered project), resolves symlinks
the same way the allow-list already does, and admits both our worktrees and a
subdirectory of a registered checkout — which the app-root rule already allows
for the app root itself.

### 6.5 Effective root reaches the panels

`desktop-layout/index.tsx` computes `activeProjectPath = activeProject.project_path`.
It becomes `activeScopeRoot`:

```
session's own worktree path (from SessionItemData.worktree, when status === 'ready')
  ?? folder.project_path
```

Every consumer keeps reading one prop: `WorkspacePanels`, `useFileTabs`,
`ActivityBar`'s git dot, `composerRootFor` (the `@` picker), the wiki/terminal/
search panels and `PluginBootstrap`'s `workspacePath`. `workspace.activeRepo` is
stored as `{ root, repo }`, so a root change invalidates the pick by
construction — no reset effect to order.

---

## 7. File layout

All new modules stay under the 350-line ceiling by construction.

```
src/shared/lib/workspace/worktree/
  branch-name.ts      default `wt/<adjective>-<noun>` (the word lists), slugify,
                      prefix stripping, mirror of the server's guard
  location.ts         display of the resolved root; the three spellings' help text
  draft.ts            the form state machine: branch↔folder sync, dirty notice, touched state
  labels.ts           badge text, `detached @ <sha>`, `missing` suffix
  types.ts            WorktreeInfo, WorktreeError codes, SpawnTarget

src/server/lib/fs/worktree/
  project-id.server.ts  `rev-list --max-parents=0 --all` → repository identity, cached
  location.server.ts    the §5.3 rule: configured-or-default root, name candidates,
                        collision/attempt loop, `~` and relative resolution
  list.server.ts        `git worktree list --porcelain` parse + cache (TTL 10s, globalThis slot)
  create.server.ts      the ten steps of §6.1
  remove.server.ts      the six steps of §6.2, refusing to force
  validate.server.ts  §6.3
  carry.server.ts     ignored-path carry-over per platform
  branch-guard.ts     `show-ref`, `check-ref-format --branch`, in-use lookup
  topology.server.ts  session cwd → WorktreeInfo (longest-prefix), used by the sidebar

src/server/lib/db/worktree-registry.server.ts   the `worktrees` table (§9)

src/server/routes/worktrees/
  index.ts            HandlerBinding[] — list BEFORE the `:path` shaped verbs
  list.ts             GET
  create.ts           POST
  validate.ts         POST
  remove.ts           DELETE

src/client/components/workspace/worktree-modal/
  index.tsx           shell, footer, two-column body
  StartFromField.tsx  the radio stack
  BranchField.tsx     free text OR the picker, per mode
  BranchPicker.tsx    searchable dropdown (desktop) / sheet (phone)
  FolderField.tsx     input + reset-to-match button
  submit-on-enter.ts  Enter submits, IME-safe

src/client/components/workspace/worktree-delete-modal/
  index.tsx
  RemovalsList.tsx    "This removes:" block

src/client/components/layout/session-sidebar/
  WorktreeBadge.tsx   the `⑂ wt/x` chip (row + header)

src/client/components/settings/categories/project-settings/
  WorktreeSettings.tsx        base dir + carry toggle
  WorktreesTab.tsx            the list (§3.5)
  WorktreeRow.tsx

src/client/hooks/workspace/worktree/
  list.ts             read + refresh
  create.ts           dialog submissions, toast, adopt
  remove.ts           the delete dialog's run
  spawn-target.ts     `chat.spawnTarget` + ref mirror (the `waiting/choice.ts` shape)
```

Modal placement: `workspace/` rather than `session-sidebar/`, because three
surfaces open it and two of them are not the sidebar.

---

## 8. Phases

Each phase is shippable and verifiable on its own.

### Phase 0 — the correctness half (no new UI)

Nothing in this phase is optional; without it a worktree session's panels point
at the wrong tree.

1. `resolveRoot` accepts a candidate whose `resolveProjectRoot` is a registered
   project root (§6.4).
2. `SessionItemData.worktree` + the cached topology read; `activeScopeRoot`
   replaces `activeProjectPath` (§6.5).
3. `resolveProjectRoot`'s cache is invalidated by `workspace-dirty` and by our
   own create/remove.

*Acceptance:* a session manually started in an existing worktree
(`omp --cwd <wt>`) opens Files/Search/Git/Terminal at that worktree, its
sidebar row carries the branch badge, and no panel reports the main checkout.

### Phase 1 — create a session in a worktree

4. `POST /api/worktrees` (new branch only) + `validate`.
5. Composer target picker with **Quick worktree** and **New worktree…**
   wired to a minimal dialog (branch name + based-on + folder name).
6. Spawn: `spawnCwdForNewSession` honours the pick; the first prompt lands in
   the worktree; `chat.spawnTarget` survives a reload.

*Acceptance:* clicking Quick worktree and sending produces a session whose
`header.cwd` is the new worktree, whose first `bash` runs there, and whose
sidebar row shows the branch. Two chats in two worktrees of one project can
edit the same file without touching each other.

### Phase 2 — the dialog complete

7. Existing-branch mode with `BranchPicker` + refresh.
8. Field-level validation, debounced, error line in the footer.
9. Dirty notice; ignored-file carry-over with its own setting.

*Acceptance:* a branch already checked out is refused inline before submit; a
repo with `node_modules` yields a worktree where `bun run dev` works without an
install, and `git status` there is clean.

### Phase 3 — list, delete, repair

10. `GET /api/worktrees`, Settings → Projects → Worktrees.
11. `DELETE /api/worktrees` in the §6.2 order; the delete dialog.
12. `missing` / `detached` badges, **Re-register** (`worktree prune`) and
    **Open without worktree**.

*Acceptance:* deleting a worktree with two chats stops both children, removes
both rows, then the folder; deleting one with uncommitted changes refuses and
names the count; a folder deleted outside Kabmo shows `missing` and Re-register
clears it.

### Phase 4 — polish (only if Phase 3 lands well)

13. Worktree badge click → reveal in Files.
14. `⏳` pending state while a worktree is being created.
15. Per-worktree cleanup of stale entries in Settings (a `Prune` action).

**Not in scope:** moving an existing session into a worktree, integrate/
cherry-pick, PR-merged auto-cleanup, multi-run isolation, `setupWorktree`
bootstrap commands.

---

## 9. Storage

```sql
CREATE TABLE IF NOT EXISTS worktrees (
  path          TEXT PRIMARY KEY,   -- absolute, canonical
  primary_root  TEXT NOT NULL,
  project_id    TEXT NOT NULL,      -- root commit sha: the repository's identity
  branch        TEXT NOT NULL,
  start_ref     TEXT NOT NULL,      -- recorded at creation; cannot be recomputed
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS worktrees_primary ON worktrees(primary_root);
CREATE INDEX IF NOT EXISTS worktrees_project ON worktrees(project_id);
```

Additive; created by `initSchema` beside the BTW and schedule tables.

Why a table at all: `start_ref` is the only thing git cannot answer later, and
`aheadOfStart` (which gates the branch checkbox) depends on it. `project_id`
rides along for two reasons — the default root is keyed by it, and the
derivation is the only part of §5.3 that is not stable on its own.

**Our table is the identity cache, and it is the row that makes the key
stable.** OpenChamber writes the same value into `<primary>/.git/opencode` and
never derives again; Kabmo does not put its own file inside someone's `.git`, so
the reuse rule is the equivalent: `SELECT project_id FROM worktrees WHERE
primary_root = ? LIMIT 1` before deriving. A repository with no worktree rows
yet has no folder to protect, so deriving then is safe — and the row written by
that very creation protects it from then on.

---

## 10. Tests

Unit (`bun test`), each naming the rule it protects:

| file | protects |
|---|---|
| `shared/lib/workspace/worktree/branch-name.test.ts` | default name shape (`wt/<adjective>-<noun>`); slug rules; our `wt/` prefix is stripped from the folder while a repo's own `feat/` is kept as `feat-`; the ASCII-only branch (`测试分支`) falls back to the generated name instead of an empty folder |
| `shared/lib/workspace/worktree/location.test.ts` | the help text's three spellings; a slug never escapes the resolved root |
| `shared/lib/workspace/worktree/draft.test.ts` | folder follows branch until edited; reset re-syncs; switching mode keeps each tab's fields |
| `server/lib/fs/worktree/list.server.test.ts` | porcelain parse: prunable → `missing`, no `branch` line → `detached`, primary flagged |
| `server/lib/fs/worktree/create.server.test.ts` | every refusal code, in order, against a real repo in a temp dir; branch is created only after the path check |
| `server/lib/fs/worktree/carry.server.test.ts` | ignored files copied, tracked files untouched, `git status` clean afterwards |
| `server/lib/fs/worktree/remove.server.test.ts` | dirty refuses and keeps the row; clean removes; branch deleted only when unmerged-count is 0 |
| `server/lib/fs/worktree/topology.server.test.ts` | session cwd → worktree by longest prefix; a session in the main checkout gets none; a missing worktree still resolves |
| `server/lib/fs/fs-path.test.ts` (extend) | a worktree of a registered project is allowed; an unrelated repo is not |
| `server/lib/fs/worktree/project-id.server.test.ts` | two clones of one repository share the identity; a renamed checkout keeps it; a repo with no commits reports its own code, not a crash; **a stored value beats a re-derivation** (an added orphan branch must not move an existing repository's folder) |
| `server/lib/fs/worktree/location.server.test.ts` | the three spellings (`../wt`, `/abs`, `~/x`); a relative root resolves against the canonical checkout, not the worktree; the name is always appended; a taken name becomes `<slug>-<word>-<word>`, never a refusal |
| `server/lib/omp/session/sidebar-data.worktree.test.ts` | the payload carries `worktree` for the right rows and only those |

Browser (`tests/e2e/specs/worktree.e2e.ts`, `real` mode with a seeded repo):

- Quick worktree → send → the sidebar badge appears and the transcript's first
  `bash` reports the worktree path.
- New worktree dialog: existing branch already checked out → inline refusal,
  Create disabled.
- Delete: dirty refuses with the count; clean removes the folder from disk
  (asserted with `fs.existsSync`, not on the dialog's own text).

---

## 11. Risks

- **A worktree starts from a clean commit.** A chat opened mid-work does not see
  it. Stated in the dialog, never discovered by the agent answering "that file
  does not exist".
- **One branch, one worktree.** git refuses a second checkout; the refusal must
  name the worktree that holds it, because "already checked out" alone reads
  like a Kabmo bug.
- **Clone-carry is macOS-cheap and Linux/Windows-expensive.** Progress, not a
  spinner that hangs.
- **The default root is deep, and Windows pays for it.** `<data>/worktrees/<sha>/<name>`
  plus a nested repository file exceeds `MAX_PATH`; `-c core.longpaths=true` and
  `-c core.hooksPath=<NUL|/dev/null>` ride the `worktree add` argv for that
  reason (the same two flags OpenChamber carries, their issue #2746).
- **A configured root can be shared.** `worktreeDirectory: ..` points at a
  directory full of sibling projects, so removal only ever touches a path git
  listed as this repository's worktree (§6.2 step 3) — never a name we
  reconstructed ourselves.
- **The location setting lives in Kabmo, not omp.** omp's own `worktree.base`
  and `omp worktree clear` keep pointing at `~/.omp/wt`; the two sets of
  worktrees are separate on disk and neither tool sees the other's. That is
  deliberate (no omp involvement), but it must be said in the settings hint so
  a user running both does not expect one list.
- **Worktrees outside the project.** `resolveRoot` (§6.4) is what makes the
  configured root readable; do not widen it to a path prefix, which would turn a
  registered project into a filesystem grant.
- **A worktree removed outside Kabmo.** Sessions inside it keep a cwd that no
  longer exists; the `missing` badge plus `resolveSpawnCwd`'s fallback is a
  silent wrong-place spawn unless the row says so first.

## 12. What the port found — seven rules, not footnotes

Each of these was a working-looking implementation that did the wrong thing. They
are written as rules because each one is a shape that will be reintroduced by the
next person who writes this code from the plan above.

1. **A slug is not a path segment until it is checked.** `slug('..')` returns
   `..`, and `path.join(root, '..')` escapes the root — so a branch name of `..`
   created a worktree one directory ABOVE the configured root, and removal then
   had a path git never listed. `slugWorktreeName` rejects `.`, `..` and empty.
   OpenChamber's own slug has the same hole.

2. **`git worktree add` puts the PATH first.** For an existing branch the grammar
   is `worktree add <path> <commit-ish>`; writing
   `worktree add <branch> <path>` makes git read the path as a commit-ish and
   fail with `fatal: invalid reference: /data/worktrees/…`. A NEW branch is
   `worktree add [-b <new>] <path> [<commit-ish>]`. Two shapes, and the branch's
   position differs between them.

3. **`-c` takes one pair per flag.** `['-c', a, b, 'worktree']` makes git read
   `b` as the subcommand: `git: 'core.hooksPath=/dev/null' is not a git command`.
   Every create failed, and the failure named a config value rather than the
   argument list. Build the argv by flat-mapping one `-c` per pair.

4. **A path that does not exist still has to canonicalize.** A `missing` worktree
   cannot be `realpath`'d, so it never matched git's entry and was reported as
   `missing` forever — including one that had merely been pruned. `canonicalPath`
   resolves the nearest EXISTING ancestor and re-appends the tail.

5. **One spelling of a path, everywhere.** `create` answered `/tmp/…` while
   `git worktree list` answered `/private/tmp/…` on macOS, so the freshly created
   row did not match its own list entry and the topology cache missed its
   invalidation. Every path that crosses a boundary is canonicalized on the way
   out AND on the way in.

6. **The typed branch is explicit in BOTH modes.** `resolveTargetDirectory` was
   handed `explicitBranch: existing ? requested : null`, so a branch typed for a
   NEW worktree was treated as generated: `分支/测试` silently became
   `wt/lucid-toucan`. A branch the user typed is theirs; only an EMPTY field
   means "generate one".

7. **Validate the RAW name, never the normalized one.** `normalizeBranchName`
   turns spaces into dashes, so validating its output let `has space` through as
   the valid `has-space` — a branch nobody asked for, created without a refusal.
   Normalization strips a ref prefix and nothing else; validity is decided on
   what was typed.

## 13. What is deliberately NOT in this port

- **Integrate / cherry-pick a worktree's branch back.** It is the other half of
  the workflow and it is a merge surface, not a create surface.
- **Auto-cleanup of worktrees whose PR merged.** Needs a forge client and a
  policy for what "merged" means when there is no PR.
- **`setupWorktree` (run `bun install` on create).** The carry-over makes the
  worktree usable; a bootstrap script is a second, slower answer to the same
  question and it belongs behind a setting of its own.
- **Multiple concurrent runs inside one worktree.** Nothing in this port prevents
  it, and nothing coordinates it either.
