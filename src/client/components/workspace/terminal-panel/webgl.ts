/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal's WebGL context, and when it is allowed to exist.
 *
 * xterm's WebGL renderer draws powerline glyphs (U+E0B0 etc.) as full-cell vector
 * paths, so segmented prompts stay seamless the way a local terminal does; the DOM
 * renderer draws them as ordinary glyphs inside the font box, which leaves notches
 * at every segment joint. That is why it is on at all.
 *
 * **It is not on permanently, and that is the point of this module.** A WebGL
 * context costs GPU memory for as long as it lives — a glyph atlas plus the
 * layer's textures — and the right-panel stack keeps every built-in view MOUNTED
 * while another one is on screen, the terminal included, because it owns a live
 * PTY. Eight terminals therefore held eight contexts. Measured with `vmmap` on the
 * desktop shell: `owned unmapped (graphics)` was 541.8 MB of an 817.7 MB physical
 * footprint, while the JS heap was 12.6 MB — so no garbage collection could ever
 * have returned it.
 *
 * `attach()` on show and `detach()` on hide is the whole API: xterm falls back to
 * its DOM renderer in between, so the buffer stays readable and scrolling still
 * works while the panel is not the one on screen.
 */

import type { Terminal } from '@xterm/xterm';
import type { WebglAddon } from '@xterm/addon-webgl';

/** The addon class, or undefined when the module cannot be imported. */
type WebglAddonClass = new () => WebglAddon;

/**
 * Load the WebGL addon lazily.
 *
 * Dynamic on purpose: `@xterm/addon-webgl` is only needed once a terminal exists,
 * so it stays out of the initial client bundle. The module shape varies by build,
 * hence the probes.
 */
async function loadAddonClass(): Promise<WebglAddonClass | undefined> {
  try {
    const module = (await import('@xterm/addon-webgl')) as unknown as {
      WebglAddon?: WebglAddonClass;
      default?: { WebglAddon?: WebglAddonClass } & WebglAddonClass;
    };
    return module.WebglAddon || module.default?.WebglAddon || module.default;
  } catch {
    return undefined;
  }
}

export interface WebglControl {
  /** Hold the context: loads the addon if it is not loaded. */
  attach: () => void;
  /** Release the context, leaving xterm on its DOM renderer. */
  detach: () => void;
  /** The current state, for a caller that mounts while hidden. */
  set: (enabled: boolean) => void;
}

/**
 * Bind a WebGL context to `term`, held only while `attach` has been called.
 *
 * Failure is not an error the caller can act on: a machine with no GPU context, a
 * context lost to the driver, and a build without the addon all end in the same
 * place — the DOM renderer, which is what xterm does when no renderer addon is
 * loaded.
 */
export async function createWebglControl(term: Terminal): Promise<WebglControl> {
  const AddonClass = await loadAddonClass();
  let addon: WebglAddon | null = null;

  const attach = (): void => {
    if (!AddonClass || addon) return;
    try {
      const created = new AddonClass();
      created.onContextLoss(() => {
        // The driver took the context away. Disposing is what lets xterm fall
        // back to the DOM renderer instead of drawing nothing.
        created.dispose();
        if (addon === created) addon = null;
      });
      term.loadAddon(created);
      addon = created;
    } catch {
      addon = null;
    }
  };

  const detach = (): void => {
    if (!addon) return;
    const previous = addon;
    addon = null;
    try {
      previous.dispose();
    } catch {
      // A context the driver already destroyed throws on dispose; the reference
      // is dropped either way.
    }
  };

  return {
    attach,
    detach,
    set: (enabled: boolean) => (enabled ? attach() : detach()),
  };
}
