/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The drawio adapter: what Kabmo decides around the library's rendering.
 *
 * Pure — the library is string → string and needs no DOM — so these run under
 * `bun test` unchanged. The claims are the ones that fail silently: a five-page
 * document showing only page one, a refusal rendered as a blank page, and a
 * placeholder drawn without saying so.
 */

import { describe, expect, test } from 'bun:test';
import { renderDrawioPages } from '@/client/components/workspace/editor/viewers/drawio-pages';

const page = (name: string, label: string, style = '') =>
  `<diagram name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
  `<mxCell id="a" value="${label}" ${style ? `style="${style}" ` : ''}vertex="1" parent="1">` +
  `<mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>` +
  `</root></mxGraphModel></diagram>`;

describe('renderDrawioPages', () => {
  test('draws every page in document order', () => {
    const result = renderDrawioPages(`<mxfile>${page('One', 'First')}${page('Two', 'Second')}</mxfile>`, 'p-');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.pages.map((p) => p.name)).toEqual(['One', 'Two']);
    expect(result.pages[0].svg).toContain('First');
    expect(result.pages[1].svg).toContain('Second');
  });

  test('names an unnamed page by its position', () => {
    const result = renderDrawioPages('<mxfile><diagram><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>', 'p-');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.pages[0].name).toBe('Page 1');
  });

  // A shared id namespace makes the second SVG's `url(#…)` resolve to the
  // first one's definitions.
  test('namespaces ids per page and per mount', () => {
    const first = renderDrawioPages(`<mxfile>${page('One', 'A')}</mxfile>`, 'x-');
    const second = renderDrawioPages(`<mxfile>${page('One', 'A')}</mxfile>`, 'y-');
    if (first.status !== 'ready' || second.status !== 'ready') throw new Error('expected pages');
    expect(first.pages[0].svg).toContain('id="x-0-');
    expect(second.pages[0].svg).toContain('id="y-0-');
  });

  // The refusal is REPORTED with the parser's own sentence, never drawn as an
  // empty page.
  test('reports a file that is not drawio', () => {
    const result = renderDrawioPages('<html><body/></html>', 'p-');
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toContain('not a draw.io file');
  });

  test('reports a compressed page that is not base64', () => {
    const result = renderDrawioPages('<mxfile><diagram>!!!not-base64!!!</diagram></mxfile>', 'p-');
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toContain('base64');
  });

  // A vendor stencil is drawn as a labelled placeholder; the picture must say
  // so, or the placeholder reads as the file's own content.
  test('carries the renderer warnings through', () => {
    const result = renderDrawioPages(
      `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
        `<mxCell id="a" value="Lambda" style="shape=mxgraph.aws4.lambda_function;" vertex="1" parent="1">` +
        `<mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>`,
      'p-',
    );
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.pages[0].warnings.join(' ')).toContain('placeholder');
  });
});
