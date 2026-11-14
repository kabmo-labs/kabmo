/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP rows' status glyph.
 *
 * The colour is the only signal a user gets from the collapsed row, and the
 * fill token is not it: `text-error` is the palette's own `#E06C75` on
 * `onedarkpro-light`, 2.91:1 on the popover's paper — a pale pink that reads as
 * "nothing happened". The solved `-text` token is the red the failure state is
 * supposed to show (4.51:1). A markup check that only looks for `text-error`
 * passes on both, so each case asserts the exact token.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { McpSection } from '@/client/components/common/context-usage-button/McpSection';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { McpProbeResult, SessionMcpPayload } from '@/shared/types';

const nativeFetch = Bun.fetch;
let container: HTMLElement;

function payload(probe: McpProbeResult | null): SessionMcpPayload {
  return {
    sessionId: 'session-mcp',
    harness: 'omp-rpc',
    delivery: 'omp-config',
    live: false,
    servers: [{ name: 'obsidian', transport: 'http', source: 'user', enabled: true, probe }],
    overrides: {},
  };
}

async function mount(probe: McpProbeResult | null): Promise<void> {
  (globalThis as unknown as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify(payload(probe)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(McpSection, { sessionId: 'session-mcp' }), container);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => {});
}

function infoButton(): HTMLElement {
  return container.querySelector('button[aria-label^="obsidian status"]') as HTMLElement;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

describe('McpSection status glyph', () => {
  test('a failed handshake paints the info control with the readable red', async () => {
    await mount({ ok: false, error: 'ECONNREFUSED', toolCount: 0, durationMs: 0, checkedAt: 1 });

    const button = infoButton();
    expect(button.getAttribute('aria-label')).toBe('obsidian status: error');
    expect(button.classList.contains('text-error-text')).toBe(true);
    expect(button.classList.contains('text-error')).toBe(false);
  });

  test('a handshake that answered paints it green', async () => {
    await mount({ ok: true, toolCount: 8, durationMs: 152, checkedAt: 1 });

    const button = infoButton();
    expect(button.getAttribute('aria-label')).toBe('obsidian status: active');
    expect(button.classList.contains('text-success-text')).toBe(true);
  });

  test('a server that was never probed stays amber', async () => {
    await mount(null);

    const button = infoButton();
    expect(button.getAttribute('aria-label')).toBe('obsidian status: unknown');
    expect(button.classList.contains('text-warning-text')).toBe(true);
  });
});
