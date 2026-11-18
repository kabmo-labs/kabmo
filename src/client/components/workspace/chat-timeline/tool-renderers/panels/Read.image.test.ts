/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pictures a `read` card paints, and the full-size view behind a click.
 *
 * The card used to draw the bytes at `max-h-72` with no affordance, so a
 * screenshot of fine text could not be read; and an SVG — which omp returns as
 * SOURCE, because it has no magic bytes — rendered as a code block with no
 * picture at all. Both now open the same surface `eval` screenshots do.
 *
 * Split from `Read.test.ts` (the text branches) because each suite is at the
 * repo's per-file ceiling; both mount through `read-test-util.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { act } from 'preact/test-utils';
import {
  installReadDom,
  mountRead,
  readTool,
  restoreReadDom,
} from '@/client/components/workspace/chat-timeline/tool-renderers/panels/read-test-util';

beforeAll(() => {
  installReadDom();
});

afterAll(() => {
  restoreReadDom();
});

/** Close the preview the click opened, so the next case starts clean. */
function closePreview(): void {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

describe('Read panel — image preview', () => {
  test('the result’s own picture opens at full size when clicked', async () => {
    // The card painted the bytes with no affordance, so a screenshot of fine
    // text could not be read. The full-size surface is the one `eval`
    // screenshots open into: a dialog with the zoom/pan pill, on the SAME URL
    // the thumbnail drew.
    const el = await mountRead(readTool({
      target: '/tmp/shot.png',
      input: { path: '/tmp/shot.png' },
      images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }],
    }));
    const open = el.querySelector('button[aria-label="Open /tmp/shot.png full size"]') as HTMLButtonElement;
    expect(open).not.toBeNull();
    expect(open.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    act(() => open.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe('/tmp/shot.png');
    expect(dialog?.querySelector('button[title="Fit to view (0)"]')).not.toBeNull();
    expect(dialog?.querySelector('button[title="Zoom in (+)"]')).not.toBeNull();
    expect(dialog?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    closePreview();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('a path-only image read opens the same preview', async () => {
    // A result that carries no image block falls back to the raw-file route;
    // the click affordance belongs to both branches, not just to the bytes the
    // result returned.
    const el = await mountRead(readTool({ target: 'assets/logo.png', input: { path: 'assets/logo.png' } }));
    const open = el.querySelector('button[aria-label="Open assets/logo.png full size"]') as HTMLButtonElement;
    expect(open).not.toBeNull();
    expect(open.querySelector('img')?.getAttribute('src')).toContain('/api/fs/raw?path=assets%2Flogo.png');

    act(() => open.click());
    expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toContain(
      '/api/fs/raw?path=assets%2Flogo.png',
    );
    closePreview();
  });

  test('a path-only webp read opens the same preview', async () => {
    // WEBP is in the image table AND in the magic-byte table (RIFF/WEBP at
    // offset 8), so a `.webp` a provider did not decode still previews.
    const el = await mountRead(readTool({ target: 'assets/logo.webp', input: { path: 'assets/logo.webp' } }));
    const open = el.querySelector('button[aria-label="Open assets/logo.webp full size"]') as HTMLButtonElement;
    expect(open).not.toBeNull();
    expect(open.querySelector('img')?.getAttribute('src')).toContain('/api/fs/raw?path=assets%2Flogo.webp');

    act(() => open.click());
    expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toContain(
      '/api/fs/raw?path=assets%2Flogo.webp',
    );
    closePreview();
  });

  test('an svg image block paints through the blob route', async () => {
    // omp hands an `<svg>` back as text, but a result CAN carry an svg image
    // block; the blob route labels it `image/svg+xml` from the bytes, so the
    // card paints it instead of a broken picture with an octet-stream type.
    const hash = 'a'.repeat(64);
    const el = await mountRead(readTool({
      target: 'assets/mark.svg',
      input: { path: 'assets/mark.svg' },
      images: [{ mimeType: 'image/svg+xml', blobRef: `blob:sha256:${hash}` }],
    }));
    const open = el.querySelector('button[aria-label="Open assets/mark.svg full size"]') as HTMLButtonElement;
    expect(open).not.toBeNull();
    expect(open.querySelector('img')?.getAttribute('src')).toBe(`/api/omp/blob?hash=${hash}`);
  });

  test('an svg read paints the picture AND keeps the source it returned', async () => {
    // omp answers a `read` of an SVG with its markup, so treating it as a
    // picture-only card would hide the only text the tool actually returned.
    // The preview is additive: image on top, source below, still copyable.
    const source = '1|<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120"/></svg>';
    const el = await mountRead(readTool({
      target: 'assets/mark.svg',
      input: { path: 'assets/mark.svg' },
      output: source,
      details: { fileSize: 224, totalLines: 1, displayContent: { text: source.slice(2), startLine: 1, lineNumbers: [1] } },
    }));
    const open = el.querySelector('button[aria-label="Open assets/mark.svg full size"]') as HTMLButtonElement;
    expect(open).not.toBeNull();
    expect(open.querySelector('img')?.getAttribute('src')).toContain('/api/fs/raw?path=assets%2Fmark.svg');
    const text = el.textContent ?? '';
    expect(text).toContain('SVG');
    // The markup the tool returned is still on the card, not replaced by pixels.
    expect(text).toContain('<rect');
    expect(text).toContain('Copy file content');
  });

  test('a failed svg read stays a message, with no picture over it', async () => {
    const el = await mountRead(readTool({
      target: 'assets/missing.svg',
      input: { path: 'assets/missing.svg' },
      status: 'error',
      isError: true,
      output: "Path 'assets/missing.svg' not found",
    }));
    expect(el.querySelector('button[aria-label="Open assets/missing.svg full size"]')).toBeNull();
  });
});
