/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's stretch decision table.
 *
 * What this pins is the DIFFERENCE between the two layouts, because that is
 * where a wrong answer is invisible on one of them: a phone composer that grew
 * "in place" would keep a 68px box, and a desktop composer that went
 * full-screen would hide the transcript the prompt is written against. The
 * picker's placement rides the same decision — a full-height composer has no
 * room above it, so an upward popup would be drawn off the viewport.
 *
 * The keyboard lift is the third: it must be applied on a phone (the soft
 * keyboard does not shrink the layout viewport, and there is no hardware Enter
 * to fall back on) and must NOT be applied on a desktop, where there is no
 * keyboard to lift over.
 */

import { describe, expect, test } from 'bun:test';

import { composerExpansion } from '@/client/components/workspace/chat-timeline/chat-input/expansion';

const base = { expanded: false, isDragging: false, keyboardInset: 0 } as const;

describe('composerExpansion docked', () => {
  test('a phone keeps its touch-sized box and opens the popup upward', () => {
    const layout = composerExpansion({ ...base, variant: 'mobile' });
    expect(layout.cardPositionClass).toBe('relative');
    expect(layout.textareaClass).toContain('min-h-[68px]');
    // The transcript's own size, not a larger one: a draft read at 16px beside
    // 13px messages looked like a different document pasted underneath.
    expect(layout.textareaClass).toContain('text-[13px]');
    expect(layout.pickerPlacement).toBe('up');
    expect(layout.style).toBeUndefined();
  });

  test('a desktop keeps its 80px box', () => {
    const layout = composerExpansion({ ...base, variant: 'desktop' });
    expect(layout.textareaClass).toContain('min-h-[80px]');
    expect(layout.textareaClass).toContain('text-[13px]');
    expect(layout.pickerPlacement).toBe('up');
  });

  test('a file drag is what the frame border reports', () => {
    expect(composerExpansion({ ...base, variant: 'desktop' }).cardClass).toContain('border-ink/20');
    expect(composerExpansion({ ...base, variant: 'desktop', isDragging: true }).cardClass).toContain('border-ink/40');
  });
});

/**
 * The composer is a card in the same transcript as the tool calls, so its frame
 * is the tool card's own (`ToolCardShell`): `rounded-xl`, `border-ink/10` on
 * `bg-paper`, darkening to `ink/20` — plus a shadow, which the tool card only
 * grows when expanded but the composer always has, because it is the input the
 * user is looking at. A `rounded-md` here made it read as a smaller, different
 * card sitting under the conversation.
 */
describe('composerExpansion frame matches a tool card', () => {
  test('docked: rounded-xl, ink/10 hairline, a resting shadow', () => {
    for (const variant of ['desktop', 'mobile'] as const) {
      const { cardClass } = composerExpansion({ ...base, variant });
      expect(cardClass).toContain('rounded-xl');
      expect(cardClass).not.toContain('rounded-md');
      expect(cardClass).toContain('border-ink/10');
      expect(cardClass).toContain('bg-paper');
      expect(cardClass).toContain('shadow-sm');
    }
  });

  test('the border darkens on hover and on focus, never at rest', () => {
    const { cardClass } = composerExpansion({ ...base, variant: 'desktop' });
    expect(cardClass).toContain('hover:border-ink/20');
    expect(cardClass).toContain('focus-within:border-ink/30');
  });

  test('a stretched desktop keeps the radius and lifts the shadow one step', () => {
    const { cardClass } = composerExpansion({ ...base, expanded: true, variant: 'desktop' });
    expect(cardClass).toContain('rounded-xl');
    expect(cardClass).toContain('shadow-md');
  });

  test('a stretched phone drops the radius so the bars follow it', () => {
    const { cardClass } = composerExpansion({ ...base, expanded: true, variant: 'mobile' });
    expect(cardClass).toContain('rounded-none');
    expect(cardClass).toContain('shadow-none');
  });
});

/**
 * The compact composer is a DECISION ONE LEVEL UP, not a size in this table.
 *
 * A phone reader scrolled back through the transcript with an empty draft gets
 * the height back by not rendering the textarea at all (`ChatInput`), and the
 * attachment row then carries a "Type here" target that brings it back. So this
 * module has nothing left to say about it — and the cases below pin that a
 * docked or stretched layout is unchanged by the feature.
 */
describe('composerExpansion has no compact size', () => {
  test('a docked phone keeps its full box: compact removes the element instead', () => {
    const layout = composerExpansion({ ...base, variant: 'mobile' });
    expect(layout.textareaClass).toContain('min-h-[68px]');
    expect(layout.textareaClass).not.toContain('h-9');
    // Still the same card frame as a tool card.
    expect(layout.cardClass).toContain('rounded-xl');
    expect(layout.cardClass).toContain('shadow-sm');
  });

  test('a desktop is untouched', () => {
    const layout = composerExpansion({ ...base, variant: 'desktop' });
    expect(layout.textareaClass).toContain('min-h-[80px]');
  });

  test('a stretched phone is the screen', () => {
    const layout = composerExpansion({ ...base, expanded: true, variant: 'mobile' });
    expect(layout.cardClass).toContain('rounded-none');
    expect(layout.textareaClass).toContain('h-full');
  });
});

describe('composerExpansion stretched', () => {
  test('a phone takes the viewport, and its popup opens over the draft', () => {
    const layout = composerExpansion({ ...base, expanded: true, variant: 'mobile' });
    // Position is its own field: a `relative` in the base list would WIN over
    // this `fixed` (Tailwind orders `static, fixed, absolute, relative, sticky`).
    expect(layout.cardPositionClass).toBe('fixed inset-0 z-40');
    expect(layout.cardClass).not.toContain('relative');
    // No frame on a full-screen surface — and `border-0` rather than
    // `border-transparent`, which would come back as an ink hairline on focus.
    expect(layout.cardClass).toContain('border-0');
    expect(layout.cardClass).not.toContain('focus-within:border-ink');
    expect(layout.textareaClass).toContain('h-full');
    expect(layout.wrapperClass).toBe('flex-1 min-h-0');
    expect(layout.pickerPlacement).toBe('over');
  });

  test('a desktop grows in place and keeps the dock width', () => {
    const layout = composerExpansion({ ...base, expanded: true, variant: 'desktop' });
    expect(layout.cardPositionClass).toBe('relative');
    expect(layout.textareaClass).toContain('min-h-[38vh]');
    expect(layout.wrapperClass).toBe('');
    // The popup still has the chat above it.
    expect(layout.pickerPlacement).toBe('up');
  });

  test('the keyboard lift rides the phone card only', () => {
    const phone = composerExpansion({ ...base, expanded: true, variant: 'mobile', keyboardInset: 336 });
    expect(phone.style?.paddingBottom).toBe('336px');
    // No keyboard: the home indicator's inset is the floor.
    const idle = composerExpansion({ ...base, expanded: true, variant: 'mobile' });
    expect(idle.style?.paddingBottom).toBe('env(safe-area-inset-bottom, 0px)');

    const desktop = composerExpansion({ ...base, expanded: true, variant: 'desktop', keyboardInset: 336 });
    expect(desktop.style).toBeUndefined();
  });
});
