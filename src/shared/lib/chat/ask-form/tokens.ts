/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A tolerant tokenizer for agent-written form HTML, and the text helpers the
 * field walk needs.
 *
 * Only what `ask-form/index.ts` reads: tags with attributes, text with entities
 * decoded, and the `</tag>` that closes an open one. No tree is built — the walk
 * holds its own label/fieldset context, which is the only structure the question
 * derivation needs.
 */

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'open'; tag: string; attrs: Record<string, string>; selfClosing: boolean };

const TAG = /<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Elements that start a line of their own: their boundaries end a text block. */
export const BLOCK: Record<string, true> = {
  address: true,
  article: true,
  aside: true,
  blockquote: true,
  dd: true,
  details: true,
  dialog: true,
  div: true,
  dl: true,
  dt: true,
  figcaption: true,
  figure: true,
  footer: true,
  header: true,
  main: true,
  nav: true,
  p: true,
  section: true,
  summary: true,
};

/** Headings, which are text blocks with a weight — omp treats them as text. */
export const HEADING: Record<string, true> = {
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
};

/** Elements whose content is never visible as text. */
export const SKIPPED: Record<string, true> = {
  button: true,
  head: true,
  iframe: true,
  link: true,
  meta: true,
  noscript: true,
  script: true,
  style: true,
  template: true,
  title: true,
};

const VOID: Record<string, true> = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  source: true,
  track: true,
  wbr: true,
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(raw))) {
    const name = match[1].toLowerCase();
    if (!name || name === '/') continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  TAG.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(html))) {
    if (match.index > cursor) tokens.push({ kind: 'text', text: decodeEntities(html.slice(cursor, match.index)) });
    cursor = match.index + match[0].length;
    const closing = match[0].startsWith('</');
    const tag = match[1].toLowerCase();
    if (closing) {
      tokens.push({ kind: 'open', tag: `/${tag}`, attrs: {}, selfClosing: false });
      continue;
    }
    const selfClosing = VOID[tag] === true || /\/\s*$/.test(match[2] ?? '');
    tokens.push({ kind: 'open', tag, attrs: parseAttrs(match[2] ?? ''), selfClosing });
  }
  if (cursor < html.length) tokens.push({ kind: 'text', text: decodeEntities(html.slice(cursor)) });
  return tokens;
}

/** Index of the `</tag>` that closes the open tag at `start`, or the last index. */
export function matchingClose(tokens: Token[], start: number, tag: string): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'open') continue;
    if (token.tag === tag && !token.selfClosing) depth += 1;
    else if (token.tag === `/${tag}`) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return tokens.length;
}

/** Visible text of a range, dropping nested controls; block boundaries become spaces. */
export function textOf(tokens: Token[], start: number, end: number): string {
  const parts: string[] = [];
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token.kind === 'text') {
      parts.push(token.text);
      continue;
    }
    const tag = token.tag.replace(/^\//, '');
    if (token.tag.startsWith('/')) {
      if (BLOCK[tag] || HEADING[tag] || tag === 'br' || tag === 'label') parts.push(' ');
      continue;
    }
    if (SKIPPED[tag]) {
      index = matchingClose(tokens, index, tag);
      continue;
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') continue;
    if (tag === 'br') parts.push('\n');
    else if (tag === 'img') parts.push(token.attrs.alt ?? '');
    else if (BLOCK[tag] || HEADING[tag]) parts.push(' ');
  }
  return oneLine(parts.join(''));
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `sentry_dsn` → `sentry dsn`, the label omp invents for a control with none. */
export function nameLabel(name: string): string {
  return name ? name.replace(/[_-]+/g, ' ') : '';
}

/** First element named `tag` in a range, or -1. */
export function findChild(tokens: Token[], start: number, end: number, tag: string): number {
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'open' || token.tag !== tag) continue;
    return index;
  }
  return -1;
}

/** Whether a range contains a control, so a list is layout rather than prose. */
export function hasControl(tokens: Token[], start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token.kind === 'open' && (token.tag === 'input' || token.tag === 'select' || token.tag === 'textarea')) {
      return true;
    }
  }
  return false;
}
