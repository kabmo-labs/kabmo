/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Narration: a `thinking` block whose text is prose the model addressed to the
 * USER.
 *
 * omp 18.12.0 marks those blocks `narration: true` (decoded from the Anthropic /
 * Bedrock thinking signature) and presents them as ANSWER text everywhere it
 * renders — `presentNarrationAsAnswer` is applied by the TUI's streaming
 * reveal, print mode and the ACP mapper. The Kabmo folded every thinking
 * block into the collapsed "Thinking" accordion, so a reply sent between two
 * tool calls disappeared from the transcript on those models.
 *
 * The rule lives in `parseMessageBlocks` because both render paths share it —
 * the live fold (`mapper.ts`) and the JSONL reload (`messages-parse.ts`) — so
 * these cases are asserted against the core parser and once end-to-end through
 * each adapter.
 */

import { describe, expect, test } from 'bun:test';

import { parseMessageBlocks } from '@/shared/lib/omp/session/parse-message-blocks';
import { parseAssistantContent } from '@/shared/lib/omp/session/messages-parse';
import { toChatMessage as reloadToChatMessage } from '@/shared/lib/omp/session/messages-map';
import { toChatMessage as liveToChatMessage } from '@/shared/lib/omp/session/mapper';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';

describe('parseMessageBlocks — narration', () => {
  test('a narration block becomes answer text, not reasoning', () => {
    const parsed = parseMessageBlocks([
      { type: 'thinking', thinking: 'I checked the config and it looks right.', narration: true },
      { type: 'text', text: 'Done.' },
    ]);
    expect(parsed.textParts).toEqual(['I checked the config and it looks right.', 'Done.']);
    expect(parsed.thinking).toBeUndefined();
  });

  test('narration keeps the position of the blocks it interleaves with', () => {
    const parsed = parseMessageBlocks([
      { type: 'thinking', thinking: 'real reasoning' },
      { type: 'thinking', thinking: 'prose to the user', narration: true },
      { type: 'text', text: 'closing line' },
    ]);
    expect(parsed.thinking).toBe('real reasoning');
    expect(parsed.textParts).toEqual(['prose to the user', 'closing line']);
  });

  test('a `text` body works the same as a `thinking` body', () => {
    // omp's wire type carries `thinking`, but the parser has always accepted a
    // `text` fallback and the narration rule must not drop that path.
    const parsed = parseMessageBlocks([{ type: 'thinking', text: 'spoken', narration: true }]);
    expect(parsed.textParts).toEqual(['spoken']);
    expect(parsed.thinking).toBeUndefined();
  });

  test('only the literal boolean promotes a block', () => {
    // A provider's own marker must never move reasoning into the reply.
    expect(parseMessageBlocks([{ type: 'thinking', thinking: 'x', narration: 'yes' }]).thinking).toBe('x');
    expect(parseMessageBlocks([{ type: 'thinking', thinking: 'x', narration: false }]).thinking).toBe('x');
    expect(parseMessageBlocks([{ type: 'thinking', thinking: 'x' }]).thinking).toBe('x');
  });

  test('a narration block with no body adds nothing', () => {
    const parsed = parseMessageBlocks([{ type: 'thinking', narration: true }]);
    expect(parsed.textParts).toEqual([]);
    expect(parsed.thinking).toBeUndefined();
  });
});

describe('both adapters — narration', () => {
  test('the reload adapter carries narration into content', () => {
    const entry = {
      type: 'message',
      id: 'a1',
      timestamp: '2026-01-02T03:04:05.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'reasoning' },
          { type: 'thinking', thinking: 'here is what I found', narration: true },
        ],
      },
    } as OmpMessageEntry;
    const msg = reloadToChatMessage(entry);
    expect(msg?.content).toBe('here is what I found');
    expect(msg?.thinking).toEqual({ thought: 'reasoning', isGenerating: false });
  });

  test('the live adapter carries narration into content while streaming', () => {
    const msg = liveToChatMessage({
      role: 'assistant',
      id: 'a1',
      content: [
        { type: 'thinking', thinking: 'reasoning', thinkingSignature: 'sig' },
        { type: 'thinking', thinking: 'here is what I found', narration: true },
      ],
    });
    expect(msg?.content).toBe('here is what I found');
    expect(typeof msg?.thinking === 'string' ? msg.thinking : msg?.thinking?.thought).toBe('reasoning');
  });

  test('parseAssistantContent reports the split the adapters rely on', () => {
    const parsed = parseAssistantContent([
      { type: 'thinking', thinking: 'reasoning' },
      { type: 'thinking', thinking: 'narration', narration: true },
    ]);
    expect(parsed.thinking).toBe('reasoning');
    expect(parsed.textParts).toEqual(['narration']);
  });
});
