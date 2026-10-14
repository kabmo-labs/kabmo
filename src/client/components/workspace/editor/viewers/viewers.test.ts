/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The document viewers, mounted against happy-dom.
 *
 * The unit tests above cover the pure halves (the CSV parser, the viewer-kind
 * table). What is left is the CONTRACT between a viewer and the surface around
 * it, and each claim here is one that fails silently in a browser:
 *
 * - a parser failure is REPORTED, never swallowed into an empty pane (a blank
 *   surface reads as "this file is empty");
 * - a CSV file renders as a grid with a header row, and a quoted cell keeps its
 *   comma instead of splitting the row;
 * - an SVG is drawn from the text buffer through DOMPurify, so a script in it
 *   never reaches the DOM;
 * - the viewer fetches its bytes ONCE per file, not once per render — the
 *   regression a fresh `loadBytes` closure would cause.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following `panel.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import type { CsvGrid as CsvGridType } from '@/client/components/workspace/editor/viewers/CsvGrid';
import type { SvgPreview as SvgPreviewType } from '@/client/components/workspace/editor/viewers/SvgPreview';
import type { DocxView as DocxViewType } from '@/client/components/workspace/editor/viewers/DocxView';
import type { SheetView as SheetViewType } from '@/client/components/workspace/editor/viewers/SheetView';
import type { ViewerSurface as ViewerSurfaceType, hasViewerSurface as HasViewerSurfaceType } from '@/client/components/workspace/editor/viewers/dispatch';

let CsvGrid: typeof CsvGridType;
let SvgPreview: typeof SvgPreviewType;
let DocxView: typeof DocxViewType;
let SheetView: typeof SheetViewType;
let ViewerSurface: typeof ViewerSurfaceType;
let hasViewerSurface: typeof HasViewerSurfaceType;
let container: HTMLElement;

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  ({ CsvGrid } = await import('@/client/components/workspace/editor/viewers/CsvGrid'));
  ({ SvgPreview } = await import('@/client/components/workspace/editor/viewers/SvgPreview'));
  ({ DocxView } = await import('@/client/components/workspace/editor/viewers/DocxView'));
  ({ SheetView } = await import('@/client/components/workspace/editor/viewers/SheetView'));
  ({ ViewerSurface, hasViewerSurface } = await import('@/client/components/workspace/editor/viewers/dispatch'));
});

afterAll(() => restoreDomGlobals());

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

/** Mount a node and settle one async pass. */
async function mount(node: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node as never, container);
  });
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
  return container;
}

describe('CsvGrid', () => {
  test('renders a header row and the data rows', async () => {
    await mount(h(CsvGrid, { content: 'Name,Qty\nWidget,3\nGadget,1', path: 'data.csv' }));
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['#', 'Name', 'Qty']);
    expect(rows[0].textContent).toContain('Widget');
  });

  // The failure the parser exists to prevent, asserted through the RENDERED
  // grid: a quoted comma must stay inside one cell.
  test('a quoted cell keeps its comma, so the row is not split', async () => {
    await mount(h(CsvGrid, { content: 'a,b\n"x,y",z', path: 'data.csv' }));
    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent);
    // The first cell is the row number; then the two data cells.
    expect(cells).toEqual(['1', 'x,y', 'z']);
  });

  test('a file past the row cap says so', async () => {
    const lines = ['h'];
    for (let i = 0; i < 2100; i += 1) lines.push(String(i));
    await mount(h(CsvGrid, { content: lines.join('\n'), path: 'big.csv' }));
    expect(container.textContent).toContain('Showing the first');
  });

  test('an empty file renders the empty notice, not a bare table', async () => {
    await mount(h(CsvGrid, { content: '', path: 'empty.csv' }));
    expect(container.textContent).toContain('no rows');
  });
});

describe('SvgPreview', () => {
  // happy-dom's DOMPurify drops the ROOT `<svg>` element (verified: the same
  // sanitizer keeps `<svg><rect/></svg>` in Chromium), so the child shapes are
  // what these assertions read. The sanitizer's own script-stripping is pinned
  // in `sanitize.test.ts`; here the claim is the wiring — the markup is drawn
  // from the text buffer, through the sanitizer, into the container.
  test('renders the svg markup from the text buffer', async () => {
    await mount(
      h(SvgPreview, {
        content: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        name: 'logo.svg',
      }),
    );
    expect(container.querySelector('rect')).not.toBeNull();
    expect(container.querySelector('[role="img"]')).not.toBeNull();
  });

  // An SVG is a document that can carry script, and this one comes from a file
  // the user opened. The sanitizer is the gate, and the claim is that a script
  // element never reaches the DOM. (happy-dom's DOMPurify returns an empty
  // string for a document containing `<script>` — verified in Chromium that the
  // real one keeps the `<rect>` and drops only the script — so the surviving
  // content is pinned by the test above rather than repeated here.)
  test('a script inside the svg is stripped', async () => {
    await mount(
      h(SvgPreview, {
        content:
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>window.__pwned = 1;</script><rect width="10" height="10"/></svg>',
        name: 'evil.svg',
      }),
    );
    expect(container.querySelector('script')).toBeNull();
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });
});

describe('DocxView', () => {
  // A parse failure must be REPORTED. The failure mode this pins is a blank
  // pane, which reads as an empty document rather than an unreadable one.
  test('a parse failure is shown with the parser message', async () => {
    const source: ByteSource = {
      id: 'bad',
      url: null,
      loadBytes: async () => {
        throw new Error('This is not a Word document.');
      },
    };
    await mount(h(DocxView, { source, name: 'broken.docx' }));
    expect(container.textContent).toContain('Could not show broken.docx');
    expect(container.textContent).toContain('This is not a Word document.');
  });

  // The fetch count is the regression a fresh `loadBytes` closure causes: the
  // effect keys on `source.id`, so a re-render must not re-read the file.
  test('the bytes are read once per file, not once per render', async () => {
    let reads = 0;
    const source: ByteSource = {
      id: 'once',
      url: null,
      loadBytes: async () => {
        reads += 1;
        throw new Error('stop here');
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    const renderIt = () => render(h(DocxView, { source, name: 'x.docx' }), container);
    await act(async () => renderIt());
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    // Re-render with a FRESH source object (same id) — as every render produces.
    const again: ByteSource = { id: 'once', url: null, loadBytes: source.loadBytes as () => Promise<ArrayBuffer> };
    await act(async () => render(h(DocxView, { source: again, name: 'x.docx' }), container));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(reads).toBe(1);
  });
});

describe('hasViewerSurface', () => {
  test('the drawn kinds have a surface; text kinds do not', () => {
    for (const kind of ['image', 'pdf', 'docx', 'spreadsheet', 'csv', 'svg'] as const) {
      expect(hasViewerSurface(kind)).toBe(true);
    }
    for (const kind of ['code', 'markdown'] as const) {
      expect(hasViewerSurface(kind)).toBe(false);
    }
  });
});

describe('ViewerSurface routing', () => {
  const noSource: ByteSource = { id: 'none', url: null, loadBytes: null };

  // A CSV reads the TEXT buffer, so the grid renders with no byte source at all
  // — proving the dispatch routed to CsvGrid rather than to a byte viewer.
  test('a csv kind draws the grid from the text buffer', async () => {
    await mount(
      h(ViewerSurface, { kind: 'csv', path: 'data.csv', name: 'data.csv', source: noSource, content: 'a,b\n1,2\n', revision: 0 }),
    );
    expect(container.textContent).toContain('a');
    expect(container.textContent).toContain('b');
  });

  test('a kind with no surface here renders nothing', async () => {
    await mount(h(ViewerSurface, { kind: 'code', path: 'a.ts', name: 'a.ts', source: noSource, content: 'x', revision: 0 }));
    expect(container.textContent).toBe('');
  });
});

describe('SheetView', () => {
  // A workbook that cannot be parsed reports the parser's own sentence, never an
  // empty grid — the same failure shape DocxView pins.
  test('a parse failure is shown with the parser message', async () => {
    const source: ByteSource = {
      id: 'bad-sheet',
      url: null,
      loadBytes: async () => {
        throw new Error('This is not a workbook.');
      },
    };
    await mount(h(SheetView, { source, name: 'broken.xlsx', revision: 0 }));
    expect(container.textContent).toContain('Could not show broken.xlsx');
    expect(container.textContent).toContain('This is not a workbook.');
  });
});
