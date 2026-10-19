/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hydrate a message's plugin directives: swap each claimed fence's placeholder
 * for the plugin's component.
 *
 * The mirror of `hydrateMermaidBlocks`, and it exists for the same reason: the
 * parser is shared and knows nothing about which plugins are installed, so it
 * emits a placeholder and the CLIENT decides. A fence no plugin claims keeps
 * the code block the placeholder wraps, which is what makes "unclaimed renders
 * as before" structural rather than a rule to remember.
 *
 * A plugin's component is rendered with `render()` into the placeholder, so a
 * directive behaves like any other slot component — same tree, same Preact
 * instance, same theme. Only the FIRST registration for a name can exist
 * (the store refuses a second claim across plugins), so there is no arbitration
 * here.
 *
 * A component that THROWS leaves the code block: the placeholder's fallback is
 * already on screen, so the recovery is to leave it alone rather than replace it
 * with an error.
 */

import { h, render } from 'preact';
import type { MessageDirectiveRegistration } from '@kabmo-labs/plugin-sdk';
import { PluginIdProvider } from '@kabmo-labs/ui';
import type { SlotContextProps } from '@kabmo-labs/plugin-sdk';
import {
  DIRECTIVE_ATTRS_ATTR,
  DIRECTIVE_BLOCK_CLASS,
  DIRECTIVE_NAME_ATTR,
  readDirectiveAttributes,
} from '@/shared/lib/markdown/directives';

/** One directive a plugin can draw, resolved from the store. */
export interface DirectiveRenderer {
  pluginId: string;
  registration: MessageDirectiveRegistration;
}

/** A named element renderer, for a test or a host that renders off-tree. */
export type DirectiveElementRenderer = (name: string) => DirectiveRenderer | undefined;

/**
 * Render every claimed directive inside `container`.
 *
 * Idempotent: an already-hydrated placeholder is left alone, so a re-run (the
 * timeline rewrites innerHTML with an identical string) does not re-render the
 * component or lose its state.
 */
export function hydrateDirectiveBlocks(
  container: HTMLElement,
  resolve: DirectiveElementRenderer,
  context: SlotContextProps,
): void {
  const blocks = container.querySelectorAll<HTMLElement>(`.${DIRECTIVE_BLOCK_CLASS}[${DIRECTIVE_NAME_ATTR}]`);
  for (const block of blocks) {
    const name = block.getAttribute(DIRECTIVE_NAME_ATTR);
    if (!name) continue;
    const renderer = resolve(name);
    if (!renderer) continue;
    // A claimed block is replaced ONCE. A component that has to change with
    // context (a session switch) re-renders through its own hooks, not through
    // a second hydration.
    if (block.dataset.hydrated === '1') continue;

    const body = readDirectiveBody(block);
    // Kept BEFORE the swap: the fallback the parser emitted is what a throwing
    // component falls back TO, and once `replaceChildren` has run it would be
    // unreachable.
    const fallback = fallbackOf(block);
    const host = document.createElement('div');
    host.className = 'plugin-directive';
    block.replaceChildren(host);

    try {
      render(
        h(
          PluginIdProvider,
          { pluginId: renderer.pluginId },
          h(renderer.registration.component, {
            ...context,
            name,
            body,
            attributes: readDirectiveAttributes(block.getAttribute(DIRECTIVE_ATTRS_ATTR)),
          }),
        ),
        host,
      );
      block.dataset.hydrated = '1';
    } catch {
      // A component that throws leaves the CODE BLOCK, which is what the
      // placeholder held before this call — never an error page in the middle
      // of a message. Verified reachable: a component that throws on its first
      // render.
      render(null, host);
      block.replaceChildren(fallback ?? document.createElement('div'));
      block.dataset.hydrated = 'failed';
    }
  }
}

/**
 * The fenced block's raw text, read back from the fallback the parser emitted.
 *
 * Read from the DOM rather than threaded through an attribute: the code element
 * already carries the exact text (the parser escaped it for display, and
 * `textContent` undoes that), and a second copy on the wrapper would double
 * every directive's size in the HTML.
 */
function readDirectiveBody(block: HTMLElement): string {
  return block.querySelector('pre > code')?.textContent ?? '';
}

/** The placeholder's original children, kept across the replace. */
function fallbackOf(block: HTMLElement): Element | null {
  return block.querySelector('.code-block');
}

/**
 * Take a hydrated directive down, so an unmounted timeline leaks no tree.
 *
 * The `data-hydrated` marker is deliberately NOT cleared. Preact runs an
 * effect's cleanup AFTER the new DOM is committed (measured), so the real
 * re-render path — `html` changed — finds fresh markup with no marker and
 * hydrates normally; the cleanup here sees no `.plugin-directive` hosts and is
 * a no-op. The only case that reaches a live host is the message being REMOVED,
 * where nothing re-hydrates it, so a cleared marker would buy nothing and a
 * second hydrate over the same DOM would read an already-replaced fallback and
 * render an empty body.
 */
export function unmountDirectiveBlocks(container: HTMLElement): void {
  for (const host of container.querySelectorAll<HTMLElement>('.plugin-directive')) {
    render(null, host);
  }
}
