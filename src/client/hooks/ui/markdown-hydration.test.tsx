/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Marked local images get a URL only for the session they belong to.
 *
 * The marking pass deliberately removes `src`, so a renderer that never runs
 * this hook draws the alt text instead of requesting `/Users/…` — a timeline
 * for a detached/BTW row must not guess a session. The hook is idempotent
 * because a streaming frame replaces the container's HTML on every update.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useRef } from 'preact/hooks';
import { Window } from 'happy-dom';
import { useLocalImageSources } from '@/client/hooks/ui/markdown-hydration';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

function Probe({ sessionId, html }: { sessionId?: string; html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLocalImageSources(ref, html, sessionId);
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

function mount(sessionId: string | undefined, html: string): HTMLImageElement {
  act(() => {
    render(<Probe sessionId={sessionId} html={html} />, container);
  });
  const image = container.querySelector('img');
  if (!image) throw new Error('image did not mount');
  return image;
}

describe('useLocalImageSources', () => {
  test('a marked image points at its session route', () => {
    const image = mount('session-1', '<img alt="shot" data-local-image="/work/a b.png">');
    expect(image.getAttribute('src')).toBe(
      '/api/sessions/session-1/local-image?path=%2Fwork%2Fa%20b.png',
    );
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
  });

  test('no session means no request', () => {
    const image = mount(undefined, '<img alt="shot" data-local-image="/work/a.png">');
    expect(image.hasAttribute('src')).toBe(false);
  });

  test('a remote image is not rewritten', () => {
    const image = mount('session-1', '<img alt="badge" src="https://x.test/a.png">');
    expect(image.getAttribute('src')).toBe('https://x.test/a.png');
  });

  test('a second render keeps the same src', () => {
    act(() => {
      render(<Probe sessionId="session-1" html='<img data-local-image="/work/a.png">' />, container);
    });
    act(() => {
      render(<Probe sessionId="session-1" html='<img data-local-image="/work/a.png">' />, container);
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/sessions/session-1/local-image?path=%2Fwork%2Fa.png',
    );
  });
});
