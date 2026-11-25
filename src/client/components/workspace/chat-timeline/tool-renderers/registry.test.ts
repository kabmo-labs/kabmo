/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client's panel lookup is a READ of the server's `render` field.
 *
 * This file exists to pin the boundary: a row the server did not classify must
 * resolve to NO panel (the JSON fallback), and the client must never derive one
 * from a name — that second classification is what made one logical shell call
 * draw a Bash card on one harness and a generic body on another.
 *
 * The classification table itself is pinned in
 * `shared/lib/chat/tool/render-key.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { toolPanelKind, resolveToolKey } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';
import { normalizeToolCall } from '@/shared/lib/chat/tool/normalize';
import type { ToolCallData } from '@/shared/types/chat';

function tool(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>): ToolCallData {
  return { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
}

describe('toolPanelKind', () => {
  test('reads the server-normalized family', () => {
    expect(toolPanelKind(tool({ type: 'bash', render: { key: 'bash', normalized: true } }))).toBe('bash');
    expect(toolPanelKind(tool({ type: 'read', render: { key: 'read', normalized: true } }))).toBe('read');
  });

  test('a row with no render has no panel, even when the name looks known', () => {
    // The bug: this used to answer `bash` from the name alone.
    expect(toolPanelKind(tool({ type: 'bash', name: 'bash' }))).toBeNull();
  });

  test('an unnormalized render has no panel', () => {
    expect(toolPanelKind(tool({ type: 'custom', render: { key: 'custom', normalized: false } }))).toBeNull();
  });

  test('a key the server sent wins over a contradicting name', () => {
    expect(toolPanelKind(tool({ type: 'bash', name: 'VendorShell', render: { key: 'bash', normalized: true } }))).toBe('bash');
  });
});

describe('resolveToolKey', () => {
  test('is the normalized family when there is one', () => {
    expect(resolveToolKey(tool({ type: 'bash', render: { key: 'bash', normalized: true } }))).toBe('bash');
  });

  test('falls back to the reported name, never to an inference', () => {
    expect(resolveToolKey(tool({ type: 'custom', name: 'VendorWidget' }))).toBe('vendorwidget');
  });
});

describe('normalizeToolCall', () => {
  test('annotates an unnormalized row once and is idempotent', () => {
    const once = normalizeToolCall(tool({ type: 'shell', name: 'shell' }));
    expect(once.render).toEqual({ key: 'bash', normalized: true });
    expect(once.type).toBe('shell');
    expect(normalizeToolCall(once)).toBe(once);
  });

  test('an unknown call is marked custom so the body shows JSON', () => {
    const unknown = normalizeToolCall(tool({ type: 'custom', name: 'VendorWidget' }));
    expect(unknown.render).toEqual({ key: 'custom', normalized: false });
    expect(toolPanelKind(unknown)).toBeNull();
  });
});
