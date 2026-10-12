import { runShell, shellOk } from '@/server/lib/fs/shell';

/**
 * Ahead/behind counts behind the git panel's Sync button.
 *
 * `git rev-list --left-right --count HEAD...@{upstream}` counts against the
 * LOCAL remote-tracking ref, and that ref only moves on fetch/pull/push.
 * Nothing in the chamber ever fetched, so `behind` reported the state of the
 * last fetch rather than the remote: the badge sat at ↑0 ↓0 while origin had
 * commits to pull, and the button — disabled by that very zero — could never
 * correct itself.
 *
 * A read that asks for counts therefore refreshes the tracking ref first. The
 * refresh is TTL'd so the git panel's 5s poll is not a 5s fetch loop, it is
 * shared across the panels polling the same repo, and the loader starts it
 * before its local git probes so the round trip overlaps instead of adding up.
 */

/** How long a fetch attempt — success or failure — is trusted. */
const FETCH_TTL_MS = 60_000;
/**
 * How long a read waits for the fetch before answering from the tracking ref
 * as it stands. A slow or offline remote must not stall the panel; the fetch
 * keeps running under its own budget and a later read picks up the new ref.
 */
const FETCH_WAIT_MS = 3_000;
/** Hard budget for one fetch; it is killed at the end of it. */
const FETCH_TIMEOUT_MS = 15_000;

export interface GitSyncCount {
  ahead: number;
  behind: number;
}

interface RemoteState {
  /** When the last attempt settled; `0` means never attempted. */
  at: number;
  /** The running attempt, so concurrent reads share one fetch. */
  inFlight: Promise<void> | null;
}

const remoteStates = new Map<string, RemoteState>();

function stateFor(cwd: string): RemoteState {
  let state = remoteStates.get(cwd);
  if (!state) {
    state = { at: 0, inFlight: null };
    remoteStates.set(cwd, state);
  }
  return state;
}

/**
 * Runs one `git fetch` with a hard deadline, returning whether it succeeded.
 *
 * Deliberately not `runShell`: that helper reads stdout and stderr to EOF, and
 * a stalled fetch defeats it — git's own `git-remote-https` child survives the
 * kill and keeps the inherited stderr pipe open, so the read never ends and the
 * promise hangs forever. Verified on Bun 1.4.2: Bun's `timeout` closes stdout
 * but not that inherited stderr, and the orphan lingers. Nothing here reads the
 * fetch's output, so both streams are ignored (no pipe, nothing to hang on) and
 * the process is killed by process group at the deadline — `detached` is what
 * makes the group killable, and the group kill is what stops the helper from
 * accumulating on every stalled attempt.
 */
async function runFetch(cwd: string, remote: string): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ['sh', '-c', `git fetch --quiet --no-tags '${remote.replace(/'/g, `'\\''`)}'`],
    cwd,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    detached: true,
    // Without this a remote that wants credentials blocks on stdin; the fetch
    // then fails instead, and the counts fall back to the tracking ref.
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FETCH_TIMEOUT_MS);
  });
  const exitCode = await Promise.race([
    proc.exited,
    deadline.then(() => {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        // Already gone, or the group could not be signalled: `exited` below
        // still settles, and the ref simply stays as it was.
      }
      return proc.exited;
    }),
  ]);
  clearTimeout(timer);
  return exitCode === 0;
}

/**
 * The branch's upstream remote, or null when it has none. Cheap and local, so
 * the no-upstream case is never cached: configuring an upstream in the terminal
 * shows up on the next read instead of up to a TTL later.
 */
async function readUpstreamRemote(cwd: string): Promise<string | null> {
  try {
    const result = await runShell('git rev-parse --abbrev-ref --symbolic-full-name @{upstream}', {
      cwd,
      timeout: 5_000,
    });
    if (!shellOk(result)) return null;
    const upstream = result.stdout.trim();
    const slash = upstream.indexOf('/');
    return slash > 0 ? upstream.slice(0, slash) : null;
  } catch {
    return null;
  }
}

/**
 * Refresh `cwd`'s remote-tracking refs, awaiting at most `FETCH_WAIT_MS`.
 * Resolves immediately when the last attempt is still inside its TTL, and
 * shares the running attempt when one is already in flight.
 */
export async function refreshRemoteRefs(cwd: string): Promise<void> {
  const state = stateFor(cwd);
  if (state.inFlight) return state.inFlight;
  if (state.at !== 0 && Date.now() - state.at < FETCH_TTL_MS) return;

  const remote = await readUpstreamRemote(cwd);
  if (!remote) return;
  // Reading the upstream is itself an await: another poll may have started the
  // fetch, or completed one, in the meantime.
  if (state.inFlight) return state.inFlight;
  if (state.at !== 0 && Date.now() - state.at < FETCH_TTL_MS) return;

  // The attempt never rejects — a failed fetch is not a broken panel — and
  // always clears `inFlight` so a later read can retry.
  state.inFlight = (async () => {
    try {
      await runFetch(cwd, remote);
    } finally {
      state.at = Date.now();
      state.inFlight = null;
    }
  })();

  // Bounded wait. `AbortSignal.timeout` rather than `Bun.sleep`: it is unref'd,
  // so an abandoned wait cannot hold a live timer open on every read that
  // refreshes.
  const deadline = new Promise<void>((resolve) => {
    AbortSignal.timeout(FETCH_WAIT_MS).addEventListener('abort', () => resolve(), { once: true });
  });
  await Promise.race([state.inFlight, deadline]);
}

/**
 * Marks `cwd` as freshly fetched — a pull/push has already moved the tracking
 * ref, so the next read must not fetch a state it just produced.
 */
export function markRemoteRefsFresh(cwd: string): void {
  stateFor(cwd).at = Date.now();
}

/**
 * Forces the next read to fetch. The counts are per-branch, so a checkout makes
 * whatever the previous branch refreshed irrelevant.
 */
export function invalidateRemoteRefs(cwd: string): void {
  stateFor(cwd).at = 0;
}

/**
 * Ahead/behind against the branch's upstream, read from the local tracking ref
 * (`refreshRemoteRefs` is what makes that ref current).
 *
 * A branch with **no upstream** — a fresh local branch, the common case right
 * after "Create new branch" — has no `@{upstream}` to compare against, and
 * `git rev-list HEAD...@{upstream}` exits 128. Reporting `{ahead: 0}` there is a
 * lie that matters: the badge read `↑0 ↓0` on a branch holding unpushed commits
 * and the Sync button (disabled by that zero, and by the tooltip it drives)
 * could never correct itself. The unpushed commits are counted against the
 * remote-tracking refs instead (`--not --remotes`), so `ahead` is the number of
 * commits the next push would send. `behind` stays 0: without an upstream there
 * is no ref to be behind, and the publish path sets one up.
 *
 * Both zero when git cannot answer at all (not a repository, git missing).
 */
export async function gitSyncCount(cwd: string): Promise<GitSyncCount> {
  try {
    // `git rev-list --left-right --count HEAD...@{upstream}` prints "<ahead>\t<behind>".
    const result = await runShell('git rev-list --left-right --count HEAD...@{upstream}', {
      cwd,
      timeout: 8_000,
    });
    if (shellOk(result)) {
      const [ahead, behind] = result.stdout.trim().split(/\s+/).map(Number);
      return { ahead: ahead || 0, behind: behind || 0 };
    }

    // No upstream (or a detached HEAD): count what a push would send. A
    // repository with no remote at all answers its full history, which is what
    // "nothing has been published" means — and is still the honest number.
    const unpushed = await runShell('git rev-list --count HEAD --not --remotes', {
      cwd,
      timeout: 8_000,
    });
    if (!shellOk(unpushed)) return { ahead: 0, behind: 0 };
    return { ahead: Number(unpushed.stdout.trim()) || 0, behind: 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}
