/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turning a dropped file REFERENCE into an attachable File.
 *
 * A download dragged out of a web page (WhatsApp Web, Gmail, Slack) hands the
 * composer a URL, not bytes: there is no `File` in the drag at all. The browser
 * cannot read it either — a cross-origin `file://` path and a remote URL are
 * both outside what the page may fetch. The Kabmo server can, so the
 * reference is resolved there and returned as text the composer attaches like
 * any other file.
 *
 * Only text is supported on this path. An image or an arbitrary binary cannot
 * round-trip through JSON as a string, and the drop's own `File` (when the host
 * provides one) is the path that carries those.
 */


/** Last path segment of a URL or path, for the attachment's display name. */
export function referenceName(reference: string): string {
  const withoutQuery = reference.split(/[?#]/)[0] ?? reference;
  const segment = withoutQuery.replace(/\/+$/, '').split('/').pop();
  if (!segment) return 'attachment';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Why a dropped reference could not be turned into a file. */
export type ReferenceFailure =
  /** The path exists but lies outside the roots Kabmo may read. */
  | 'outside-roots'
  /** A URL from a web page; Kabmo does not fetch outbound. */
  | 'remote'
  /** The path exists but its contents are not text (an image, an archive). */
  | 'binary'
  /** The server could not read it at all — gone, or an unreadable permission. */
  | 'unavailable';

export type ReferenceReadResult =
  | { ok: true; file: File }
  | { ok: false; reason: ReferenceFailure };

/**
 * Read a dropped reference through the server.
 *
 * `path` is used as the filesystem root hint so a relative reference resolves
 * inside the active workspace; an absolute path or URL ignores it. The failure
 * carries its REASON because the three cases need three different actions from
 * the user, and a single "could not be read" left them with no way to tell them
 * apart — or the developer with no way to tell which branch ran.
 */
export async function readDroppedReference(reference: string, rootPath: string | null): Promise<ReferenceReadResult> {
  const params = new URLSearchParams({ path: reference });
  if (rootPath) params.set('root', rootPath);
  const url = `/api/fs/read-reference?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    return { ok: false, reason: 'unavailable' };
  }
  const body = (await res.json().catch(() => null)) as { content?: unknown; name?: unknown; error?: unknown } | null;
  if (!res.ok) {
    const error = typeof body?.error === 'string' ? body.error : '';
    if (/remote/i.test(error)) return { ok: false, reason: 'remote' };
    if (/image|raw/i.test(error)) return { ok: false, reason: 'binary' };
    if (res.status === 404 || /not found/i.test(error)) return { ok: false, reason: 'outside-roots' };
    return { ok: false, reason: 'unavailable' };
  }
  if (!body || typeof body.content !== 'string') return { ok: false, reason: 'unavailable' };
  // The server reports the basename it actually read, which is more reliable
  // than re-deriving one from a percent-encoded URL.
  const name = typeof body.name === 'string' && body.name ? body.name : referenceName(reference);
  return { ok: true, file: new File([body.content], name, { type: 'text/plain' }) };
}

/** User-facing reason for files whose contents could not be read. */
export function describeUnreadable(names: string[]): string {
  if (names.length === 1) {
    return `"${names[0]}" could not be read and was not attached.`;
  }
  return `${names.length} files could not be read and were not attached: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}.`;
}

/** User-facing reason for a dropped reference the server refused, per cause. */
export function describeReferenceFailure(names: string[], reason: ReferenceFailure): string {
  const list = names.slice(0, 3).join(', ');
  const subject = names.length === 1 ? `"${names[0]}"` : `${names.length} files`;
  const tail = names.length > 3 ? '…' : '';
  switch (reason) {
    case 'outside-roots':
      return `${subject} lie${names.length === 1 ? 's' : ''} outside the folders Kabmo may read, so ${names.length === 1 ? 'it was' : 'they were'} not attached (${list}${tail}).`;
    case 'remote':
      return `${subject} ${names.length === 1 ? 'is a web download' : 'are web downloads'}; save ${names.length === 1 ? 'it' : 'them'} into a workspace folder first (${list}${tail}).`;
    case 'binary':
      return `${subject} ${names.length === 1 ? 'is not' : 'are not'} a text file and ${names.length === 1 ? 'was' : 'were'} not attached (${list}${tail}).`;
    default:
      return describeUnreadable(names);
  }
}
