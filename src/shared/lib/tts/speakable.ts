/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Markdown → the segments a speech engine should read.
 *
 * The assistant writes markdown for a screen: fenced code, tables, link
 * targets, file paths and emphasis markers. Speaking that text verbatim is the
 * classic text-to-speech failure — a 40-line diff read aloud, a URL spelled
 * character by character, `**bold**` pronounced as asterisks. The rules here
 * mirror omp's own `SpeakableStream`: drop what cannot be spoken, speak a
 * link's label instead of its target, a URL's host instead of its path, and a
 * long path's basename.
 *
 * Pure and synchronous. The player owns timing, network and playback; this
 * module only answers "what is worth saying, and where may a request end?".
 */

const FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^()]*)\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^()]*)\)/g;
const AUTOLINK_RE = /<(https?:\/\/[^\s>]+)>/g;
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>()"'\]]+|\bwww\.[\w-]+(?:\.[\w-]+)+[^\s<>()"'\]]*/g;
const INLINE_CODE_RE = /`{1,2}([^`]+)`{1,2}/g;
const BOLD_STRIKE_RE = /\*\*|__|~~/g;
const EMPHASIS_ASTERISK_RE = /\*(?=\S)|(?<=\S)\*/g;
const EMPHASIS_UNDERSCORE_RE = /(^|\s)_+|_+(?=\s|$)/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][^<>]*>/g;
const HR_INLINE_RE = /(^|\s)[-*_]{3,}(?=\s|$)/g;
const PATH_RE = /(^|[\s("'`])((?:~|\.{1,2})?\/?[\w.@+-]+(?:\/[\w.@+-]+){2,}\/?)/g;
const HAS_SPEAKABLE_RE = /[\p{L}\p{N}]/u;
const SENTENCE_BOUNDARY_RE = /[.!?…]+[)\]"'»”’]*\s/g;
const ABBREVIATION_RE = /(?:^|\s)(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|St|No)\.$/i;
/**
 * A paragraph this short never ends a request on its own: headings, one-line
 * bullets and answer fragments would otherwise spend a spawn/round-trip each.
 * Longer paragraphs do end one, which is what makes the read follow the
 * writer's pauses.
 */
const PARAGRAPH_FLOOR = 120;

/** "https://github.com/foo/bar?x#y" → "github.com". */
function speakableUrl(url: string): string {
  return url
    .replace(/^[a-z][\w+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[/?#].*$/, '');
}

/** One raw slice → its speakable form; '' when nothing is worth vocalizing. */
function normalizeSpeakable(raw: string): string {
  const spoken = raw
    .replace(IMAGE_RE, '$1')
    .replace(LINK_RE, '$1')
    .replace(AUTOLINK_RE, (_match, url: string) => speakableUrl(url))
    .replace(BARE_URL_RE, (match) => speakableUrl(match))
    .replace(INLINE_CODE_RE, '$1')
    .replace(BOLD_STRIKE_RE, '')
    .replace(EMPHASIS_ASTERISK_RE, '')
    .replace(EMPHASIS_UNDERSCORE_RE, '$1')
    .replace(HTML_TAG_RE, ' ')
    .replace(HR_INLINE_RE, '$1')
    .replace(PATH_RE, (_match, lead: string, path: string) => {
      const parts = path.split('/').filter((part) => part.length > 0);
      return lead + (parts[parts.length - 1] ?? path);
    })
    .replace(/\s+/g, ' ')
    .trim();
  return HAS_SPEAKABLE_RE.test(spoken) ? spoken : '';
}

/** A line that carries no speakable prose. */
function isSilentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('|')) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) return true;
  return false;
}

/** Strip block markup from one block of lines, then normalize the prose. */
function speakableBlock(block: string): string {
  const lines = block.split('\n').flatMap((line) => {
    if (isSilentLine(line)) return [];
    let text = line;
    text = text.replace(/^\s{0,3}#{1,6}\s+/, '');
    text = text.replace(/^\s{0,3}>\s?/, '');
    text = text.replace(/^\s{0,3}[-*+]\s+/, '');
    text = text.replace(/^\s{0,3}(\d{1,3})[.)]\s+/, '$1. ');
    return text.trim() ? [text.trim()] : [];
  });
  return normalizeSpeakable(lines.join(' '));
}

/**
 * The speakable paragraphs, in order.
 *
 * A blank line is the writer's own pause: a request may end there and the
 * reader hears a paragraph break instead of one unbroken stream. Lines inside
 * a block join with a space — a heading and the paragraph under it are separate
 * sentences by punctuation, not by the layout.
 */
export function speakableParagraphs(markdown: string): string[] {
  return markdown
    .replace(FENCE_RE, '\n\n')
    .split(/\n{2,}/)
    .map(speakableBlock)
    .filter(Boolean);
}

/** The whole answer as one prose string (the paragraphs, joined). */
export function speakableText(markdown: string): string {
  return speakableParagraphs(markdown).join(' ');
}

/** Sentence boundaries that exist in `text`, as end offsets. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  SENTENCE_BOUNDARY_RE.lastIndex = 0;
  for (let match = SENTENCE_BOUNDARY_RE.exec(text); match; match = SENTENCE_BOUNDARY_RE.exec(text)) {
    const cut = match.index + match[0].length;
    const head = text.slice(0, cut).trimEnd();
    if (ABBREVIATION_RE.test(head)) continue;
    if ((head.match(/`/g)?.length ?? 0) % 2 !== 0) continue;
    ends.push(cut);
  }
  return ends;
}

/** Latest position at or below `max` that ends a word. */
function wordCut(text: string, max: number): number {
  const space = text.lastIndexOf(' ', max);
  return space > 0 ? space + 1 : Math.min(max, text.length);
}

/** Split one sentence that exceeds `max` into word-sized pieces. */
function splitLong(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const cut = wordCut(rest, max);
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** The sentences of one paragraph, in order. */
function sentencesOf(paragraph: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const end of sentenceEnds(paragraph)) {
    const sentence = paragraph.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const tail = paragraph.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/**
 * The request-sized pieces of an answer, in order.
 *
 * Two constraints decide a boundary. The paragraph is the writer's own pause,
 * so a chunk ends there once it carries a paragraph's worth of speech: the
 * player can start reading the first paragraph while the rest is still being
 * synthesized, and the reader hears the break. `maxChars` is the engine's hard
 * ceiling and `firstMax` is smaller on purpose — the first request decides
 * time-to-first-audio, so it is the first paragraph (or its first sentences),
 * not a 600-character block that spends seconds synthesizing before a sound.
 */
export function speechChunks(
  markdown: string,
  maxChars: number,
  firstMax = Math.min(160, maxChars),
): string[] {
  const paragraphs = speakableParagraphs(markdown);
  if (paragraphs.length === 0) return [];
  const limit = Math.max(1, Math.floor(maxChars));
  const firstLimit = Math.max(1, Math.min(Math.floor(firstMax), limit));

  const chunks: string[] = [];
  let current = '';
  let currentLimit = firstLimit;
  const flush = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
    currentLimit = limit;
  };

  for (const paragraph of paragraphs) {
    for (const sentence of sentencesOf(paragraph)) {
      for (const piece of sentence.length > currentLimit ? splitLong(sentence, currentLimit) : [sentence]) {
        const joined = current ? `${current} ${piece}` : piece;
        if (joined.length > currentLimit) {
          flush();
          current = piece;
        } else {
          current = joined;
        }
      }
    }
    if (current.length >= Math.min(currentLimit, PARAGRAPH_FLOOR)) flush();
  }
  flush();
  return chunks.filter((chunk) => HAS_SPEAKABLE_RE.test(chunk));
}
