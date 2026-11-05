/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * No ICON is painted with a Tailwind PALETTE class.
 *
 * `DESIGN.md` says it in one line — never write a colour in a component, every
 * colour is a `var(--theme-*)` or a Tailwind class mapped to one — and an icon is
 * where the rule kept being broken, because a palette class there does not look
 * wrong on the developer's own theme. Hence a source scan rather than a review
 * note.
 *
 * ## The measurements behind it
 *
 * Over the 32 light palettes this build ships: `text-amber-500` reaches
 * **1.64:1**, `text-sky-400` **1.63:1**, `text-emerald-500` **1.93:1**,
 * `text-emerald-600` **2.87:1** — the floor for a graphic is 3:1. Every one of
 * them was on an icon that MEANT something (a save in progress, a favourite
 * star, a connected check), so the colour was the message and the message was
 * invisible. A fixed rung also ignores the theme: it is correct for none of the
 * 63 palettes and legible on about half.
 *
 * The theme's signal tokens are the answer, and they are not a matter of taste:
 * `signalTextColor` solved `text-success` to 4.50:1 minimum on every palette of
 * both variants.
 *
 * ## Scope: ICONS, not every coloured surface
 *
 * This walks the `<Icon className=…>` elements of files that import
 * `lucide-preact`, and the icon modules that draw their own `<svg>`. It
 * deliberately does NOT flag:
 *
 * - **A categorical chart series** (`TokenDistributionBar`), where the colours
 *   distinguish four series from each other rather than carry a status, and the
 *   theme has no token for "series 3".
 * - **A decorative dot or gradient** (`raw-messages.ts`'s per-role dots, the
 *   wordmark's brand gradient), which is not an icon and is not what this rule
 *   is about.
 */

import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';

/** The Tailwind palette families that are NOT the theme's tokens. */
const FAMILIES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/** `text-amber-500`, `fill-sky-400`, … — colour utilities, with a numeric rung. */
const PALETTE_CLASS = new RegExp(
  `\\b(?:text|fill|stroke|bg|ring)-(?:${FAMILIES})-(?:50|[1-9]00|950)\\b(?:/\\d+)?`,
  'g',
);

/** Icon modules that render their own `<svg>` instead of a Lucide component. */
const ICON_MODULE = /components\/(?:common|settings\/categories)\/[^/]*(?:icon|mark|logo|wordmark)[^/]*\//;

async function offendingIcons(): Promise<string[]> {
  const found: string[] = [];
  for await (const path of new Glob('src/client/**/*.{ts,tsx}').scan('.')) {
    if (/\.test\.(ts|tsx)$/.test(path)) continue;
    const source = await Bun.file(path).text();
    const importsLucide = source.includes("from 'lucide-preact'");
    if (!importsLucide && !ICON_MODULE.test(path)) continue;

    // The className value of a Lucide element, or of an `<svg>` in an icon module.
    const elements = importsLucide
      ? [...source.matchAll(/<([A-Z][A-Za-z0-9]*)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})[^>]*>/g)].filter(
          ([, name]) => !['div', 'span', 'button'].includes(name!),
        )
      : [...source.matchAll(/<svg\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})[^>]*>/g)];

    for (const element of elements) {
      const classes = element[1] ?? element[2] ?? '';
      for (const match of classes.matchAll(PALETTE_CLASS)) {
        const line = source.slice(0, element.index).split('\n').length;
        found.push(`${path}:${line}  ${match[0]}`);
      }
    }
  }
  return found;
}

describe('an icon is painted by the theme, never by a palette rung', () => {
  test('no icon carries a Tailwind palette class', async () => {
    // Measured on the 32 light palettes: amber-500 1.64:1, sky-400 1.63:1,
    // emerald-500 1.93:1, emerald-600 2.87:1 — under the 3:1 non-text floor, on
    // icons whose colour IS the message. The signal tokens clear it everywhere.
    const offenders = await offendingIcons();
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
