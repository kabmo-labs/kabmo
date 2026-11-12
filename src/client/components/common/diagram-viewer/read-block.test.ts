/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The natural size the diagram viewer renders at.
 *
 * The regression this pins was reported as "zooming the preview looks
 * pixelated": mermaid keeps `useMaxWidth` on for every diagram type except
 * flowchart and sequence, and that branch emits `width="100%"` with the real
 * size only in the `viewBox`. `Number.parseFloat('100%')` reads 100, so the
 * snapshot claimed a 100 px-wide diagram — the viewer drew it at 100 px and
 * magnified that rendering. The test therefore asserts the measured number, not
 * that a viewer opened.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readDiagramBlock } from '@/client/components/common/diagram-viewer/read-block';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

/** A `.mermaid-block` holding one SVG with `attrs`, in a fresh window. */
function mount(attrs: Record<string, string>): HTMLElement {
  const win = new Window();
  installDomGlobals(win);
  const block = win.document.createElement('div') as unknown as HTMLElement;
  block.className = 'mermaid-block';
  const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
  block.appendChild(svg as never);
  win.document.body.appendChild(block as never);
  return block;
}

describe('readDiagramBlock', () => {
  afterEach(() => restoreDomGlobals());

  test('a percentage width measures the viewBox, not 100 px', () => {
    // Mermaid's `useMaxWidth: true` markup: no height, natural size in viewBox.
    const block = mount({
      width: '100%',
      style: 'max-width: 166.984375px;',
      viewBox: '0 0 166.984375 294',
    });
    expect(readDiagramBlock(block)).toMatchObject({ width: 166.984375, height: 294 });
  });

  test('a px width/height pair is used verbatim', () => {
    // Mermaid's `useMaxWidth: false` markup (flowchart, sequence).
    const block = mount({ width: '3804', height: '64', viewBox: '0 0 3804 64' });
    expect(readDiagramBlock(block)).toMatchObject({ width: 3804, height: 64 });
  });

  test('a non-zero viewBox origin is not mistaken for a size', () => {
    // Mindmap/timeline start their viewBox at a negative origin.
    const block = mount({ width: '100%', viewBox: '-5 -61 895 476.6' });
    expect(readDiagramBlock(block)).toMatchObject({ width: 895, height: 476.6 });
  });

  test('a percentage width with no viewBox never divides by zero', () => {
    const block = mount({ width: '100%' });
    expect(readDiagramBlock(block)).toMatchObject({ width: 1, height: 1 });
  });

  test('a block with no direct SVG child has no snapshot', () => {
    const block = mount({});
    block.querySelector(':scope > svg')?.remove();
    expect(readDiagramBlock(block)).toBeNull();
  });
});
