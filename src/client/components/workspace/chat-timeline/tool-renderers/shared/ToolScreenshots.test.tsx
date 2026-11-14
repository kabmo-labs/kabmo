/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The screenshot strip an `eval` card grows when its script captured pictures.
 *
 * The defect this pins: the result's text names a temp file
 * (`/var/folders/…/omp-sshots-….png`) that `/api/fs/raw` refuses — it is
 * outside the browse scope — so the card showed a path and no picture while the
 * bytes sat in the result as a `blob:sha256:` reference. The strip must paint
 * the result's own bytes, and the full-size view must open on the same URL.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ToolScreenshots } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolScreenshots';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ToolImageRef } from '@/shared/types/chat';

const HASH = '597f429e2085f854a121f689d0acff97f556159fbf8e47f4f728fec832867349';
const BLOB_SRC = `/api/omp/blob?hash=${HASH}`;
const INLINE_SRC = 'data:image/png;base64,AAAA';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

function mount(images: ToolImageRef[]): HTMLElement {
  act(() => {
    render(h(ToolScreenshots, { images }), container);
  });
  return container;
}

const BLOB_IMAGE: ToolImageRef = { mimeType: 'image/png', blobRef: `blob:sha256:${HASH}` };
const INLINE_IMAGE: ToolImageRef = { mimeType: 'image/png', dataBase64: 'AAAA' };

describe('ToolScreenshots', () => {
  test('renders nothing when the result carried no usable picture', () => {
    expect(mount([]).querySelector('img')).toBeNull();
    // A malformed ref has no URL to paint; the strip must not claim a picture.
    expect(mount([{ mimeType: 'image/png', blobRef: 'blob:sha256:not-a-digest' }]).querySelector('img')).toBeNull();
  });

  test('paints one thumbnail per image, blob refs through the blob route', () => {
    const root = mount([BLOB_IMAGE, INLINE_IMAGE]);
    const sources = Array.from(root.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    expect(sources).toEqual([BLOB_SRC, INLINE_SRC]);
    expect(root.textContent).toContain('Screenshots');
    expect(root.textContent).toContain('2');
  });

  test('a thumbnail opens the full-size view on the same bytes', () => {
    const root = mount([BLOB_IMAGE, INLINE_IMAGE]);
    const thumbnails = root.querySelectorAll('.snap-x button');
    expect(thumbnails).toHaveLength(2);

    act(() => {
      (thumbnails[1] as HTMLButtonElement).click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe('Screenshot 2 of 2');
    const full = dialog?.querySelector('img');
    expect(full?.getAttribute('src')).toBe(INLINE_SRC);
  });

  test('one picture is a plain thumbnail, with no carousel chrome', () => {
    const root = mount([BLOB_IMAGE]);
    expect(root.querySelector('[aria-label="Next screenshot"]')).toBeNull();
    expect(root.querySelector('[aria-label="Previous screenshot"]')).toBeNull();
    expect(root.textContent).toContain('1');
  });

  test('many pictures become a snap carousel with a counter and arrows', () => {
    const root = mount([BLOB_IMAGE, INLINE_IMAGE, BLOB_IMAGE]);
    const track = root.querySelector('.snap-x');
    expect(track).not.toBeNull();
    expect(track?.querySelectorAll('button')).toHaveLength(3);
    expect(root.textContent).toContain('1 / 3');

    const next = root.querySelector('[aria-label="Next screenshot"]') as HTMLButtonElement;
    const prev = root.querySelector('[aria-label="Previous screenshot"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);

    act(() => next.click());
    expect(root.textContent).toContain('2 / 3');
    expect(prev.disabled).toBe(false);

    act(() => next.click());
    expect(root.textContent).toContain('3 / 3');
    expect(next.disabled).toBe(true);

    act(() => prev.click());
    expect(root.textContent).toContain('2 / 3');
  });
});
