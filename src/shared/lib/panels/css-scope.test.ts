/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scoping a plugin's stylesheet to its own surfaces.
 *
 * This is the fix for a real leak: the demo plugin shipped
 * `html[data-session-info] .code-block::before` — the pattern the SDK itself
 * used to recommend — and it drew a gradient rule over every code block in the
 * chat, because `.code-block` is the HOST's class and `html[…]` is an ancestor
 * of everything rather than a scope. Every rule below is a silent failure when
 * it is wrong: an unscoped stylesheet restyles the host, and a mis-hoisted
 * `@import` simply never loads.
 *
 * The cases are asserted on the emitted CSS rather than in a browser because
 * the transform is pure text; the browser behaviour (`@scope` confines, a
 * `:root`/`html` escape does not re-widen it, at-rules nest) was verified in
 * Chromium while this was written.
 */

import { describe, expect, test } from 'bun:test';
import { scopePluginCss } from '@/shared/lib/panels/css-scope';

describe('scopePluginCss', () => {
  test('wraps the body in a scope rooted at the plugin id', () => {
    const out = scopePluginCss('.badge { color: red; }', 'demo');
    expect(out).toContain('@scope ([data-plugin-surface="demo"])');
    expect(out).toContain('.badge { color: red; }');
  });

  test('the id names the MANIFEST id, so the attribute the host writes matches', () => {
    // The host marks surfaces with the manifest id (the registry publishes it as
    // `pluginId`), never the directory name — a scope built from the wrong one
    // would root at an attribute no surface carries.
    expect(scopePluginCss('.x{}', 'session-info')).toContain('[data-plugin-surface="session-info"]');
  });

  test('hoists @charset, @import and @namespace above the scope', () => {
    // Only honoured at the top level: inside `@scope` an `@import` is discarded
    // and the imported rules never load (measured in Chromium).
    const out = scopePluginCss(
      '@charset "utf-8";\n@import url("./other.css");\n@namespace svg url(http://www.w3.org/2000/svg);\n.a { color: red; }',
      'demo',
    );
    const scopeAt = out.indexOf('@scope');
    expect(out.indexOf('@charset')).toBeLessThan(scopeAt);
    expect(out.indexOf('@import')).toBeLessThan(scopeAt);
    expect(out.indexOf('@namespace')).toBeLessThan(scopeAt);
    // And the body is still inside.
    expect(out).toContain('.a { color: red; }');
  });

  test('leaves a nested at-rule inside the scope', () => {
    // `@media`/`@supports`/`@layer`/`@keyframes`/`@font-face` DO nest, so moving
    // them would change what they mean.
    const out = scopePluginCss('@media (min-width: 1px) { .a { color: red; } }', 'demo');
    expect(out.indexOf('@media')).toBeGreaterThan(out.indexOf('@scope'));
  });

  test('a semicolon inside a string does not end an @import early', () => {
    const out = scopePluginCss('@import url("a;b.css");\n.a { color: red; }', 'demo');
    // The whole statement is hoisted, semicolon and all, and the body survives.
    expect(out).toContain('@import url("a;b.css");');
    expect(out).toContain('.a { color: red; }');
  });

  test('a brace inside a string does not break the depth count', () => {
    const out = scopePluginCss('.a::before { content: "}"; }\n.b { color: red; }', 'demo');
    // Both rules land in the body, not one of them outside the scope.
    expect(out.indexOf('.b')).toBeGreaterThan(out.indexOf('@scope'));
  });

  test('an @ inside a declaration is not treated as a top-level statement', () => {
    const out = scopePluginCss('.a { color: red; }\n.b { grid-template-areas: "a"; }', 'demo');
    expect(out).toContain('grid-template-areas: "a";');
  });

  test('a stylesheet with nothing but an @import scopes to an empty block', () => {
    const out = scopePluginCss('@import url("./x.css");', 'demo');
    expect(out).toStartWith('@import');
    expect(out).toContain('@scope ([data-plugin-surface="demo"])');
  });

  test('an empty stylesheet still produces a valid (inert) scope block', () => {
    const out = scopePluginCss('', 'demo');
    expect(out).toBe('@scope ([data-plugin-surface="demo"]) {\n\n}\n');
  });

  test('a quote in the id cannot escape the attribute selector', () => {
    // The manifest grammar already refuses this, so it is defence in depth for
    // any caller outside the manifest path.
    const out = scopePluginCss('.x{}', 'a"] .host { color: red } [x="');
    expect(out).toContain('\\"');
    expect(out).not.toContain('[data-plugin-surface="a"] .host');
  });
});
