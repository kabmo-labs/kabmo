/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import postcss from 'postcss';

import { flattenNestedAtRules } from '@/server/lib/bundler/nested-at-rules';

/** Run the flattener and return the CSS it produced. */
async function flatten(css: string): Promise<string> {
  const result = await postcss([flattenNestedAtRules()]).process(css, { from: undefined });
  return result.css;
}

/** Every `&` left outside an escaped class name — an unflattened nesting marker. */
const unescapedAmpersands = (css: string): number => (css.match(/(?<!\\)&/g) ?? []).length;

describe('flattenNestedAtRules', () => {
  test('hoists a nested @supports out of a pseudo-element rule', async () => {
    // Tailwind's shape: a fallback declaration, then the color-mix refinement.
    const out = await flatten(
      `.placeholder-ink\\/40::placeholder {
        color: var(--color-ink);
        @supports (color: color-mix(in lab, red, red)) {
          color: color-mix(in oklab, var(--color-ink) 40%, transparent);
        }
      }`,
    );

    // The at-rule is at the top level and carries the resolved selector itself:
    // a nested rule whose parent names a pseudo-element is dropped by Chrome.
    expect(unescapedAmpersands(out)).toBe(0);
    expect(out).not.toMatch(/::placeholder\s*\{[^}]*@supports/);
    const root = postcss.parse(out);
    const atRules = root.nodes.filter((n) => n.type === 'atrule');
    expect(atRules).toHaveLength(1);
    expect(atRules[0].name).toBe('supports');
    expect(atRules[0].toString()).toContain('.placeholder-ink\\/40::placeholder');
    expect(atRules[0].toString()).toContain('color-mix');
  });

  test('keeps declaration order, so the cascade is unchanged', async () => {
    const out = await flatten(
      `.a { color: red; @supports (display: block) { color: blue; } border-radius: 3px; }`,
    );

    const root = postcss.parse(out);
    const order = root.nodes.map((node) =>
      node.toString().replace(/\s+/g, ' '),
    );
    // `border-radius` was written AFTER the at-rule and must still follow it —
    // moving it before would let the at-rule's `color` be overridden.
    expect(order).toHaveLength(3);
    expect(order[0]).toBe('.a { color: red; }');
    expect(order[1]).toContain('@supports');
    expect(order[2]).toBe('.a { border-radius: 3px; }');
  });

  test('hoists inside the layer that contained the rule, not to the root', async () => {
    const out = await flatten(
      `@layer base { .b::placeholder { color: red; @supports (display: block) { color: blue; } } }`,
    );
    expect(out).not.toMatch(/::placeholder\s*\{[^}]*@supports/);
    expect(unescapedAmpersands(out)).toBe(0);
    // The refinement stays inside `@layer base` — hoisting it past the layer
    // boundary would change which layer wins.
    const layer = postcss.parse(out).nodes.find((n) => n.type === 'atrule' && n.name === 'layer');
    expect(layer?.toString()).toContain('@supports');
  });

  test('resolves an explicit & and leaves other rules alone', async () => {
    const out = await flatten(
      `.card { color: red; @supports (display: block) { & { color: blue; } } }
       .plain { color: green; }`,
    );
    expect(out).not.toContain('&');
    const root = postcss.parse(out);
    const supports = root.nodes.find((n) => n.type === 'atrule');
    expect(supports?.toString()).toContain('.card');
    expect(root.toString()).toContain('.plain');
  });

  test('flattens a rule nested inside the hoisted at-rule on the next pass', async () => {
    const out = await flatten(
      `.outer { @supports (display: block) { .inner { color: blue; } } }`,
    );
    expect(unescapedAmpersands(out)).toBe(0);
    // The inner rule's selector is resolved against its parent, not left bare.
    expect(postcss.parse(out).toString()).toContain('.outer .inner');
  });

  test('leaves an already-flat stylesheet byte-identical', async () => {
    const flat = `.a { color: red; }
@supports (display: block) { .a { color: blue; } }
@layer base { .b { color: green; } }`;
    expect(await flatten(flat)).toBe(flat);
  });
});
