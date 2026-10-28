/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Command (slash-command) file location and authoring for Kabmo's
 * Commands settings.
 *
 * omp discovers markdown slash commands from every provider's config dirs and
 * `get_available_commands` reports them by name, description and argument hint
 * — but never by path, and never with the scope it found them at. The Kabmo
 * needs both to answer "is this a user-scope command or a project-scope one,
 * and may I edit it?", so this module probes the same directories omp reads.
 *
 * Two levels, probed project-first (omp resolves a name present in both roots
 * to the project file — verified: `dupe.md` in `~/.omp/agent/commands` and in a
 * workspace's `.omp/commands` runs the project body):
 *
 * - project: `<workspace>/.omp/commands`, `.claude/commands`, `.codex/commands`,
 *   `.agents/commands`, `.opencode/commands`, `.github/prompts/*.prompt.md`
 * - user: `~/.omp/agent/commands`, `~/.claude/commands`, `~/.codex/commands`,
 *   `~/.agents/commands`, `~/.config/opencode/commands`
 *
 * Only the two omp-native `.omp` roots are `managed`: a command from `.claude`
 * or `.agents` is shown read-only, because Kabmo is not the tool that put
 * it there and a save or delete through this pane would rewrite another tool's
 * file. A nested Claude command is addressed as `ns:name` by omp and stored as
 * `<dir>/ns/name.md`, which is why a colon maps to a path separator here.
 */

import fs from 'fs';
import { join, resolve } from 'path';
import { getAgentDir, pathExists } from '@/server/lib/omp/core/paths';
import { commandRoots, PROJECT_COMMAND_ROOTS } from '@/server/lib/omp/config/discovery-roots';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { parseFrontmatter } from '@/server/lib/omp/config/yaml';

const MAX_COMMAND_MD_BYTES = 512 * 1024;

/** Project-level command dirs, relative to a workspace root. `github` holds
 *  VS Code Copilot prompt files, whose names carry the `.prompt` suffix. */
const PROJECT_COMMAND_DIRS = PROJECT_COMMAND_ROOTS;

/** User-level command dirs. `.omp/agent` comes from the agent dir resolution
 *  so `PI_CODING_AGENT_DIR` and profiles are honored. */
function userCommandDirs(): Array<{ dir: string; suffix: string }> {
  return commandRoots()
    .filter((root) => root.scope === 'user')
    .map(({ dir, suffix }) => ({ dir, suffix }));
}

export interface CommandFileLocation {
  filePath: string;
  scope: 'user' | 'project';
  /** True for the two omp-native roots Kabmo may write and delete in. */
  managed: boolean;
}

/** A command name that is safe as a relative path inside a command dir. */
function safeRelativeName(name: string): string | null {
  const trimmed = name.trim().replace(/^\/+/, '');
  if (!trimmed) return null;
  if (/[\\/]/.test(trimmed.replace(/:/g, '/')) || trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

/** The file backing a command, or null when it is not a markdown command file
 *  (a builtin, a skill, an extension command) or was not found in any root. */
export async function locateCommandFile(
  name: string,
  projectDir?: string | null,
): Promise<CommandFileLocation | null> {
  const relative = safeRelativeName(name);
  if (!relative) return null;
  const asPath = relative.replace(/:/g, '/');

  const candidates: Array<{ dir: string; suffix: string; scope: 'user' | 'project'; managed: boolean }> = [];
  if (projectDir) {
    for (const entry of PROJECT_COMMAND_DIRS) {
      candidates.push({ ...entry, dir: join(projectDir, entry.dir), scope: 'project', managed: entry.dir === '.omp/commands' });
    }
  }
  for (const entry of userCommandDirs()) {
    candidates.push({ ...entry, scope: 'user', managed: entry.dir === join(getAgentDir(), 'commands') });
  }

  for (const candidate of candidates) {
    const filePath = join(candidate.dir, `${asPath}${candidate.suffix}`);
    if (await pathExists(filePath)) {
      return { filePath, scope: candidate.scope, managed: candidate.managed };
    }
  }
  return null;
}

/** Read a command markdown file, split into frontmatter fields and template. */
export async function readCommandFile(
  filePath: string,
): Promise<{ description: string; argumentHint: string; body: string } | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists()) || (await file.stat()).size > MAX_COMMAND_MD_BYTES) return null;
    const { data, body } = parseFrontmatter(await file.text());
    return {
      description: data.description ?? '',
      argumentHint: data['argument-hint'] ?? data.argumentHint ?? '',
      body: body.replace(/^\r?\n/, ''),
    };
  } catch {
    return null;
  }
}

/** Serialize a command markdown file. omp reads `description` and
 *  `argument-hint` from frontmatter; the body is the prompt template. */
function serializeCommandMd(input: { description: string; argumentHint: string; body: string }): string {
  const lines = ['---'];
  if (input.description) lines.push(`description: ${JSON.stringify(input.description)}`);
  if (input.argumentHint) lines.push(`argument-hint: ${JSON.stringify(input.argumentHint)}`);
  lines.push('---', '', input.body.replace(/\r\n/g, '\n').replace(/\s*$/, ''), '');
  return lines.join('\n');
}

export interface WriteCommandInput {
  /** Target root: `user` writes to the agent dir, `project` to the workspace. */
  scope: 'user' | 'project';
  /** Workspace root, required for `project`. */
  projectDir?: string | null;
  /** Name of the command being edited, when it is being renamed. */
  previousName?: string | null;
  name: string;
  description: string;
  argumentHint: string;
  body: string;
}

/** Create or overwrite a Kabmo-managed command file. Refuses a project write
 *  with no workspace rather than landing it somewhere the user did not pick. */
export async function writeCommandFile(input: WriteCommandInput): Promise<{ filePath: string }> {
  const relative = safeRelativeName(input.name);
  if (!relative) throw new Error('Command name is required');
  if (input.scope === 'project' && !input.projectDir) {
    throw new Error('A workspace root is required to write a project command');
  }
  const root = input.scope === 'project'
    ? join(input.projectDir!, '.omp', 'commands')
    : join(getAgentDir(), 'commands');
  const filePath = join(root, `${relative.replace(/:/g, '/')}.md`);

  // A rename is a move: the previous file must not linger as a second command.
  // It is removed only when it is a DIFFERENT managed file, so an edit in place
  // never deletes the file just written.
  const previous = input.previousName?.trim().replace(/^\/+/, '');
  if (previous && previous !== relative) {
    const stale = await locateCommandFile(previous, input.projectDir);
    if (stale?.managed && resolve(stale.filePath) !== resolve(filePath)) {
      await fs.promises.rm(stale.filePath, { force: true });
    }
  }

  await fs.promises.mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFileAtomic(
    filePath,
    serializeCommandMd({
      description: input.description,
      argumentHint: input.argumentHint,
      body: input.body,
    }),
    { createMode: 0o644 },
  );
  return { filePath };
}

/** Delete a Kabmo-managed command file. Refused unless the name resolves to
 *  one of the managed roots, so a delete can never reach another tool's file. */
export async function deleteCommandFile(name: string, projectDir?: string | null): Promise<boolean> {
  const found = await locateCommandFile(name, projectDir);
  if (!found) throw new Error(`"${name}" is not a command file Kabmo can delete`);
  if (!found.managed) {
    throw new Error(`"${name}" is provided by ${found.filePath}; Kabmo cannot delete it`);
  }
  await fs.promises.rm(found.filePath, { force: true });
  return true;
}
