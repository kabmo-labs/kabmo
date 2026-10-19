/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Command Runner's server half: the RPC surface, the log route, and the run
 * registry's lifetime.
 *
 * ## `start` takes a command ID, never a command line
 *
 * The id is `<file>#<kind>:<name>` and it is re-resolved against a FRESH scan
 * here to build the argv. A client-supplied shell string would make this route a
 * remote-command-execution endpoint reachable by anything holding the session
 * cookie; an id can only name a command that exists in a file the user's
 * repository already has.
 *
 * ## The one command source that IS free text, and the rule that keeps it safe
 *
 * A user's own command (`custom:<recordId>`) is arbitrary text, because that is
 * what the feature is. The rule is therefore about WHO supplies it: `start`
 * still takes an ID, and the text is read back out of the user's OWN storage
 * server-side. There is no method that takes a command line, so a client cannot
 * run a string it invented — it can only run something the user already saved
 * through the panel. A custom command runs as `sh -c <text>`, which is what the
 * user wrote, and it is the only place in this plugin that a shell is involved.
 *
 * ## The registry is per load, and `onDispose` is what makes a reload safe
 *
 * A run is a detached child, and a detached child outlives its parent by
 * definition. So disposal kills every run, and Kabmo's shutdown path calls
 * it — otherwise a `SIGTERM` to the server would leave every dev server this
 * plugin started still running.
 *
 * ## The scan runs on the request thread, bounded
 *
 * Depth 4 and 200 files. An unbounded walk of a large repository would hold the
 * request open for as long as the tree takes, which is why the caps exist and why
 * hitting one is reported rather than silently truncating.
 */

import type { KabmoPluginApi } from '@kabmo-labs/kabmo-sdk';

import type { Scope } from './server/scan';
import { RunRegistry } from './server/runner';
import { scopeKeyOf } from './server/run-store';
import { CustomCommandStore } from './server/custom';
import { startRun, withCustom } from './server/resolve';
import {
  RPC,
  type CommandListing,
  type CustomCommand,
  type CustomListing,
  type RunLog,
  type RunnerState,
} from './protocol';

/** The largest tail one log read returns, whatever the client asks for. */
const MAX_TAIL_BYTES = 1024 * 1024;

/** The plugin's server half. */
export default function plugin(api: KabmoPluginApi) {
  const registry = new RunRegistry({
    // The topic payload crosses a JSON boundary, so the plugin's own interface is
    // widened at exactly one place rather than the whole model being indexable.
    publish: (state) => api.realtime.publish(state as unknown as Parameters<typeof api.realtime.publish>[0]),
    log: (message, detail) =>
      api.log.error(message, detail === undefined ? undefined : (detail as Parameters<typeof api.log.error>[1])),
    setting: async <T extends string | number | boolean>(key: string) => {
      const values = await api.settings.read();
      return values[key] as T | undefined;
    },
  });

  // Seed an empty state so a panel that subscribes before any run gets a
  // snapshot rather than `null`.
  api.realtime.seed({ scopeKey: null, runs: [] } satisfies RunnerState);

  // Disposal kills every run. This is the whole reason a Kabmo restart does
  // not orphan a dev server this plugin started.
  api.onDispose(() => registry.dispose());

  // The user's own commands. The store holds no state of its own — every call
  // reads the plugin's record table — so a reload, a disable and a second tab
  // all see the same list.
  const custom = new CustomCommandStore(api);

  /**
   * Whether an unknown payload carries a key, as a type guard.
   *
   * The RPC input is EXTERNAL data — a browser sent it — so it is read through
   * `in` narrowing rather than an inline assertion: `key in value` is a check the
   * runtime performs, and TypeScript then types the read as `unknown`, which is
   * validated by the `typeof` beside it. An inline `as { … }` would assert a shape
   * nothing verified.
   */
  function has<T extends string>(value: unknown, key: T): value is Record<T, unknown> {
    return typeof value === 'object' && value !== null && key in value;
  }

  /** A validated scope, or the sentence explaining why it is not usable. */
  function checkedScope(input: unknown): Scope | { error: string } {
    if (typeof input !== 'object' || input === null) return { error: 'expected { root, repo }' };
    const { root, repo } = input as { root?: unknown; repo?: unknown };
    if (typeof root !== 'string' || root.length === 0) return { error: 'root must be a non-empty string' };
    if (typeof repo !== 'string') return { error: 'repo must be a string' };
    return { root, repo };
  }

  api.rpc.register<Scope, CommandListing | { error: string }>(RPC.list, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const scope = checkedScope(value);
          if ('error' in scope) return { issues: [{ message: scope.error }] };
          return { value: scope };
        },
      },
    },
    handler: async (scope) => withCustom(scope, custom),
  });

  api.rpc.register<
    { root: string; repo: string; sessionId: string | null; commandId: string; background: boolean },
    { runId: string } | { error: string }
  >(RPC.start, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const scope = checkedScope(value);
          if ('error' in scope) return { issues: [{ message: scope.error }] };
          const raw = value as { commandId?: unknown; sessionId?: unknown; background?: unknown };
          if (typeof raw.commandId !== 'string' || !raw.commandId) {
            return { issues: [{ message: 'commandId must be a non-empty string', path: ['commandId'] }] };
          }
          if (raw.sessionId !== undefined && raw.sessionId !== null && typeof raw.sessionId !== 'string') {
            return { issues: [{ message: 'sessionId must be a string or null', path: ['sessionId'] }] };
          }
          if (raw.background !== undefined && typeof raw.background !== 'boolean') {
            return { issues: [{ message: 'background must be a boolean', path: ['background'] }] };
          }
          return {
            value: {
              root: scope.root,
              repo: scope.repo,
              sessionId: (raw.sessionId as string | null | undefined) ?? null,
              commandId: raw.commandId,
              background: (raw.background as boolean | undefined) ?? false,
            },
          };
        },
      },
    },
    handler: async (input) => startRun(registry, custom, input),
  });

  api.rpc.register<{ runId: string }, { stopped: boolean }>(RPC.stop, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const runId = (value as { runId?: unknown } | null)?.runId;
          if (typeof runId !== 'string' || !runId) {
            return { issues: [{ message: 'runId must be a non-empty string', path: ['runId'] }] };
          }
          return { value: { runId } };
        },
      },
    },
    handler: (input) => registry.stop(input.runId),
  });

  api.rpc.register<{ root: string; repo: string; sessionId: string | null }, { stopped: number }>(RPC.stopOthers, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const scope = checkedScope(value);
          if ('error' in scope) return { issues: [{ message: scope.error }] };
          const raw = value as { sessionId?: unknown };
          if (raw.sessionId !== undefined && raw.sessionId !== null && typeof raw.sessionId !== 'string') {
            return { issues: [{ message: 'sessionId must be a string or null', path: ['sessionId'] }] };
          }
          return { value: { ...scope, sessionId: (raw.sessionId as string | null | undefined) ?? null } };
        },
      },
    },
    handler: (input) => registry.stopOthers(input.sessionId, scopeKeyOf(input.root, input.repo)),
  });

  api.rpc.register<{ root: string; repo: string; sessionId: string | null }, { stopped: number }>(RPC.stopAll, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const scope = checkedScope(value);
          if ('error' in scope) return { issues: [{ message: scope.error }] };
          const raw = value as { sessionId?: unknown };
          if (raw.sessionId !== undefined && raw.sessionId !== null && typeof raw.sessionId !== 'string') {
            return { issues: [{ message: 'sessionId must be a string or null', path: ['sessionId'] }] };
          }
          return { value: { ...scope, sessionId: (raw.sessionId as string | null | undefined) ?? null } };
        },
      },
    },
    handler: (input) => registry.stopAll(input.sessionId),
  });

  api.rpc.register<{ root: string | null }, CustomListing>(RPC.customList, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const root = has(value, 'root') ? value.root : undefined;
          // `null` is a real value here — the panel has no workspace yet — and
          // it selects the global commands only.
          if (root !== undefined && root !== null && typeof root !== 'string') {
            return { issues: [{ message: 'root must be a string or null', path: ['root'] }] };
          }
          return { value: { root: typeof root === 'string' ? root : null } };
        },
      },
    },
    // Every command, not only the visible ones: the panel needs the whole set to
    // say why a `repo` command is absent, and the filter is one predicate the
    // server already applies to the listing.
    handler: async () => ({ commands: await custom.list() }),
  });

  api.rpc.register<
    { command: string; scope: 'global' | 'repo'; root: string | null; cwd: string; previousId: string | null },
    CustomCommand | { error: string }
  >(RPC.customSave, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const command = has(value, 'command') && typeof value.command === 'string' ? value.command.trim() : '';
          const scope = has(value, 'scope') ? value.scope : undefined;
          const root = has(value, 'root') ? value.root : undefined;
          const cwd = has(value, 'cwd') ? value.cwd : undefined;
          const previousId = has(value, 'previousId') ? value.previousId : undefined;
          if (!command) return { issues: [{ message: 'command must be a non-empty string', path: ['command'] }] };
          // The text is what a shell will run. Refusing a newline is not
          // cosmetic: a multi-line entry is almost always a paste accident, and
          // the row's own label would then render as a paragraph.
          if (command.includes('\n')) {
            return { issues: [{ message: 'a command must be one line', path: ['command'] }] };
          }
          if (scope !== 'global' && scope !== 'repo') {
            return { issues: [{ message: 'scope must be "global" or "repo"', path: ['scope'] }] };
          }
          if (scope === 'repo' && (typeof root !== 'string' || !root)) {
            return { issues: [{ message: 'a repo-scoped command needs a root', path: ['root'] }] };
          }
          if (cwd !== undefined && typeof cwd !== 'string') {
            return { issues: [{ message: 'cwd must be a string', path: ['cwd'] }] };
          }
          if (previousId !== undefined && previousId !== null && typeof previousId !== 'string') {
            return { issues: [{ message: 'previousId must be a string or null', path: ['previousId'] }] };
          }
          return {
            value: {
              command,
              scope,
              root: typeof root === 'string' ? root : null,
              cwd: typeof cwd === 'string' ? cwd : '.',
              previousId: typeof previousId === 'string' ? previousId : null,
            },
          };
        },
      },
    },
    handler: async (input) => {
      try {
        const { previousId, ...fields } = input;
        return await custom.save(fields, previousId);
      } catch (error) {
        // A refused write is REPORTED: a slug that came out empty (a command of
        // only punctuation) is a real refusal and the dialog has to say so.
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  api.rpc.register<{ id: string }, { removed: boolean }>(RPC.customRemove, {
    input: {
      '~standard': {
        version: 1,
        vendor: 'command-runner',
        validate: (value: unknown) => {
          const id = has(value, 'id') ? value.id : undefined;
          if (typeof id !== 'string' || !id) {
            return { issues: [{ message: 'id must be a non-empty string', path: ['id'] }] };
          }
          return { value: { id } };
        },
      },
    },
    handler: (input) => custom.remove(input.id).then((removed) => ({ removed })),
  });

  api.http.route('/logs', (request) => {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') ?? '';
    const requested = Number(url.searchParams.get('tail') ?? '');
    const tail = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_TAIL_BYTES) : 64 * 1024;
    const log = registry.log(id, tail);
    if (!log) {
      // A reason, never an empty body: "no such run" and "a run with no output
      // yet" are different answers and only one is a bug.
      return Response.json({ error: `No run "${id}".` }, { status: 404 });
    }
    return Response.json(log satisfies RunLog);
  });
}
