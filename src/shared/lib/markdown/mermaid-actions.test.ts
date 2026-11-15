/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mermaid block's own actions.
 *
 * The refresh button is the reader's only repair for a diagram that rendered
 * blank, and it is wired by a DELEGATED listener that looks for
 * `data-mermaid-refresh` — so the two things that can silently kill it are
 * (a) the attribute not surviving `sanitizeHtml`, and (b) the hydrated block
 * replacing the placeholder's markup with a set that lacks the button. Both
 * are asserted here, plus the copy payload, which must be the diagram source
 * and not its URI escape.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { renderMarkdown } from '@/shared/lib/markdown/marked';
import { sanitizeHtml } from '@/shared/lib/markdown/sanitize';
import { mermaidActionsHtml, mermaidSourceHtml } from '@/shared/lib/markdown/mermaid-actions';
import { refreshMermaidFromClick } from '@/shared/lib/markdown/mermaid';

afterEach(() => restoreDomGlobals());

const FENCE = '```mermaid\ngraph TD\n  A["quoted"] --> B\n```';

describe('mermaid block actions', () => {
  test('the placeholder carries both actions, and the refresh hook survives sanitizing', () => {
    installDomGlobals(new Window({ url: 'http://localhost' }));
    const html = sanitizeHtml(renderMarkdown(FENCE));
    expect(html).toContain('data-mermaid-refresh');
    expect(html).toContain('data-copy=');
    // The copy payload is the source, not its percent escape.
    expect(html).toContain('graph TD');
    expect(html).not.toContain('graph%20TD');
  });

  test('the hydrated action set is the same one the placeholder emitted', () => {
    const html = mermaidActionsHtml('graph TD\n  A --> B');
    expect(html).toContain('data-mermaid-refresh');
    expect(html).toContain('data-copy="graph TD\n  A --> B"');
  });

  test('a quote in the source cannot break out of the copy attribute', () => {
    const html = mermaidActionsHtml('A["x"] --> B');
    expect(html).toContain('data-copy="A[&quot;x&quot;] --> B"');
  });

  test('the fallback body escapes markup so a fence cannot inject HTML', () => {
    expect(mermaidSourceHtml('<img src=x onerror=alert(1)>')).toBe(
      '<pre><code class="language-mermaid">&lt;img src=x onerror=alert(1)&gt;</code></pre>',
    );
  });

  test('a click on the refresh button re-renders that block and reports handled', () => {
    installDomGlobals(new Window({ url: 'http://localhost' }));
    const host = document.createElement('div');
    // The raw render, not `sanitizeHtml`: happy-dom's purifier drops every
    // `<div>`, which would remove the block this test is about.
    host.innerHTML = renderMarkdown(FENCE);
    document.body.append(host);
    const block = host.querySelector<HTMLElement>('.mermaid-block')!;
    block.querySelector('pre')!.setAttribute('data-marker', '1');
    const button = block.querySelector<HTMLElement>('[data-mermaid-refresh]')!;

    expect(refreshMermaidFromClick(button)).toBe(true);
    // The block was reset to its placeholder, which is the retry starting.
    expect(block.querySelector('[data-marker]')).toBeNull();
    // The retry is in flight: `renderBlock` marks the block before awaiting.
    expect(block.dataset.mermaidState).toBe('rendering');

    // Any other click is not a refresh, so the caller keeps its own handling.
    expect(refreshMermaidFromClick(host)).toBe(false);
  });
});
