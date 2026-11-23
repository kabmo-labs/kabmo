/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The HTML preview's two load-bearing claims.
 *
 * A preview that drops the sandbox is a script from the opened file running in
 * this app's origin, and a preview that ignores the file's folder fetches every
 * relative `src` from the console's own root — both fail silently, because the
 * frame still paints something.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { HtmlPreview } from '@/client/components/workspace/editor/viewers/HtmlPreview';

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
});

afterAll(() => restoreDomGlobals());

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(node: unknown): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node as never, container);
  });
}

function frame(): HTMLIFrameElement {
  const element = container.querySelector('iframe');
  if (!element) throw new Error('no iframe mounted');
  return element as HTMLIFrameElement;
}

describe('HtmlPreview', () => {
  test('renders the page in a frame that scripts cannot use to reach this app', async () => {
    await mount(
      h(HtmlPreview, {
        content: '<!doctype html><style>body{background:red}</style><h1>Hi</h1>',
        name: 'page.html',
        path: 'page.html',
      }),
    );

    expect(frame().getAttribute('srcdoc')).toContain('<h1>Hi</h1>');
    const sandbox = frame().getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  test('resolves a relative reference against the file folder, not the app root', async () => {
    await mount(
      h(HtmlPreview, {
        content: '<link rel="stylesheet" href="./app.css"><img src="logo.png">',
        name: 'index.html',
        path: 'site/pages/index.html',
        root: '/workspace',
      }),
    );

    const html = frame().getAttribute('srcdoc') ?? '';
    // `&` is an entity inside an attribute value; the browser reads it back as
    // the separator.
    expect(html).toContain('/api/fs/raw?path=site%2Fpages%2Fapp.css&amp;root=%2Fworkspace');
    expect(html).toContain('/api/fs/raw?path=site%2Fpages%2Flogo.png&amp;root=%2Fworkspace');
  });

  test('leaves the markup alone when the file has no server-reachable scope', async () => {
    await mount(
      h(HtmlPreview, {
        content: '<img src="logo.png">',
        name: 'dropped.html',
        path: 'dropped.html',
      }),
    );

    expect(frame().getAttribute('srcdoc')).toContain('src="logo.png"');
  });
});
