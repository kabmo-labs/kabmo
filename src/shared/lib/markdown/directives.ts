/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plugin DIRECTIVES: a fenced block a plugin can claim and render as its own
 * component.
 *
 * Shared, not client-only, because the PARSER has to emit the placeholder and
 * the parser is shared — but the parser does not know which plugins exist (the
 * registry is client state), so it emits the placeholder for anything that
 * LOOKS like a directive and the renderer decides whether to hydrate it.
 *
 * That split is what keeps an unclaimed fence unchanged: the placeholder WRAPS
 * the ordinary code block rather than replacing it, so a fence no plugin claims
 * still renders as the code block it always was. The alternative — deciding in
 * the parser — would mean the server and a plugin-less client produced
 * different HTML for the same message.
 */

/** The class a directive's placeholder wrapper carries. */
export const DIRECTIVE_BLOCK_CLASS = 'plugin-directive-block';

/**
 * Whether a fence's language token is a directive.
 *
 * A COLON is the marker, and it is not arbitrary: `omp:chart` is
 * namespace-qualified, which is what tells a directive apart from a language a
 * syntax highlighter should handle. A plain `ts` fence is therefore untouched
 * by this whole mechanism.
 */
export function isDirectiveLanguage(lang: string): boolean {
  return lang.includes(':');
}

/**
 * The `key="value"` pairs from a fence's info line, after the language token.
 *
 * Deliberately tolerant: this runs on whatever a message contains, and an
 * unparseable attribute is dropped rather than failing the render — a message
 * with a stray quote is still a message.
 */
export function parseDirectiveAttributes(info: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  for (const match of info.matchAll(pattern)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

/** The HTML attribute carrying a directive's name, encoded so `"` cannot end it. */
export const DIRECTIVE_NAME_ATTR = 'data-plugin-directive';

/** The HTML attribute carrying its parsed attributes, URI-encoded as JSON. */
export const DIRECTIVE_ATTRS_ATTR = 'data-plugin-directive-attrs';

/**
 * Wrap a rendered code block as a claimable directive.
 *
 * The fallback stays INSIDE, which is what makes "unclaimed renders as before"
 * a structural property rather than a rule someone has to remember.
 */
export function directiveBlockHtml(
  name: string,
  attributes: Record<string, string>,
  fallbackHtml: string,
): string {
  const encoded = encodeURIComponent(JSON.stringify(attributes));
  return (
    `<div class="${DIRECTIVE_BLOCK_CLASS}" ${DIRECTIVE_NAME_ATTR}="${escapeAttribute(name)}" ` +
    `${DIRECTIVE_ATTRS_ATTR}="${escapeAttribute(encoded)}">${fallbackHtml}</div>`
  );
}

/** Escape a value for an HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Read a placeholder's attributes back. A malformed payload answers `{}`. */
export function readDirectiveAttributes(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}
