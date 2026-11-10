/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP client's file surface: `fs/read_text_file` / `fs/write_text_file`.
 *
 * These are calls the AGENT makes on the CLIENT (see `file-system.md`), so the
 * client performs the operation itself and is responsible for its own checks —
 * a permission request does not replace them. Three rules here are the whole
 * point of the module:
 *
 *  - **Workspace containment.** Every path is canonicalized against the
 *    session's cwd with `pathHolds`, which resolves symlinks and the nearest
 *    existing ancestor. A path that merely LOOKS inside (`../`, a symlink to
 *    `/etc`) is refused with `-32602`, never read.
 *  - **Line numbers are 1-based.** `line`/`limit` select a window of lines, and
 *    an out-of-range window is an empty string, not an error.
 *  - **A write creates.** ACP says the client MUST create the file if it does
 *    not exist, which includes its parent directories.
 *
 * Capability advertisement lives in `client-capabilities.ts`; this module only
 * serves what that object promises.
 */

import path from 'node:path';
import { pathHolds } from '@/server/lib/fs/canonical';
import { ACP_ERROR } from '@/server/lib/harness/acp/protocol';

/** The slice of a session an fs call reads. */
export interface AcpFsHost {
  readonly cwd: string;
  readonly sessionId: string;
}

/** Structurally the `answered: false` branch of the client-request answer. */
export type AcpFsAnswer =
  | { answered: true; result: unknown }
  | { answered: false; message: string; code: number };

export function isAcpFsMethod(method: string): boolean {
  return method === 'fs/read_text_file' || method === 'fs/write_text_file';
}

export async function handleAcpFsRequest(
  host: AcpFsHost,
  method: string,
  params: Record<string, unknown>,
): Promise<AcpFsAnswer> {
  const requestedSession = params.sessionId;
  // One process serves one session on this transport, so any other id names
  // something this client cannot address. Silently serving it would let a
  // second session reach a workspace it was never given.
  if (typeof requestedSession === 'string' && requestedSession !== host.sessionId) {
    return refuse(ACP_ERROR.invalidParams, `Unknown session: ${requestedSession}`);
  }
  const target = params.path;
  if (typeof target !== 'string' || target.length === 0) {
    return refuse(ACP_ERROR.invalidParams, 'path is required');
  }
  if (!path.isAbsolute(target)) {
    return refuse(ACP_ERROR.invalidParams, `Path must be absolute: ${target}`);
  }
  if (!(await pathHolds(host.cwd, target))) {
    return refuse(ACP_ERROR.invalidParams, `Path is outside this session's workspace: ${target}`);
  }

  return method === 'fs/read_text_file' ? read(target, params) : write(target, params);
}

async function read(target: string, params: Record<string, unknown>): Promise<AcpFsAnswer> {
  const line = optionalPositive(params.line);
  if (line === false) return refuse(ACP_ERROR.invalidParams, 'line must be a positive integer');
  const limit = optionalPositive(params.limit);
  if (limit === false) return refuse(ACP_ERROR.invalidParams, 'limit must be a positive integer');

  let text: string;
  try {
    text = await Bun.file(target).text();
  } catch (error) {
    return fileError(target, error);
  }
  if (line === undefined && limit === undefined) return { answered: true, result: { content: text } };

  /**
   * Splitting on '\n' keeps a trailing newline as a final empty element, so
   * `line: 1, limit: 1` on "a\nb\n" answers "a" — not "a\n". The window is
   * inclusive of `line` and counts `limit` lines, exactly as the spec words it.
   */
  const lines = text.split('\n');
  const start = (line ?? 1) - 1;
  const end = limit === undefined ? undefined : start + limit;
  return { answered: true, result: { content: lines.slice(start, end).join('\n') } };
}

async function write(target: string, params: Record<string, unknown>): Promise<AcpFsAnswer> {
  const content = params.content;
  if (typeof content !== 'string') {
    return refuse(ACP_ERROR.invalidParams, 'content is required');
  }
  try {
    // `Bun.write` creates missing parent directories, which is the "MUST create
    // the file if it doesn't exist" half of the method.
    await Bun.write(target, content);
    return { answered: true, result: {} };
  } catch (error) {
    return fileError(target, error);
  }
}

/** The optional positive integer a window parameter must be, or false. */
function optionalPositive(value: unknown): number | undefined | false {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return false;
  return value;
}

function refuse(code: number, message: string): AcpFsAnswer {
  return { answered: false, message, code };
}

/** Map a filesystem failure onto the spec's codes. */
function fileError(target: string, error: unknown): AcpFsAnswer {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOENT') return refuse(ACP_ERROR.notFound, `File not found: ${target}`);
  if (code === 'EISDIR' || code === 'ENOTDIR' || code === 'EINVAL') {
    return refuse(ACP_ERROR.invalidParams, `Not a text file: ${target}`);
  }
  return refuse(ACP_ERROR.internal, error instanceof Error ? error.message : String(error));
}
