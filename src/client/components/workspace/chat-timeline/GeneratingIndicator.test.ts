/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Identity half of the docked generating indicator.
 *
 * A fresh spawn has no identity for its first seconds: the `new-…` session has
 * no sidebar row yet, so `runModel` is null, and `seedSession` only writes the
 * resolved model once the spawn response lands. The identity slot therefore
 * rendered empty while the verb rendered beside it — `• Thinking…`, a bullet
 * with nothing in front of it. The component must name the WAIT in that state
 * instead of painting a blank identity, and must keep naming the real run the
 * moment either half arrives (a provider-only identity still says which account
 * is answering).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GeneratingIndicator } from '@/client/components/workspace/chat-timeline/GeneratingIndicator';

let container: HTMLElement;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

async function mount(props: Record<string, unknown>): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(GeneratingIndicator, { generatingVerb: 'Thinking', ...props }), container);
  });
  return container;
}

describe('GeneratingIndicator identity', () => {
  test('an unknown identity names the wait instead of drawing a bullet with nothing in front of it', async () => {
    const el = await mount({});
    expect(el.textContent).toContain('Loading');
    // The verb belongs to a run whose identity is known: beside an empty
    // identity it read as a stray bullet.
    expect(el.textContent).not.toContain('Thinking');
    expect(el.textContent).not.toContain('•');
  });

  test('a blank model name is not an identity', async () => {
    const el = await mount({ modelName: '   ' });
    expect(el.textContent).toContain('Loading');
  });

  test('the model names the run and keeps the verb', async () => {
    const el = await mount({ modelName: 'DeepSeek V4 Flash' });
    expect(el.textContent).toContain('DeepSeek V4 Flash');
    expect(el.textContent).toContain('Thinking');
    expect(el.textContent).not.toContain('Loading');
  });

  test('a provider-only identity still names the run', async () => {
    const el = await mount({ provider: 'kenari' });
    expect(el.textContent).toContain('Kenari');
    expect(el.textContent).toContain('Thinking');
    expect(el.textContent).not.toContain('Loading');
    // The separator belongs to the PAIR: there is no model half to separate.
    expect(el.textContent).not.toContain('•');
  });
});

/**
 * The row's shrink contract, which is the layout half of the reported bug.
 *
 * happy-dom computes no layout, so the assertions here are on the MARKUP that
 * produces it — and the browser specs (`chat.e2e.ts` / `mobile.e2e.ts`,
 * "keeps the provider, model and dots when the activity phrase is long") are
 * what prove the geometry. This suite is the fast gate: it fails when the
 * structure that makes a long phrase ellipsize is removed.
 *
 * What broke: the activity phrase was one non-shrinking span (`shrink-0` with
 * no truncation), so `Running <a long command>` took its full width, the
 * identity spans beside it shrank to zero, and the dots — siblings of that
 * span, in a row that clips — were drawn past the row's right edge.
 */
describe('GeneratingIndicator long-phrase layout', () => {
  /** The span that holds the animated dots, and the phrase wrapper beside it. */
  function rowParts(el: HTMLElement) {
    const dots = el.querySelector('.dot-anim-1')?.parentElement ?? null;
    const verbWrap = dots?.parentElement ?? null;
    const verb = verbWrap?.firstElementChild as HTMLElement | null;
    return { dots, verbWrap, verb };
  }

  test('the activity phrase is the truncating member, and the dots are its sibling', async () => {
    const el = await mount({
      provider: 'kenari',
      modelName: 'DeepSeek V4 Flash',
      generatingVerb: 'Running rg -n --hidden "a very long pattern" src/client/components/workspace',
    });
    const { dots, verb, verbWrap } = rowParts(el);
    expect(verb, 'no activity phrase element').not.toBeNull();
    expect(dots, 'no dots element').not.toBeNull();

    // The phrase is what gives up width — a truncating box inside a wrapper
    // that is allowed to shrink.
    expect(verb!.className).toContain('truncate');
    expect(verb!.className).toContain('min-w-0');
    expect(verbWrap!.className).toContain('flex-1');
    // The wrapper carries a floor, so the phrase cannot be squeezed away
    // entirely while it is the only thing that may truncate.
    expect(verbWrap!.className).toContain('min-w-[4rem]');

    // The dots never shrink, and they are a SIBLING of the phrase — inside a
    // truncated element they would be clipped with it.
    expect(dots!.className).toContain('shrink-0');
    expect(dots!.parentElement).toBe(verbWrap);
    expect(dots!.previousElementSibling).toBe(verb);

    // The full phrase is still available on hover, so the ellipsis hides
    // nothing permanently.
    expect(verb!.getAttribute('title')).toContain('Running rg -n');
  });

  test('the identity spans are separate members that can ellipsize', async () => {
    const el = await mount({ provider: 'kenari', modelName: 'DeepSeek V4 Flash' });
    const { verbWrap } = rowParts(el);
    const identity = [...(verbWrap?.parentElement?.children ?? [])]
      .filter((node): node is HTMLElement => node !== verbWrap && Boolean(node.textContent?.trim()))
      .filter((node) => node.textContent?.trim() !== '•');
    expect(identity.length, 'provider and model are not two members').toBe(2);
    for (const half of identity) {
      // Each half may ellipsize, but neither is `shrink-0`: a fixed-width
      // identity would push the phrase out on a narrow phone instead.
      expect(half.className).toContain('truncate');
      expect(half.className).toContain('min-w-0');
      expect(half.className).not.toContain('shrink-0');
    }
  });
});

/**
 * The mark: a nine-hue ring spun behind the ink badge.
 *
 * The ring was replaced by a bare ink badge because chroma is reserved for
 * state, and that replacement shipped with no motion at all — its own comment
 * promised `animate-pulse`, but the class was never applied, so a busy row
 * looked exactly like a settled one. Restoring it must keep two properties the
 * first version got wrong: the gradient is declared ONCE in the stylesheet (a
 * component-level style block re-declared it on every render of every
 * indicator in the transcript), and the spin is the shared `.animate-spin` so
 * the reduced-motion rule can slow it instead of freezing an indicator that
 * then looks stuck.
 */
describe('GeneratingIndicator mark', () => {
  test('the ring is rendered behind the badge and spins', async () => {
    const el = await mount({ modelName: 'DeepSeek V4 Flash' });
    const ring = el.querySelector('.generating-mark-ring');
    expect(ring, 'no generating mark ring').not.toBeNull();
    expect(ring!.className).toContain('animate-spin');
    // Decorative: the badge beside it carries the meaning.
    expect(ring!.getAttribute('aria-hidden')).toBe('true');
  });

  test('the gradient is declared in the stylesheet, not inline in the component', async () => {
    const css = await Bun.file(new URL('../../../tailwind.css', import.meta.url)).text();
    const rule = css.slice(css.indexOf('.generating-mark-ring {'));
    const body = rule.slice(0, rule.indexOf('\n}'));
    expect(body).toContain('conic-gradient');
    // Nine stops, all nine hues: a two-stop gradient is not the mark.
    expect((body.match(/#[0-9a-fA-F]{6}/g) ?? []).length).toBe(9);

    // The component must not carry a hex or an inline `<style>` of its own —
    // the reason the first version was removed is not the colour, it is where
    // the colour was written.
    const source = await Bun.file(new URL('./GeneratingIndicator.tsx', import.meta.url)).text();
    expect(source).not.toContain('conic-gradient');
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(source).not.toContain('<style>');
  });
});
