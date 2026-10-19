/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Read panel's lazy fallback.
 *
 * A `read` whose result carries no output falls back to fetching the path it
 * named through `/api/fs/read`. An omp internal URL names no file: the route
 * refused `proc://kabmo-dev`, and the panel printed
 * `// Loaded file: proc://kabmo-dev` as if that were the file's contents.
 * A `read` of a process is answered by the `proc://` panel, never by this one —
 * but a legacy transcript can still hand it a virtual URL.
 *
 * Rendered with `h()` against happy-dom, following `panels/Edit.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Read } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Read';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let calls: string[] = [];
/** The next response the stub hands back. Defaults to a 200 carrying `hello`. */
let nextResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: { content: 'hello' },
};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // The panel reads the status and the body, so the stub has to carry both: a
  // refused read is `ok: false` with an `error`, and the assertions below are
  // about which sentence the panel printed.
  const stub = (async (url: string) => {
    calls.push(String(url));
    const { ok, status, body } = nextResponse;
    return { ok, status, json: async () => body };
  }) as unknown as typeof globalThis.fetch;
  globalThis.fetch = stub;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

/** Mount and flush the effect + its fetch microtask chain. */
async function mount(tool: ToolCallData) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Read, { tool, output: tool.output ?? '' }), container);
  });
  // The reader awaits `fetch` and then `res.json()`, and each state write lands
  // a turn later; a few separate `act` passes drain that chain without binding
  // the test to the clock.
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container;
}

function readTool(partial: Partial<ToolCallData>): ToolCallData {
  return { id: 'r1', type: 'read', name: 'read', title: 'read', output: '', status: 'success', details: {}, ...partial } as ToolCallData;
}

describe('Read panel — lazy fallback', () => {
  beforeEach(() => {
    nextResponse = { ok: true, status: 200, body: { content: 'hello' } };
  });

  test('a virtual URL never reaches /api/fs/read', async () => {
    calls = [];
    const el = await mount(readTool({ target: 'proc://kabmo-dev', input: { path: 'proc://kabmo-dev' } }));
    expect(calls).toHaveLength(0);
    expect(el.textContent ?? '').not.toContain('Loaded file');
  });

  test('a real path still lazy-loads', async () => {
    calls = [];
    await mount(readTool({ target: 'src/x.ts', input: { path: 'src/x.ts' } }));
    expect(calls[0]).toContain('/api/fs/read?path=src%2Fx.ts');
  });

  test('a refused read prints the server’s reason, never a fake body', async () => {
    // A binary or oversized file is refused by the route with its own sentence.
    // Printing `// Loaded file: <path>` described contents that were never read.
    nextResponse = {
      ok: false,
      status: 415,
      body: { error: 'This file is not text, so it cannot be shown in the editor.', kind: 'binary' },
    };
    const el = await mount(readTool({ target: 'archive.zip', input: { path: 'archive.zip' } }));
    const text = el.textContent ?? '';
    expect(text).toContain('not text');
    expect(text).not.toContain('Loaded file');
  });

  test('a read whose body is missing a content field is reported, not faked', async () => {
    nextResponse = { ok: true, status: 200, body: {} };
    const el = await mount(readTool({ target: 'src/y.ts', input: { path: 'src/y.ts' } }));
    const text = el.textContent ?? '';
    expect(text).toContain('HTTP 200');
    expect(text).not.toContain('Loaded file');
  });
});

describe('Read panel — language and markdown', () => {
  test('an xd:// doc read renders as prose, never as code', async () => {
    // `read xd://eval/browser` is a device's docs — markdown (`# <name>`,
    // `## Schema`, a ```ts fence) behind omp's `text/plain` content type. It
    // was badged `javascript` (the language detector's default for a path with
    // no extension) and rendered as one `<pre>` of literal syntax.
    const text = '# eval — Eval\n\n- Static content? Use `read`.';
    const el = await mount(readTool({
      target: 'xd://eval',
      input: { path: 'xd://eval' },
      output: text.split('\n').map((row, index) => `${index + 1}|${row}`).join('\n'),
      details: {
        contentType: 'text/plain',
        totalLines: 3,
        displayContent: { text, startLine: 1, lineNumbers: [1, 2, 3] },
      },
    }));
    const rendered = el.textContent ?? '';
    expect(rendered).toContain('Markdown');
    expect(rendered).not.toContain('javascript');
    expect(rendered).not.toContain('Directory');
    // Prose, not a listing: the markdown pipeline drew it (`.prose-content`,
    // the `-` row became a list item) and the directory renderer — whose rows
    // carry folder/file glyphs — did not.
    expect(el.querySelector('.prose-content')).not.toBeNull();
    expect(el.querySelector('ul li')).not.toBeNull();
    expect(el.querySelector('svg.lucide-folder, svg.lucide-folder-open')).toBeNull();
    expect(rendered).toContain('Static content? Use read.');
  });

  test('a one-row doc read keeps its line-number gutter out of the prose', async () => {
    // omp's raw output prefixes every row with its line number, and the
    // stripper needs two numbered rows to recognise the format — so the real
    // `read xd://propose` payload (one row) rendered as the paragraph
    // `1|Write your plan's <slug> …`.
    const line = "Write your plan's <slug> as plain text to xd://propose to submit the plan for approval.";
    const el = await mount(readTool({
      target: 'xd://propose',
      input: { path: 'xd://propose' },
      output: `1|${line}`,
      details: {
        contentType: 'text/plain',
        totalLines: 1,
        displayContent: { text: line, startLine: 1, lineNumbers: [1] },
      },
    }));
    const rendered = el.textContent ?? '';
    expect(rendered).toContain('xd://propose');
    expect(rendered).not.toContain('1|');
  });

  test('a failed xd:// read stays a message, not a document', async () => {
    // `read xd://nope` answers "No such tool: xd://nope. Mounted devices: …",
    // which is a refusal rather than a document; it keeps the code surface.
    const el = await mount(readTool({
      target: 'xd://nope',
      input: { path: 'xd://nope' },
      status: 'error',
      isError: true,
      output: 'No such tool: xd://nope. Mounted devices: ast_grep, lsp.',
      details: { contentType: 'text/plain', totalLines: 1 },
    }));
    const rendered = el.textContent ?? '';
    expect(rendered).toContain('No such tool');
    expect(rendered).not.toContain('Markdown');
  });

  test('a text/markdown read renders as prose, not as a code block', async () => {
    // omp draws `contentType: text/markdown` as the document it is. The panel had
    // no markdown branch, so `# Diagnose ## Steps` came out as literal syntax.
    // omp prefixes every row with its line number (`1|# Diagnose`), and the
    // renderer must strip that gutter before the markdown parse — otherwise the
    // heading is the paragraph `1|# Diagnose`.
    const text = '# Diagnose\n\n## Steps\n\n1. Reproduce';
    const el = await mount(readTool({
      target: 'skill://diagnose',
      input: { path: 'skill://diagnose' },
      output: text.split('\n').map((line, index) => `${index + 1}|${line}`).join('\n'),
      details: {
        contentType: 'text/markdown',
        totalLines: 5,
        displayContent: { text, startLine: 1, lineNumbers: [1, 2, 3, 4, 5] },
      },
    }));
    const rendered = el.textContent ?? '';
    expect(rendered).toContain('Markdown');
    // A heading is drawn as a heading, not as a `1|# Diagnose` code row.
    expect(el.querySelector('h1, h2, h3')).not.toBeNull();
    expect(rendered).not.toContain('# Diagnose');
    expect(rendered).not.toContain('1|');
  });

  test('a source file still gets its language badge and code gutter', async () => {
    const el = await mount(readTool({
      target: 'src/x.ts',
      input: { path: 'src/x.ts' },
      output: '1|const a = 1;',
      details: { fileSize: 20, totalLines: 1, displayContent: { text: 'const a = 1;', startLine: 1, lineNumbers: [1] } },
    }));
    const text = el.textContent ?? '';
    expect(text).toContain('typescript');
    expect(text).toContain('const a = 1;');
  });
});
