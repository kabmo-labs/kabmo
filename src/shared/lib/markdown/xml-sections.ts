/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * XML section wrappers → markdown headings.
 *
 * omp's `xd://` device docs are markdown, but several sections are marked with
 * an XML-ish wrapper instead of a heading: `<instruction>…</instruction>`,
 * `<examples>…</examples>`, `<critical>…</critical>`. The markdown pipeline
 * escapes source HTML (agent output renders markup as data), so the read panel
 * showed `<instruction>` and `</instruction>` as literal lines and the sections
 * ran together as ordinary prose — the wrap did no visual work at all.
 *
 * Converting them before the markdown parse is the only place both halves can
 * be dropped: marked would otherwise treat a bare tag line as an HTML block,
 * and DOMPurify's profile strips it only after the paragraph boundaries are
 * already decided.
 *
 * Deliberately narrow, because the same text path renders real markdown files:
 *
 * - A wrapper must occupy a WHOLE line AND be valid: an opening line closed by
 *   the same name, properly nested. `<slug>` inside a sentence, a lone
 *   `<summary>`, a stray `</tag>`, and a tag carrying attributes
 *   (`<system-reminder reason="…">`, which the output envelope already reads)
 *   are left byte-for-byte as they were.
 * - Nothing inside a fenced code block is touched: a doc that shows the tags
 *   as an example must keep showing them as text.
 * - Nesting moves the heading level down one, capped at `h6`; the first level
 *   is `h2`, since the document's own `#` title is `h1`.
 */

/** A wrapper line: `<name>` / `</name>`, nothing else on the line. */
const OPEN_RE = /^<([A-Za-z][\w-]*)>$/;
const CLOSE_RE = /^<\/([A-Za-z][\w-]*)>$/;

/** One wrapper line, and the pair it forms when a matching close arrives. */
interface Section {
  name: string;
  openIndex: number;
  /** The wrapper this one sits inside — matched or not; the level check sorts
   *  that out once the whole source has been scanned. */
  parent?: Section;
  /** Line index of the closing wrapper, once the pair was matched. */
  closeIndex?: number;
}

/** A fence opener or closer, indented no more than markdown allows. */
function fenceAt(line: string): { char: string; length: number } | undefined {
  const body = line.trimStart();
  if (line.length - body.length > 3) return undefined;
  const match = /^(`{3,}|~{3,})/.exec(body);
  return match ? { char: match[1][0], length: match[1].length } : undefined;
}

/** `security-scan` → `Security Scan`; an already-capitalized name is kept. */
function sectionLabel(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Rewrite standalone XML wrapper pairs into `##`-level headings, and drop the
 * closing wrapper lines.
 *
 * A wrapper only counts when it is VALID: an opening line and a closing line
 * with the same name, properly nested against every other wrapper around it. A
 * stray `<tag>`, a stray `</tag>`, and a crossed pair (`<a><b></a></b>`) stay
 * literal — they are text about markup, not a section of the document.
 */
export function xmlSectionsToHeadings(source: string): string {
  if (!source.includes('<')) return source;

  const lines = source.split('\n');

  // Which lines sit inside a fenced code block, so the scan below can skip
  // them. A fence is closed by a run of the same character that is at least as
  // long as the one that opened it.
  const inFence: boolean[] = [];
  let fence: { char: string; length: number } | undefined;
  for (const line of lines) {
    const candidate = fenceAt(line);
    if (fence) {
      inFence.push(true);
      if (candidate && candidate.char === fence.char && candidate.length >= fence.length) fence = undefined;
      continue;
    }
    if (candidate) fence = candidate;
    inFence.push(candidate !== undefined);
  }

  const stack: Section[] = [];
  /** The opening line index of every valid pair, and where its close sits. */
  const headings = new Map<number, Section>();
  const closes = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    if (inFence[index]) continue;
    const text = lines[index].trim();

    const closed = CLOSE_RE.exec(text);
    if (closed) {
      // Strict nesting: only the wrapper that is actually open can be closed.
      const opener = stack[stack.length - 1];
      if (!opener || opener.name !== closed[1]) continue;
      stack.pop();
      opener.closeIndex = index;
      headings.set(opener.openIndex, opener);
      closes.add(index);
      continue;
    }

    const opened = OPEN_RE.exec(text);
    if (opened) stack.push({ name: opened[1], openIndex: index, parent: stack[stack.length - 1] });
  }

  if (headings.size === 0) return source;

  /** Heading level from the nesting of VALID ancestors only: an unmatched
   *  wrapper stays literal text and therefore contributes no level. */
  const level = (section: Section): number => {
    const parent = section.parent;
    if (!parent || parent.closeIndex === undefined) return 2;
    return Math.min(6, level(parent) + 1);
  };

  return lines
    .map((line, index) => {
      const section = headings.get(index);
      if (section) return `${'#'.repeat(level(section))} ${sectionLabel(section.name)}`;
      if (closes.has(index)) return '';
      return line;
    })
    .join('\n');
}