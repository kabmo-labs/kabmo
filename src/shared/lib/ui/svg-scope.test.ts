/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Scoping an SVG's ids, and the two failures it exists to prevent.
 *
 * Both are silent: the picture still draws, just with the wrong paint. These
 * cases therefore assert the REFERENCES, not the declarations — a rename that
 * updated `id="body"` but left `fill="url(#body)"` pointing at the old name
 * would look correct in any test that only counted ids.
 */

import { describe, expect, test } from 'bun:test';
import { nextSvgScopePrefix, scopeSvgIds } from '@/shared/lib/ui/svg-scope';

describe('scopeSvgIds', () => {
  test('renames the declaration and every reference shape with it', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<defs>',
      '<linearGradient id="body"><stop offset="0" stop-color="#fff"/></linearGradient>',
      '<clipPath id="cut"><circle cx="1" cy="1" r="1"/></clipPath>',
      '<style>#body { stroke: url(#cut); }</style>',
      '</defs>',
      '<ellipse fill="url(#body)" clip-path="url(#cut)" style="stroke:url(#body)"/>',
      '<use xlink:href="#body"/>',
      '</svg>',
    ].join('');

    const scoped = scopeSvgIds(svg, 'svg7-');

    expect(scoped).toContain('id="svg7-body"');
    expect(scoped).toContain('id="svg7-cut"');
    expect(scoped).toContain('fill="url(#svg7-body)"');
    expect(scoped).toContain('clip-path="url(#svg7-cut)"');
    expect(scoped).toContain('style="stroke:url(#svg7-body)"');
    expect(scoped).toContain('xlink:href="#svg7-body"');
    // The stylesheet's SELECTOR half is rewritten...
    expect(scoped).toContain('#svg7-body { stroke: url(#svg7-cut); }');
    // ...and no reference still names an unprefixed id (colours like `#fff`
    // are not references, so they are matched by the URI forms only).
    expect(scoped).not.toMatch(/url\(#(?!svg7-)/);
    expect(scoped).not.toMatch(/href="#(?!svg7-)/);
    expect(scoped).toContain('stop-color="#fff"');
  });

  test('a stylesheet declaration keeps a hex colour that looks like an id', () => {
    // `#abc` in a DECLARATION is a colour, and an id named `abc` is not a
    // reason to rewrite it: doing so would repaint the shape with nothing.
    const scoped = scopeSvgIds(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>#abc, #def { fill: #abc }</style><rect id="abc"/><rect id="def"/></svg>',
      'svg2-',
    );
    expect(scoped).toContain('#svg2-abc, #svg2-def { fill: #abc }');
  });

  test('a cross-document href is left alone, a same-document fragment is not', () => {
    const scoped = scopeSvgIds(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="g1"/><use href="other.svg#g1"/><use href="#g1"/></svg>',
      'svg9-',
    );
    expect(scoped).toContain('href="other.svg#g1"');
    expect(scoped).toContain('href="#svg9-g1"');
  });

  test('an ARIA idref LIST is rewritten entry by entry', () => {
    const scoped = scopeSvgIds(
      '<svg xmlns="http://www.w3.org/2000/svg"><title id="t1">t</title><desc id="d1">d</desc><g id="g1" aria-labelledby="t1 d1 g1 outside"/></svg>',
      'svg4-',
    );
    // `outside` is not declared here, so it is not ours to rename.
    expect(scoped).toContain('aria-labelledby="svg4-t1 svg4-d1 svg4-g1 outside"');
  });

  test('markup with no id is returned as the SAME string', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
    expect(scopeSvgIds(markup, 'svg1-')).toBe(markup);
  });

  test('an already-scoped document is not prefixed twice', () => {
    const scoped = scopeSvgIds('<svg><rect id="a"/><use href="#a"/></svg>', 'svg5-');
    expect(scopeSvgIds(scoped, 'svg5-')).toBe(scoped);
  });
});

describe('nextSvgScopePrefix', () => {
  test('every call is a fresh, XML-name-safe prefix', () => {
    const a = nextSvgScopePrefix();
    const b = nextSvgScopePrefix();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^svg\d+-$/);
    // An id may not begin with a digit, so the prefix cannot either.
    expect(a).toMatch(/^[A-Za-z_]/);
  });
});
