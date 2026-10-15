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
    expect(layout.textareaClass).toContain('text-base');
    expect(layout.pickerPlacement).toBe('up');
    expect(layout.style).toBeUndefined();
  });

  test('a desktop keeps its 80px box', () => {
    const layout = composerExpansion({ ...base, variant: 'desktop' });
    expect(layout.textareaClass).toContain('min-h-[80px]');
    expect(layout.textareaClass).toContain('text-sm');
    expect(layout.pickerPlacement).toBe('up');
  });

  test('a file drag is what the frame border reports', () => {
    expect(composerExpansion({ ...base, variant: 'desktop' }).cardClass).toContain('border-ink/20');
    expect(composerExpansion({ ...base, variant: 'desktop', isDragging: true }).cardClass).toContain('border-ink/40');
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
