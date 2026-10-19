/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Confine a plugin's stylesheet to that plugin's own DOM.
 *
 * A plugin's CSS is served into the HOST's document — no iframe, no shadow root
 * — so without a boundary every rule it writes applies to the whole app. That
 * was the leak: the pattern this SDK used to recommend (`html[data-my-plugin]
 * .code-block::before`) selects the app's OWN code blocks, because `html[…]` is
 * an ancestor of everything rather than a scope.
 *
 * The boundary is `@scope`, rooted at the attribute the host puts on every
 * element a plugin's DOM lives in ({@link PLUGIN_SURFACE_ATTR}, value = plugin
 * id). The host writes that attribute in exactly two places — the kit's
 * `PluginIdProvider` (every slot component) and a content script's root element
 * — so a rule a plugin writes can only reach its own markup, and cannot be
 * escaped from inside the scope (`:root`/`html` inside a nested `@scope` do not
 * re-widen it; verified in Chromium).
 *
 * Two details are load-bearing:
 *
 * - **`@charset`, `@import` and `@namespace` are HOISTED out of the scope.**
 *   Those three are only honoured at the top level, so wrapping them inside
 *   `@scope` silently discards them — a remote `@import` would simply not load
 *   (measured: the imported rule did not apply). Everything else that nests
 *   (`@media`, `@supports`, `@layer`, `@keyframes`, `@font-face`, `@property`)
 *   is fine inside and is left alone.
 * - **A rule the plugin writes that names host markup now matches nothing.**
 *   That is the point, not a regression: the fix is for the plugin to style its
 *   own DOM, which is why the content-script contract hands it a root element.
 *
 * `@scope` is supported in Chromium 118+, Safari 17.4+ and Firefox 128+. On an
 * older engine the whole stylesheet is dropped rather than applied unscoped —
 * the failure is a plugin that looks unstyled, never a plugin that restyles the
 * host.
 */

import { pluginSurfaceSelector } from '@kabmo-labs/plugin-sdk';

/** The at-rules that are only honoured at the top level of a stylesheet. */
const TOP_LEVEL_STATEMENTS: Record<string, true> = {
  charset: true,
  import: true,
  namespace: true,
};

interface SplitCss {
  /** The hoisted at-rule statements, in their original order. */
  prelude: string;
  /** Everything else, in its original order. */
  body: string;
}

/**
 * Split a stylesheet into the statements that must stay top-level and the rest.
 *
 * A character scan rather than a regex: `;` inside a string (`@import
 * url("a;b.css")`) or inside a comment would end a naive match early, and a
 * brace inside a string would break a depth count. The scan tracks strings,
 * comments and brace depth so a statement is only recognised where one can
 * actually start.
 */
function splitTopLevelStatements(css: string): SplitCss {
  const prelude: string[] = [];
  const body: string[] = [];
  let depth = 0;
  let index = 0;

  while (index < css.length) {
    const char = css[index];

    if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      const stop = end < 0 ? css.length : end + 2;
      body.push(css.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      const stop = endOfString(css, index);
      body.push(css.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === '{') {
      depth += 1;
      body.push(char);
      index += 1;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      body.push(char);
      index += 1;
      continue;
    }
    if (char === '@' && depth === 0) {
      const name = /^@([a-zA-Z-]+)/.exec(css.slice(index))?.[1]?.toLowerCase();
      if (name && TOP_LEVEL_STATEMENTS[name]) {
        const end = endOfStatement(css, index);
        // A statement form always ends in `;`. Without one the `@` is part of
        // something this scan does not recognise, so it is left in the body
        // rather than swallowed.
        if (end >= 0) {
          prelude.push(css.slice(index, end + 1));
          index = end + 1;
          continue;
        }
      }
    }

    body.push(char);
    index += 1;
  }

  return { prelude: prelude.join('\n'), body: body.join('') };
}

/** The index just past the string literal that opens at `start`. */
function endOfString(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    const char = css[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    // An unterminated string runs to the end; the caller's slice handles it.
    index += 1;
  }
  return css.length;
}

/**
 * The index of the `;` that ends the statement opening at `start`, or -1.
 *
 * `indexOf(';')` is wrong here: `@import url("a;b.css")` carries a semicolon
 * inside its string, and cutting there would hoist `@import url("a;` — a
 * statement that loads nothing — and leave `b.css");` as a stray rule.
 */
function endOfStatement(css: string, start: number): number {
  let index = start;
  while (index < css.length) {
    const char = css[index];
    if (char === '"' || char === "'") {
      index = endOfString(css, index);
      continue;
    }
    if (char === ';') return index;
    index += 1;
  }
  return -1;
}

/**
 * A plugin's stylesheet, scoped to its own surfaces.
 *
 * The prelude is emitted first because `@charset`/`@import`/`@namespace` are
 * only honoured before any other rule — a hoisted statement placed after the
 * `@scope` block would be ignored exactly as it was inside it.
 */
export function scopePluginCss(css: string, pluginId: string): string {
  const { prelude, body } = splitTopLevelStatements(css);
  const scoped = `@scope (${pluginSurfaceSelector(pluginId)}) {\n${body}\n}\n`;
  return prelude ? `${prelude}\n${scoped}` : scoped;
}
