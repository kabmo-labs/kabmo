import type { HighlighterCore } from 'shiki/core';

import { escapeCode, getHighlighterSync, requestLanguage } from '@/shared/lib/code/highlighter';
import { tokenMarkup, type HighlightLinesOptions } from '@/shared/lib/code/editor/marks';
import { lineStartOffset } from '@/shared/lib/code/editor/lines';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

export type { HighlightLinesOptions };


/**
 * Pick a language that can be tokenized *synchronously* right now. A grammar
 * that has not arrived yet is requested here (fire-and-forget) and the caller
 * falls back to javascript for this pass — `onLanguageReady` re-runs the
 * highlight once it lands. `getLoadedLanguages()` stays the authority for
 * embedded/alias names that `LANG_LOADERS` does not list by id.
 */
function resolveReadyLang(hl: HighlighterCore, language: string): string {
  if (requestLanguage(language) || hl.getLoadedLanguages().includes(language)) return language;
  return 'javascript';
}

/** Syntax highlight code string safely with fallback */
export function highlightCode(code: string, language = 'javascript', options: HighlightLinesOptions = {}): string {
  if (!code) return '';
  // A find in progress needs the match markup, which only the line-based path
  // emits; without it the fast `codeToHtml` path is left exactly as it was.
  if (options.marks && options.marks.length > 0) {
    return `<span class="shiki">${highlightLines(code, language, options).join('\n')}</span>`;
  }
  const hl = getHighlighterSync();
  if (!hl) return escapeCode(code);
  const lang = resolveReadyLang(hl, language);
  try {
    return `<span class="shiki">${hl.codeToHtml(code, {
      lang,
      themes: SHIKI_THEMES,
      defaultColor: false,
      structure: 'inline',
    })}</span>`;
  } catch {
    return escapeCode(code);
  }
}

export interface JsonDetectionResult {
  isValid: boolean;
  data?: any;
  pretty?: string;
  linesCount?: number;
}

/** Check if input is valid JSON (or object/array) and return pretty-printed string with line count */
export function tryParseJson(input: unknown): JsonDetectionResult {
  if (input === null || input === undefined) return { isValid: false };

  // 1. If already an object or array (and not primitive)
  if (typeof input === 'object') {
    try {
      const pretty = JSON.stringify(input, null, 2);
      const linesCount = pretty.split('\n').length;
      return { isValid: true, data: input, pretty, linesCount };
    } catch {
      return { isValid: false };
    }
  }

  if (typeof input !== 'string') return { isValid: false };

  let text = input.trim();
  if (!text) return { isValid: false };

  // 2. If wrapped in markdown code fence ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // 3. Strip common prefixes like "User selected: { ... }" or "User response: { ... }"
  const prefixMatch = text.match(/^(?:user\s+(?:selected|responded|answered|response)|response|result|output):\s*([\s\S]+)$/i);
  if (prefixMatch) {
    const candidate = prefixMatch[1].trim();
    if ((candidate.startsWith('{') && candidate.endsWith('}')) || (candidate.startsWith('[') && candidate.endsWith(']'))) {
      text = candidate;
    }
  }

  // 4. Handle double-stringified / quoted JSON strings, e.g. "\"{\\\"a\\\":1}\"" or '"{...}"'
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      const unquoted = JSON.parse(text);
      if (typeof unquoted === 'object' && unquoted !== null) {
        const pretty = JSON.stringify(unquoted, null, 2);
        return { isValid: true, data: unquoted, pretty, linesCount: pretty.split('\n').length };
      }
      if (typeof unquoted === 'string') {
        const nested = tryParseJson(unquoted);
        if (nested.isValid) return nested;
      }
    } catch {
      // not double-quoted JSON, continue
    }
  }

  // 5. Check if starts with { or [
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const data = JSON.parse(text);
      if (data !== null && typeof data === 'object') {
        const pretty = JSON.stringify(data, null, 2);
        const linesCount = pretty.split('\n').length;
        return { isValid: true, data, pretty, linesCount };
      }
    } catch {
      // not direct JSON
    }
  }

  // 6. Look for embedded JSON object/array within text: e.g. "Response: {...}"
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      const data = JSON.parse(candidate);
      if (data !== null && typeof data === 'object') {
        const pretty = JSON.stringify(data, null, 2);
        return { isValid: true, data, pretty, linesCount: pretty.split('\n').length };
      }
    } catch {
      // ignore
    }
  }

  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = text.slice(firstBracket, lastBracket + 1);
    try {
      const data = JSON.parse(candidate);
      if (Array.isArray(data)) {
        const pretty = JSON.stringify(data, null, 2);
        return { isValid: true, data, pretty, linesCount: pretty.split('\n').length };
      }
    } catch {
      // ignore
    }
  }

  return { isValid: false };
}

/** Syntax highlight JSON string */
export function highlightJson(code: string): string {
  return highlightCode(code, 'json');
}

/**
 * Highlight code and return one HTML fragment per line, aligned 1:1 with
 * `code.split('\n')`. Tokenizes the whole input at once so multi-line grammar
 * state (block comments, template literals) survives, unlike per-line calls.
 */
export function highlightLines(
  code: string,
  language = 'javascript',
  options: HighlightLinesOptions = {},
): string[] {
  const rawLines = code.split('\n');
  const marks = options.marks;
  const currentMark = options.currentMark ?? -1;
  // A grammar that has not arrived yet, or a highlighter that failed to boot,
  // still gets the find marks: the widget's feedback must not depend on Shiki.
  const plain = (lineIndex: number): string => {
    if (!marks || marks.length === 0) return escapeCode(rawLines[lineIndex]);
    return tokenMarkup(rawLines[lineIndex], lineStartOffset(code, lineIndex), marks, currentMark);
  };
  if (!code) return rawLines;
  const hl = getHighlighterSync();
  if (!hl) return rawLines.map((_line, index) => plain(index));
  const lang = resolveReadyLang(hl, language);
  try {
    const { tokens } = hl.codeToTokens(code, {
      lang,
      themes: SHIKI_THEMES,
      defaultColor: false,
      tokenizeMaxLineLength: options.maxLineLength ?? 0,
    });
    if (tokens.length !== rawLines.length) return rawLines.map((_line, index) => plain(index));
    return tokens.map((lineTokens, lineIndex) => {
      let offset = lineStartOffset(code, lineIndex);
      return lineTokens
        .map((tok) => {
          const content = tokenMarkup(tok.content, offset, marks, currentMark);
          offset += tok.content.length;
          if (!tok.htmlStyle) return content;
          const style = Object.entries(tok.htmlStyle)
            .map(([key, value]) => `${key}:${value}`)
            .join(';');
          return style ? `<span style="${style}">${content}</span>` : content;
        })
        .join('');
    });
  } catch {
    return rawLines.map((_line, index) => plain(index));
  }
}
