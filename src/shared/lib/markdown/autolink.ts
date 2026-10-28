/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * linkify-it autolinking that yields to code spans.
 *
 * linkify-it accepts a backtick as an email local-part character (RFC 5321's
 * `!#$%&'*+/=?^_`{|}~-` set), so `` `NNN+login@users.noreply.github.com` ``
 * matches as ONE autolink whose raw text spans both backticks. The extension
 * runs before marked's own inline rules, so that match is consumed and the code
 * span never forms: the backticks end up as link text and the href carries
 * `%60` escapes (`mailto:%60NNN+…%60`) — a broken link AND a code span that
 * shows its delimiters.
 *
 * A code span wins over an autolink in CommonMark, and the inline lexer reaches
 * the OPENING backtick first — so refusing every match whose raw contains a
 * backtick is enough to hand that position back to the `codespan` rule, which
 * then swallows the whole span. Autolinks without a backtick in them are
 * untouched, which is every ordinary URL and email.
 */

import type {
  MarkedExtension,
  RendererExtension,
  Token,
  TokenizerAndRendererExtension,
  TokenizerThis,
} from 'marked';
import markedLinkifyIt from 'marked-linkify-it';

/** Refuse an autolink whose raw text carries a backtick (see the file header). */
function guardAutolink(
  extension: TokenizerAndRendererExtension | RendererExtension,
): TokenizerAndRendererExtension | RendererExtension {
  if (!('tokenizer' in extension) || !extension.tokenizer) return extension;
  const tokenize = extension.tokenizer;
  return {
    ...extension,
    tokenizer(this: TokenizerThis, source: string, tokens: Token[]) {
      const token = tokenize.call(this, source, tokens);
      return token && !token.raw.includes('`') ? token : undefined;
    },
  };
}

export function codeSafeAutolink(): MarkedExtension {
  return { extensions: (markedLinkifyIt().extensions ?? []).map(guardAutolink) };
}
