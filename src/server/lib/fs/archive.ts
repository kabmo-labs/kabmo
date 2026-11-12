/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Creating and unpacking archives for the Files panel.
 *
 * There is no archive library in this repository, and one is not worth adding:
 * every desktop already carries the platform tools, and a pure-JS replacement
 * would still miss `.rar`. So the work is delegated to the system binaries and
 * the module's job is the two things an external command cannot decide for us:
 * which tool is present, and which failure sentence a user reads when none is.
 *
 * The argv is quoted for `/bin/sh` because `runShell` is the one spawn path in
 * the server with a timeout that kills the whole process group — an archive of
 * a large tree must not outlive the request. Output is captured, not parsed:
 * the tools' own stderr is the best description of a refusal.
 */

import path from 'node:path';
import fs from 'node:fs';
import { runShell, shellOk, type ShellResult } from '@/server/lib/fs/shell';
import {
  archiveKindOf,
  type ArchiveFormat,
  COMPRESS_FORMATS,
} from '@/shared/lib/fs/archive';

export interface CompressFormatAvailability {
  id: ArchiveFormat;
  label: string;
  extension: string;
  available: boolean;
  /** The binary the format needs, for the dialog's refusal. */
  tool: string;
}

/** A tool name and the binaries that can stand in for it, best first. */
const TOOLS: Record<string, readonly string[]> = {
  zip: ['zip'],
  unzip: ['unzip'],
  sevenZip: ['7z', '7zz', '7za'],
  rar: ['rar'],
  unrar: ['unrar'],
  tar: ['tar'],
  bsdtar: ['bsdtar'],
  gzip: ['gzip'],
  bzip2: ['bzip2'],
  xz: ['xz'],
};

/** The first binary of `names` that exists on this machine, or null. */
export function findTool(names: readonly string[]): string | null {
  for (const name of names) {
    if (Bun.which(name)) return name;
  }
  return null;
}

/** Which compress formats this machine can actually write. */
export function compressFormats(): CompressFormatAvailability[] {
  return COMPRESS_FORMATS.map((format) => {
    const needed = compressToolFor(format.id);
    return { ...format, available: needed !== null, tool: needed ?? toolLabelFor(format.id) };
  });
}

/** The binary a format writes with, or null when it is not installed. */
function compressToolFor(format: ArchiveFormat): string | null {
  switch (format) {
    case 'zip':
      return findTool(TOOLS.zip!);
    case '7z':
      return findTool(TOOLS.sevenZip!);
    case 'rar':
      return findTool(TOOLS.rar!);
    case 'tar':
    case 'tar.gz':
      return findTool(TOOLS.tar!);
  }
}

function toolLabelFor(format: ArchiveFormat): string {
  switch (format) {
    case 'zip':
      return 'zip';
    case '7z':
      return '7z';
    case 'rar':
      return 'rar';
    case 'tar':
    case 'tar.gz':
      return 'tar';
  }
}

/** Quote one argument for `/bin/sh`. */
function q(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** A bounded, single-line description of a failed command. */
function failureText(result: { stderr: string; stdout: string }, fallback: string): string {
  const text = (result.stderr.trim() || result.stdout.trim()).split('\n')[0]?.trim();
  return text ? text.slice(0, 300) : fallback;
}

export interface CompressOptions {
  /** Absolute folder that becomes the command's working directory. */
  destinationDir: string;
  /** Archive file name, one segment, inside `destinationDir`. */
  name: string;
  format: ArchiveFormat;
  /** Absolute paths of the entries to add; each must live inside the destination. */
  sources: string[];
}

export type ArchiveOutcome = { ok: true; path: string } | { ok: false; error: string; status: number };

/**
 * Write `sources` into one new archive beside them.
 *
 * The destination is refused when it exists: the same rule Create, Save As and
 * Rename follow. `--` and a `./` prefix keep a file whose name begins with a
 * dash from being read as an option, and every argument is a path relative to
 * the working directory so the archive stores clean names.
 */
export async function compressEntries(options: CompressOptions): Promise<ArchiveOutcome> {
  const { destinationDir, name, format, sources } = options;
  if (sources.length === 0) return { ok: false, status: 400, error: 'Nothing to compress' };

  const destination = path.join(destinationDir, name);
  if (await Bun.file(destination).exists()) {
    return { ok: false, status: 409, error: `${name} already exists` };
  }

  const relative: string[] = [];
  for (const source of sources) {
    const rel = path.relative(destinationDir, source).split(path.sep).join('/');
    if (rel === '' || rel.startsWith('../') || path.isAbsolute(rel)) {
      return {
        ok: false,
        status: 400,
        error: 'Compress into a folder that contains every selected item',
      };
    }
    relative.push(rel);
  }

  // The tool is looked up LAST: a request that is invalid whatever is installed
  // must answer 400/409, not "install zip". Measured on the Windows gate, which
  // has no `zip`: both refusal cases reported the missing tool instead of the
  // refusal they assert.
  const binary = compressToolFor(format);
  if (!binary) {
    return {
      ok: false,
      status: 501,
      error: `${toolLabelFor(format)} is not installed on this machine`,
    };
  }

  const args = relative.map((rel) => `./${rel}`).join(' ');
  const command = (() => {
    switch (format) {
      case 'zip':
        return `${binary} -r -q ${q(name)} ${args}`;
      case '7z':
        return `${binary} a -y -- ${q(name)} ${args}`;
      case 'rar':
        return `${binary} a -r -ep1 ${q(name)} ${args}`;
      case 'tar':
        return `${binary} -cf ${q(name)} ${args}`;
      case 'tar.gz':
        return `${binary} -czf ${q(name)} ${args}`;
    }
  })();

  const result = await runShell(command, { cwd: destinationDir, timeout: 120_000 });
  if (!shellOk(result)) {
    return { ok: false, status: 500, error: failureText(result, `Could not write ${name}`) };
  }
  return { ok: true, path: destination };
}

export interface ExtractOptions {
  /** Absolute archive path. */
  archivePath: string;
  /** Absolute folder the entries land in; created when missing. */
  destinationDir: string;
}

/** Unpack one archive into `destinationDir`. */
export async function extractArchive(options: ExtractOptions): Promise<ArchiveOutcome> {
  const { archivePath, destinationDir } = options;
  const kind = archiveKindOf(path.basename(archivePath));
  if (!kind) return { ok: false, status: 400, error: 'That file is not a recognised archive' };

  const stat = await Bun.file(archivePath).stat().catch(() => null);
  if (!stat || stat.isDirectory()) return { ok: false, status: 404, error: 'That archive no longer exists' };

  await fs.promises.mkdir(destinationDir, { recursive: true });

  const quotedArchive = q(archivePath);
  const quotedDestination = q(destinationDir);
  const run = (command: string) => runShell(command, { timeout: 300_000 });

  const archive = quotedArchive;
  const dest = quotedDestination;
  const sevenZip = findTool(TOOLS.sevenZip!);
  const bsdtar = findTool(TOOLS.bsdtar!);

  switch (kind) {
    case 'zip': {
      const unzip = findTool(TOOLS.unzip!);
      if (unzip) return outcome(await run(`${unzip} -o -q ${archive} -d ${dest}`), archivePath);
      if (bsdtar) return outcome(await run(`${bsdtar} -xf ${archive} -C ${dest}`), archivePath);
      return missingTool('unzip');
    }
    case '7z': {
      if (sevenZip) return outcome(await run(`${sevenZip} x -y -o${dest} ${archive}`), archivePath);
      if (bsdtar) return outcome(await run(`${bsdtar} -xf ${archive} -C ${dest}`), archivePath);
      return missingTool('7z');
    }
    case 'rar': {
      const unrar = findTool(TOOLS.unrar!);
      if (unrar) return outcome(await run(`${unrar} x -o+ ${archive} ${dest}`), archivePath);
      if (sevenZip) return outcome(await run(`${sevenZip} x -y -o${dest} ${archive}`), archivePath);
      if (bsdtar) return outcome(await run(`${bsdtar} -xf ${archive} -C ${dest}`), archivePath);
      return missingTool('unrar or 7z');
    }
    case 'tar':
    case 'tar.gz':
    case 'tar.bz2':
    case 'tar.xz': {
      const tar = findTool(TOOLS.tar!);
      if (tar) return outcome(await run(`${tar} -xf ${archive} -C ${dest}`), archivePath);
      if (bsdtar) return outcome(await run(`${bsdtar} -xf ${archive} -C ${dest}`), archivePath);
      return missingTool('tar');
    }
    case 'gz':
    case 'bz2':
    case 'xz': {
      const decompressor = kind === 'gz' ? findTool(TOOLS.gzip!) : kind === 'bz2' ? findTool(TOOLS.bzip2!) : findTool(TOOLS.xz!);
      const outName = path.basename(archivePath).replace(/\.(gz|bz2|xz)$/i, '');
      const out = q(path.join(destinationDir, outName));
      if (decompressor) {
        return outcome(await run(`${decompressor} -dc ${archive} > ${out}`), outName);
      }
      if (bsdtar) return outcome(await run(`${bsdtar} -xf ${archive} -C ${dest}`), archivePath);
      return missingTool(kind);
    }
  }
}

function outcome(result: ShellResult, successPath: string): ArchiveOutcome {
  if (shellOk(result)) return { ok: true, path: successPath };
  return { ok: false, status: 500, error: failureText(result, 'The archive could not be extracted') };
}

function missingTool(name: string): ArchiveOutcome {
  return { ok: false, status: 501, error: `No tool available to extract this archive (install ${name})` };
}
