/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The "always allow" grants of one ACP session.
 *
 * ACP offers `allow_always` beside `allow_once` on a permission request, and
 * ignoring it made every repeated tool call ask again — the agent's own answer
 * to "can I run this script" was thrown away and the operator re-approved the
 * same command for the whole turn.
 *
 * A grant is keyed by what the approval DIALOG showed, not by the tool call id
 * (which is different on every invocation): the tool's kind plus the command or
 * path the agent reported. `reject_always` is deliberately NOT remembered —
 * surfacing every attempt again is the safer mistake, and a refusal the operator
 * has to repeat is never a security hole.
 *
 * The set is per SESSION and hydrated from the database at spawn, so a reload or
 * a reclaimed child does not resurrect the questions.
 */

/** A grant is a key plus the option kind it was granted with. */
export interface PermissionGrant {
  key: string;
  kind: 'allow_always';
}

/** The identity a dialog showed: stable across invocations of the same call. */
export function permissionGrantKey(toolCall: Record<string, unknown> | undefined): string | null {
  if (!toolCall) return null;
  const kind = typeof toolCall.kind === 'string' ? toolCall.kind : 'other';
  const rawInput = toolCall.rawInput && typeof toolCall.rawInput === 'object'
    ? toolCall.rawInput as Record<string, unknown>
    : {};
  // The field the dialog renders for a write/edit, plus the fields an exec
  // carries. A title is a last resort: some agents send a constant title, and a
  // grant keyed on nothing must not exist.
  const subject = [
    rawInput.command,
    rawInput.path,
    rawInput.filePath,
    rawInput.file,
    rawInput.target,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const title = typeof toolCall.title === 'string' ? toolCall.title.trim() : '';
  const identity = subject ?? title;
  if (!identity) return null;
  return `${kind}\u0000${identity}`;
}

/** The grants one session has earned, in memory. */
export class PermissionGrants {
  readonly #keys = new Set<string>();

  /** Adopt the rows read from the database at spawn. */
  hydrate(keys: readonly string[]): void {
    for (const key of keys) this.#keys.add(key);
  }

  has(key: string | null): boolean {
    return key !== null && this.#keys.has(key);
  }

  add(key: string | null): boolean {
    if (key === null || this.#keys.has(key)) return false;
    this.#keys.add(key);
    return true;
  }

  clear(): void {
    this.#keys.clear();
  }

  snapshot(): string[] {
    return [...this.#keys];
  }
}
