/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Conditional requests for the assets this server serves itself.
 *
 * Two routes hand out bytes and both need the same answer to "is the client's
 * copy still good?" — `plugins/static.ts`, from a file on disk, and
 * `lib/assets/dev-assets.server.ts`, from bytes it just read back through Bun's
 * dev asset routes. They must agree: a rule applied to one and not the other
 * would make one asset kind revalidate differently from another for no reason a
 * caller could see, so the decision lives here rather than in either caller.
 *
 * The precedence is the load-bearing part. RFC 9110 §13.1.3: a recipient MUST
 * ignore `If-Modified-Since` when the request carries `If-None-Match`. So the
 * presence of `If-None-Match` settles the response on its own — a non-match
 * means "the client's copy is stale" (200), never a reason to consult the date.
 *
 * Every path here errs toward `false`. A `false` costs one full response; a
 * wrong `true` hands the client a stale asset with no way to notice.
 */

/**
 * Whether the client's stored copy is still current, so the caller can answer
 * `304` and skip the body.
 *
 * `lastModifiedMs` is the file's own mtime; pass null when there is no file
 * behind the bytes (the dev proxy hashes what it fetched instead).
 */
export function notModified(request: Request, etag: string | null, lastModifiedMs: number | null): boolean {
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch !== null) {
    if (!etag) return false;
    // A validator survives a `W/` prefix and arrives as a candidate list.
    const wanted = etag.trim().replace(/^W\//, '');
    return ifNoneMatch.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === wanted);
  }

  const ifModifiedSince = request.headers.get('if-modified-since');
  if (ifModifiedSince && lastModifiedMs !== null) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since)) {
      // HTTP dates carry one-second resolution, so the mtime is floored to match
      // before comparing. Without the floor a file whose mtime has a fractional
      // part is always "newer" than the `Last-Modified` this server just sent
      // for it, and no request could ever revalidate.
      return Math.floor(lastModifiedMs / 1000) * 1000 <= since;
    }
  }

  return false;
}
