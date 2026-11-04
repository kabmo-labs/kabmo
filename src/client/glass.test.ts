/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { THEMES } from '@/shared/lib/theme/catalog';
import { mixHex } from '@/shared/lib/theme/color';
import { contrastRatio } from '@/shared/lib/theme/legibility';

/**
 * The composer's `glass` style is a STYLE, not a surface style: it is offered in
 * the classic look too, where `[data-surface="glass"]` is not set. A `--glass-*`
 * token that is only declared inside that attribute block therefore does not
 * exist for the composer, and `background-color: var(--glass-card)` silently
 * computes to `rgba(0,0,0,0)` — a card with no fill at all. That is not
 * hypothetical: it shipped for the length of one edit, and the browser reported
 * it as a transparent composer while `getComputedStyle` on the token returned an
 * empty string.
 *
 * This asserts the shape of the contract rather than one value: every material
 * token the composer rule READS has to be declared where the rule can see it,
 * i.e. in `:root` (or a variant block), never only under the surface attribute.
 */
const read = (file: string): Promise<string> => Bun.file(new URL(file, import.meta.url)).text();

/** The body of the first rule whose selector starts a line, e.g. `[x] {`. */
function ruleBody(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'm'));
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  if (close < 0) throw new Error(`unterminated rule for ${selector}`);
  return css.slice(open + 1, close);
}

describe('glass composer material', () => {
  test('every --glass token the composer reads is declared in :root', async () => {
    const [glass, tailwind] = await Promise.all([read('./glass.css'), read('./tailwind.css')]);
    const composer = ruleBody(tailwind, '[data-composer-style="glass"]');
    const root = ruleBody(glass, ':root');

    const readTokens = [...new Set([...composer.matchAll(/var\((--glass-[a-z-]+)\)/g)].map((m) => m[1]))];
    // The rule reads its whole material from tokens; a literal here would mean a
    // second recipe for the same material, which is the defect this file guards.
    expect(readTokens.length).toBeGreaterThanOrEqual(6);

    for (const token of readTokens) {
      expect({ token, declared: new RegExp(`${token}\\s*:`).test(root) }).toEqual({ token, declared: true });
    }
  });

  test('the card carries a tint, transmitted light, a reflection and an edge', async () => {
    const [glass, tailwind] = await Promise.all([read('./glass.css'), read('./tailwind.css')]);
    const composer = ruleBody(tailwind, '[data-composer-style="glass"]');
    const root = ruleBody(glass, ':root');

    // Tint only is what read 1.03:1 against the surface beside it — a card you
    // could not see. The four layers are the material.
    expect(composer).toContain('background-color: var(--glass-card)');
    expect(composer).toContain('background-image: var(--glass-sheen), var(--glass-bloom)');
    expect(composer).toContain('box-shadow: var(--glass-card-edge), var(--glass-shadow)');
    // The CARD's rim, not the window's: the window edge carries `#fff 95%` at
    // 1.5px, which is a hard white line across a 620px card ("silau").
    expect(root).toContain('--glass-card-edge:');
    const cardEdge = root.slice(root.indexOf('--glass-card-edge:'), root.indexOf('--glass-edge:'));
    expect(cardEdge).not.toContain('#fff 95%');
    expect(root).toContain('--glass-bloom:');
    // The bloom is light that came THROUGH the pane: its hue is the palette's,
    // never a hardcoded colour — and it is the DARK variant's, because a palette
    // hue is darker than paper and smudges a light card instead of lighting it.
    const dark = glass.slice(glass.indexOf('[data-theme-variant="dark"]'));
    expect(dark).toContain('--glass-bloom:');
    expect(dark.slice(dark.indexOf('--glass-bloom:'))).toContain('var(--theme-info)');
    expect(root).toContain('--glass-bloom: none;');
  });

  test('a browser without a blur gets no bloom either', async () => {
    const glass = await read('./glass.css');
    // Two blocks restate the token list because CSS cannot OR a `@supports` with
    // a `@media`; both have to drop the bloom, or the decoration outlives the
    // translucency it exists for.
    const supports = glass.slice(glass.indexOf('@supports not ('), glass.indexOf('@media (prefers-reduced-transparency'));
    const reduced = glass.slice(glass.indexOf('@media (prefers-reduced-transparency'));
    for (const block of [supports, reduced]) {
      for (const token of ['--glass-bloom', '--glass-popover-bloom', '--glass-overlay-filter']) {
        expect({ token, dropped: block.includes(`${token}: none;`) }).toEqual({ token, dropped: true });
      }
    }
  });
});

/**
 * The popover tier is the same argument as the composer's, one size down: a
 * dropdown that carries only a tint reads as a LIFTED BOX, because on a dark
 * palette a translucent paper only ever darkens it. Measured on the
 * session-actions menu before the bloom — corner `(56,61,71)` over a body of
 * `(41,44,52)` on a sidebar of `(51,58,67)`, 1.09:1 against what it covers.
 */
describe('glass popover material', () => {
  test('the popover adds its own bloom on top of the shared material', async () => {
    const [glass, tailwind] = await Promise.all([read('./glass.css'), read('./tailwind.css')]);
    const root = ruleBody(glass, ':root');
    expect(root).toContain('--glass-popover-bloom:');

    // The shared block styles BOTH tiers and carries no bloom; the popover's own
    // rule is the one that paints it, and it must name the popover ALONE — a
    // shared rule would put a bloom inside a dialog's paragraph.
    expect(glass).toContain(
      '[data-surface="glass"] .glass-popover {\n  background-image: var(--glass-sheen), var(--glass-popover-bloom);',
    );

    const shared = glass.split('[data-surface="glass"] .glass-overlay,')[1] ?? '';
    const sharedBody = shared.slice(0, shared.indexOf('}'));
    expect(sharedBody).not.toContain('--glass-popover-bloom');
    expect(sharedBody).toContain('background-image: linear-gradient(');

    // A dialog keeps the sheen and the rim it was measured with: a dialog has
    // prose in the middle, and the bloom's whole point is that it stays in the
    // corners — which a dialog cannot afford to guess at.
    expect(tailwind).toContain('[data-composer-style="glass"]');
  });

  test('an anchored menu is a popover by construction, not by its caller', async () => {
    const menu = await read('./components/common/anchored-menu/index.tsx');
    const list = await read('./components/common/session-actions-menu/index.tsx');
    // The primitive stamps the tier, so a caller that forgets it is the only way
    // an anchored menu stays opaque under the glass surface.
    expect(menu).toContain('glass-popover fixed');
    expect(list).toContain('glass-popover fixed');
  });
});

/**
 * A workspace column is the same chrome as the sidebar beside it. Every view
 * under it opens with its own `bg-paper` root, which is right in the classic look
 * and wrong under the glass surface — measured, the 293px column composited to
 * the palette's solid paper while the sidebar was the plane's chrome.
 */
describe('glass column material', () => {
  test('a workspace column is chrome, and its view roots step aside for it', async () => {
    const [glass, panels] = await Promise.all([
      read('./glass.css'),
      read('./components/layout/desktop-layout/WorkspacePanels.tsx'),
    ]);
    // Measured: every right-panel view opens with its own `bg-paper` root, so the
    // 293px column composited to solid paper while the sidebar beside it was the
    // plane's chrome — two materials in one window ("right panel juga belum glass
    // banget"). The marker is on the SLOT (one owner), never on each view.
    expect(panels).toContain('data-panel-chrome=""');
    expect(panels).toContain('glass-chrome w-full h-full');
    expect(glass).toContain('[data-surface="glass"] [data-panel-chrome] > .bg-paper,');
  });

  test('a PLUGIN panel is reached through its scope span', async () => {
    const [glass, dock] = await Promise.all([
      read('./glass.css'),
      read('./components/layout/LeftDock.tsx'),
    ]);
    // A plugin's component renders inside `<span data-plugin-surface style="display: contents">`
    // — the scope the server wraps its stylesheet in — and that span has a BOX
    // even though it paints none, so the child combinator stops there. Measured
    // on the three bundled marketplace plugins, every one painted
    // `rgb(40,44,52)` over the column before this selector existed.
    expect(glass).toContain('[data-surface="glass"] [data-panel-chrome] > [data-plugin-surface] > .bg-paper {');
    // And the LEFT column carries the same marker: a plugin placed on the left
    // draws its own `bg-paper` root too.
    expect(dock).toContain('data-panel-chrome=""');
  });
});

/**
 * A dialog is the largest surface in the app and the one that showed the least:
 * at 96% tint the veil contributes 4%, so a settings panel measured as a uniform
 * fill with no material at all ("setting modal juga belum glass"). The material
 * is LOCAL light plus a frosted veil, and both have to survive the fallbacks.
 */
describe('glass dialog material', () => {
  test('the dialog paints its own light, and the popover does not borrow it', async () => {
    const glass = await read('./glass.css');
    expect(ruleBody(glass, ':root')).toContain('--glass-dialog-bloom:');
    expect(glass).toContain('[data-surface="glass"] .glass-overlay {\n  background-image: var(--glass-dialog-bloom);');

    // The peak sits OUTSIDE the frame: on it, the light lands on the settings nav
    // and drags its 12px labels from 3.8:1 to 3.0:1.
    const dialog = glass.slice(glass.indexOf('--glass-dialog-bloom:'));
    const dark = dialog.slice(dialog.indexOf('[data-theme-variant="dark"]'));
    expect(dark.slice(0, dark.indexOf('}'))).toContain('at -4% -8%');
  });

  test('a dialog chrome strip steps aside, and only the direct child does', async () => {
    const glass = await read('./glass.css');
    // Measured on the git commit history modal: its 1198x109 `bg-paper` header
    // painted the palette's SOLID paper across the top of a 1200x792 panel, so the
    // panel's highlight and top-left bloom never rendered and the face read as one
    // flat value. The dialog's BODY keeps every card it draws.
    expect(glass).toContain('[data-surface="glass"] .glass-overlay > .bg-paper {\n  background-color: transparent;');
  });

  test('a switch knob is not a canvas well, and the exclusion is in the well rule itself', async () => {
    const glass = await read('./glass.css');
    // The knob is `bg-canvas` on `bg-ink/70`: an OPAQUE contrasting disc is what
    // makes the control read as a toggle. It was first exempted by a SECOND rule,
    // and that rule never applied — `[role="switch"] .bg-canvas` is (0,4,0) and
    // the well selector is (0,5,0), so the well won and every knob on every
    // surface (desktop and phone alike) computed `rgba(0,0,0,0)`. Measured on the
    // plugin switches: a plain pill with no "on" position.
    const well = glass.slice(glass.indexOf('[data-surface="glass"] .app-window .bg-canvas'));
    expect(well.slice(0, well.indexOf('{'))).toContain(':not([role="switch"] *)');
    // A same-property override anywhere later would be the same race again, so
    // there must be no second `background-color` rule for that knob at all.
    expect(glass).not.toContain('[data-surface="glass"] .app-window [role="switch"] .bg-canvas');
  });

  test('both fallback blocks outrank the dark palette block', async () => {
    const glass = await read('./glass.css');
    // The dark tokens live in `[data-surface="glass"][data-theme-variant="dark"]`
    // (0,2,0). A plain `[data-surface="glass"]` fallback is (0,1,0) and LOSES on
    // every dark palette — measured, `.glass-chrome` kept alpha 0.38 under the
    // block meant to make it opaque, i.e. a translucent plane with no blur behind
    // it, the exact state these blocks exist to prevent. `:root` adds the
    // pseudo-class that ties, and source order then wins.
    const supports = glass.slice(glass.indexOf('@supports not ('), glass.indexOf('@media (prefers-reduced-transparency'));
    const reduced = glass.slice(glass.indexOf('@media (prefers-reduced-transparency'));
    for (const block of [supports, reduced]) {
      expect(block).toContain(':root[data-surface="glass"] {');
      // Not enough on its own: the token list has to be inside that block.
      expect(block).toContain('--glass-chrome: var(--theme-paper);');
    }
  });

  test('the veil is frosted under the glass surface and only there', async () => {
    const [tailwind, glass] = await Promise.all([read('./tailwind.css'), read('./glass.css')]);
    expect(tailwind).toContain("[data-surface='glass'] .modal-scrim {\n  backdrop-filter: blur(20px) saturate(120%);");

    // Both fallback blocks drop it with the rest of the material.
    const supports = glass.slice(glass.indexOf('@supports not ('), glass.indexOf('@media (prefers-reduced-transparency'));
    const reduced = glass.slice(glass.indexOf('@media (prefers-reduced-transparency'));
    for (const block of [supports, reduced]) {
      expect(block).toContain('--glass-dialog-bloom: none;');
      expect(block).toContain('.modal-scrim {\n    backdrop-filter: none;');
    }
  });
});

/**
 * The material has to hold on EVERY palette in the catalog, not on the eighteen
 * it was tuned against. The alphas are read out of `glass.css` itself, so this
 * cannot drift from the shipped values, and the composite it measures is the one
 * the browser computes: `color-mix(… paper N%, transparent)` over the plane,
 * which is itself paper over canvas.
 *
 * The invariant is the one a new palette can break without anyone noticing: body
 * text on the chrome and on a card keeps the 4.5:1 floor. Measured across all 63
 * palettes, the worst is `solarized-light` at 4.89:1 — the same number its
 * opaque paper has, which is what "the tint costs no contrast" means.
 */
describe('glass material across the catalog', () => {
  const alphaOf = (body: string, token: string): number => {
    const match = new RegExp(`${token}: color-mix\\(in srgb, var\\(--theme-paper\\) (\\d+)%, transparent\\)`).exec(body);
    if (!match) throw new Error(`no ${token} alpha`);
    return Number(match[1]) / 100;
  };
  const percentOf = (body: string, token: string): number => {
    const match = new RegExp(`${token}: (\\d+)%;`).exec(body);
    if (!match) throw new Error(`no ${token}`);
    return Number(match[1]) / 100;
  };

  test('every palette keeps body text legible on the plane, the chrome and a card', async () => {
    const glass = await read('./glass.css');
    const light = ruleBody(glass, '[data-surface="glass"]');
    const dark = ruleBody(glass, '[data-surface="glass"][data-theme-variant="dark"]');
    const root = ruleBody(glass, ':root');
    const darkVariant = ruleBody(glass, '[data-theme-variant="dark"]');

    const alphas = {
      light: {
        tint: percentOf(light, '--glass-tint'),
        chrome: alphaOf(light, '--glass-chrome'),
        // A card's fill is surface-INDEPENDENT (the composer's `glass` style is
        // offered in the classic look), so it lives on `:root` / the variant.
        card: alphaOf(root, '--glass-card'),
      },
      dark: {
        tint: percentOf(dark, '--glass-tint'),
        chrome: alphaOf(dark, '--glass-chrome'),
        card: alphaOf(darkVariant, '--glass-card'),
      },
    };

    for (const theme of THEMES) {
      const alpha = alphas[theme.variant];
      const plane = mixHex(theme.canvas, theme.paper, alpha.tint);
      const chrome = mixHex(plane, theme.paper, alpha.chrome);
      const card = mixHex(plane, theme.paper, alpha.card);
      for (const [tier, surface] of [['plane', plane], ['chrome', chrome], ['card', card]] as const) {
        expect({ id: theme.id, tier, ratio: contrastRatio(theme.ink, surface) >= 4.5 }).toEqual({
          id: theme.id,
          tier,
          ratio: true,
        });
      }
    }
  });
});

/**
 * The material is DERIVED from the palette — `--glass-panel` is
 * `color-mix(paper N%, transparent)` and the chrome is one more mix over it — so
 * a theme does not "support glass" by declaring something; it supports it when
 * its two surfaces and its ink survive the composite. That makes a bad port
 * invisible in the classic look and illegible under the material, which is the
 * failure this sweep exists to catch.
 *
 * The alphas are read out of `glass.css` rather than repeated here, so the test
 * cannot drift from the shipped values, and the composite is the browser's own:
 * plane = paper over canvas, chrome/card = paper over plane.
 */
describe('glass material on every catalog palette', () => {
  /** A percentage out of a token, whether bare (`50%`) or inside a `color-mix`. */
  const percentOf = (body: string, token: string): number => {
    const match = new RegExp(`--glass-${token}:\\s*(?:color-mix\\(in srgb, var\\(--theme-paper\\)\\s*)?(\\d+(?:\\.\\d+)?)%`).exec(body);
    if (!match) throw new Error(`--glass-${token} is not a percentage in this block`);
    return Number(match[1]) / 100;
  };

  test('body text keeps the 4.5:1 floor on the plane, the chrome and a card', async () => {
    const glass = await read('./glass.css');
    const surface = ruleBody(glass, '[data-surface="glass"]');
    const surfaceDark = ruleBody(glass, '[data-surface="glass"][data-theme-variant="dark"]');
    const root = ruleBody(glass, ':root');
    const variantDark = ruleBody(glass, '[data-theme-variant="dark"]');

    // The card's fill is surface-INDEPENDENT (the composer's `glass` style is
    // offered in the classic look too), so it lives on `:root` and the variant
    // block, not under the surface attribute.
    const alphas = {
      light: { tint: percentOf(surface, 'tint'), chrome: percentOf(surface, 'chrome'), card: percentOf(root, 'card') },
      dark: { tint: percentOf(surfaceDark, 'tint'), chrome: percentOf(surfaceDark, 'chrome'), card: percentOf(variantDark, 'card') },
    };
    expect(alphas.light.tint).toBeGreaterThan(alphas.dark.tint - 1);
    expect(alphas.light.chrome).toBeLessThan(alphas.dark.chrome + 0.5);

    const failures: string[] = [];
    for (const theme of THEMES) {
      const alpha = alphas[theme.variant];
      const plane = mixHex(theme.canvas, theme.paper, alpha.tint);
      const tiers = {
        plane,
        chrome: mixHex(plane, theme.paper, alpha.chrome),
        card: mixHex(plane, theme.paper, alpha.card),
      };
      for (const [tier, fill] of Object.entries(tiers)) {
        const ratio = contrastRatio(theme.ink, fill);
        if (ratio < 4.5) failures.push(`${theme.id} ${tier} ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });
});
