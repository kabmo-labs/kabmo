import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { DEFAULT_COMMANDS_LIST } from '@/client/data/settings/command';
import { isMockMode } from '@/server/mock.server';
import type { CommandItem } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';
import { createSettingsListStore } from '@/server/lib/db/settings-store';
import { runUtilityCommand } from '@/server/lib/omp/rpc/utility';
import { resolveDiscoveryScope, type DiscoveryScope } from '@/server/lib/omp/config/scope';
import {
  deleteCommandFile,
  locateCommandFile,
  readCommandFile,
  writeCommandFile,
} from '@/server/lib/omp/config/commands';
import { reloadLiveSessions } from '@/server/lib/omp/session/reload.server';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const commandsStore = createSettingsListStore<CommandItem>({
  key: 'omp_commands_settings',
  mockDefaults: DEFAULT_COMMANDS_LIST,
  idOf: (command) => command.id,
  singular: 'command',
  plural: 'commands',
});

/** Command sources Kabmo surfaces in the composer (mcp_prompt is not user-typable). */
const AGENT_COMMAND_SOURCES: Record<string, true> = {
  builtin: true,
  skill: true,
  custom: true,
  extension: true,
  file: true,
};

/**
 * Live slash commands from the agent's `get_available_commands`, mapped into
 * Kabmo's CommandItem. Aliases, subcommands and the argument hint ride
 * along: they are what the composer's `/` popup needs to behave like omp's own
 * editor (`/models` completing to the alias, `/fast ` offering on|off|status).
 * Anything malformed is dropped rather than trusted.
 */
function toLiveCommandItem(value: unknown): CommandItem | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name : '';
  if (!name) return null;
  if (typeof value.source !== 'string' || !AGENT_COMMAND_SOURCES[value.source]) return null;

  const aliases = Array.isArray(value.aliases)
    ? value.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.length > 0)
    : [];

  const hint = isRecord(value.input) && typeof value.input.hint === 'string' ? value.input.hint : undefined;

  const subcommands = Array.isArray(value.subcommands)
    ? value.subcommands.flatMap((sub) => {
        if (!isRecord(sub) || typeof sub.name !== 'string' || !sub.name) return [];
        return [{
          name: sub.name,
          ...(typeof sub.description === 'string' ? { description: sub.description } : {}),
          ...(typeof sub.usage === 'string' ? { usage: sub.usage } : {}),
        }];
      })
    : [];

  return {
    id: `omp-live-${name}`,
    name,
    description: typeof value.description === 'string' ? value.description : '',
    scope: 'system',
    source: value.source,
    template: `/${name}`,
    isBuiltIn: value.source !== 'file',
    ...(aliases.length ? { aliases } : {}),
    ...(subcommands.length ? { subcommands } : {}),
    ...(hint ? { inputHint: hint } : {}),
  };
}

/** Read live agent commands (builtin/skill/custom/extension/file sources) via
 *  RPC, scoped to `cwd` so a workspace's own `.omp/commands` are discovered. */
async function loadAgentCommands(cwd: string): Promise<CommandItem[]> {
  try {
    const data = await runUtilityCommand<{ commands?: unknown }>({ type: 'get_available_commands' }, 30_000, cwd);
    if (!Array.isArray(data.commands)) return [];
    return data.commands.flatMap((command) => {
      const item = toLiveCommandItem(command);
      return item ? [item] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Attach what the settings pane needs to decide whether a live command is a
 * file Kabmo owns: the file backing it (if any), its scope, and its body.
 * `get_available_commands` reports the name, description and hint but not the
 * path, so the answer comes from looking the name up in the roots omp reads.
 */
async function withCommandFile(command: CommandItem, scope: DiscoveryScope): Promise<CommandItem> {
  const found = await locateCommandFile(command.name, scope.workspace);
  if (!found) {
    // No markdown file backs this name: a builtin, a `skill:<name>` entry, an
    // extension or a TypeScript custom command. It runs, but nothing here owns
    // a file for it.
    return { ...command, isBuiltIn: true, managed: false };
  }
  const file = await readCommandFile(found.filePath);
  return {
    ...command,
    // The file's scope is the truth, not omp's silence about where it found it.
    scope: found.scope,
    isBuiltIn: false,
    managed: found.managed,
    filePath: found.filePath,
    ...(file ? { template: file.body, description: file.description || command.description } : {}),
  };
}

/** Merge live agent commands ahead of app-local custom commands. */
async function mergeCommands(custom: CommandItem[], scope: DiscoveryScope): Promise<CommandItem[]> {
  const live = await Promise.all((await loadAgentCommands(scope.cwd)).map((c) => withCommandFile(c, scope)));
  const liveNames = new Set(live.map((c) => c.name.toLowerCase()));
  return [...live, ...custom.filter((c) => !liveNames.has(c.name.toLowerCase()))];
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const db = await getDb();
    const mock = isMockMode();
    const commands = await commandsStore.read(db);
    if (mock) return json({ commands, isMock: true });

    // The workspace root decides which project-scope commands/skills exist, so
    // an unscoped read must not silently answer with $HOME's inventory.
    const url = new URL(request.url);
    const scope = await resolveDiscoveryScope(url.searchParams.get('root'), url.searchParams.get('scope'));
    const merged = await mergeCommands(commands, scope);
    return json({ commands: merged, isMock: false });
  } catch (error) {
    const mock = isMockMode();
    return json({ error: errorMessage(error), commands: mock ? DEFAULT_COMMANDS_LIST : [], isMock: mock }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const db = await getDb();
    const url = new URL(request.url);

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id is required' }, { status: 400 });
      if (isMockMode()) {
        const list = await commandsStore.remove(db, id);
        return json({ success: true, commands: list });
      }

      // A live command's id carries its name (`omp-live-<name>`); the pane's
      // delete is only offered for one Kabmo owns, and the file is the
      // real thing to remove. A Kabmo-local row still deletes as a row.
      const name = id.startsWith('omp-live-') ? id.slice('omp-live-'.length) : null;
      const scope = await resolveDiscoveryScope(url.searchParams.get('root'), url.searchParams.get('scope'));
      if (name) {
        await deleteCommandFile(name, scope.workspace);
        await reloadLiveSessions();
        return json({ success: true, commands: await mergeCommands(await commandsStore.read(db), scope) });
      }
      const list = await commandsStore.remove(db, id);
      return json({ success: true, commands: list });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await request.json();
      const scope = await resolveDiscoveryScope(
        url.searchParams.get('root') ?? (typeof body.root === 'string' ? body.root : null),
        url.searchParams.get('scope') ?? (typeof body.scope === 'string' ? body.scope : null),
      );

      // Only a markdown file Kabmo owns is written as a file. A live
      // command from another provider (an extension command, a `.claude`
      // command, a TypeScript custom command) has no file here, and writing one
      // with the same name would SHADOW it — omp resolves a name present in
      // both places to the file. A brand-new draft (no source) is a create.
      const draft = isRecord(body.command) ? (body.command as unknown as CommandItem) : null;
      if (!isMockMode() && draft && (draft.managed === true || (!draft.source && draft.isBuiltIn !== true))) {
        const previousName = typeof body.previousName === 'string' ? body.previousName : null;
        const target = draft.scope === 'project' ? 'project' : 'user';
        await writeCommandFile({
          scope: target,
          projectDir: scope.workspace,
          previousName,
          name: draft.name,
          description: draft.description ?? '',
          argumentHint: draft.inputHint ?? '',
          body: draft.template ?? '',
        });
        await reloadLiveSessions();
        return json({ success: true, commands: await mergeCommands(await commandsStore.read(db), scope) });
      }

      const updatedCommands = await commandsStore.upsert(db, body);
      await commandsStore.write(db, updatedCommands);
      return json({ success: true, commands: updatedCommands });
    }

    return methodNotAllowed({ request, params });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: 500 });
  }
}
