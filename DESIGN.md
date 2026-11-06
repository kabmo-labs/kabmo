# DESIGN.md: Kabmo's design direction

Kabmo is a **web console and diagnostic workbench for Oh-My-Pi (`omp`) agent sessions**. It is
read for hours, often beside a terminal, and its job is to make an autonomous run legible: what
the agent is doing, what it changed, what it is waiting for.

This file is the direction the UI is held to. Every claim here is measured against the code and
the running app; the module that owns each fact is named so a change has one place to land.

**Dial: ENERGY 1 / RHYTHM 2 / MOTION 1.** A tool that is read, not a page that is pitched. The
console speaks quietly, sections differ where the work differs (chat, file tree, diff, terminal),
and nothing moves unless it is reporting live state.

---

## 1. Palette and surfaces

One palette per theme, and the theme is the user's. Sixty-three palettes ship (Kabmo's own three
first, then ported families); all of them are data in
`src/shared/lib/theme/palettes/`, and the CSS is generated from that data by
`src/shared/lib/theme/css.ts`. Never hand-write a palette block.

| Token | Variable | Purpose |
|---|---|---|
| App ground | `--theme-canvas` | The window behind panels |
| Raised surface | `--theme-paper` | Panels, cards, sidebars, dialogs |
| Primary ink | `--theme-ink` | Body text, filled buttons, active glyphs |
| Muted inks | `--theme-ink-muted` … `-4` | Four muted weights, floor 4.5 / 6.25 / 8.7 / 12.1 |
| On-ink ink | `--theme-on-ink-muted` | Muted text on an inverted surface (`bg-ink`) |
| Hairline | `color-mix(ink 14%)` | 1px rules and dividers only, never text |
| Signal colours | `--theme-error`, `--theme-success`, `--theme-info`, `--theme-warning`, `--theme-meta` | Status only, see §3 |

**The muted ink is a lightness ramp, not a contrast curve.** `src/shared/lib/theme/ink-scale.ts`
derives each of the fifteen steps as the palette's ink at that percentage over its paper. On `paper`
the ramp moves OKLab L by a steady 0.034–0.045 per step:

| Step | Colour | Contrast | L |
|---|---|---|---|
| `/20` | `#cccac6` | 1.45:1 | 0.839 |
| `/40` | `#9e9c98` | 2.43:1 | 0.693 |
| `/55` | `#7b7a76` | 3.81:1 | 0.579 |
| `/65` | `#65635f` | 5.31:1 | 0.500 |
| `/80` | `#42413d` | 9.06:1 | 0.375 |
| `/90` | `#2b2a27` | 12.72:1 | 0.285 |

**Legibility is a floor, not a reshape.** `TEXT_CONTRAST_FLOOR` (`/65`) is the lightest step that
still clears AA on `paper` — 5.31:1, with `/60` at 4.46:1 just below. Anything that must be readable
sits at or above it. Below the floor the ramp carries decoration, empty-state captions and
placeholders, which WCAG 1.4.3 exempts as incidental text and which look wrong when they reach
4.5:1: a placeholder that reads as strongly as a typed value makes an empty field look filled.

Do not "fix" the ramp by fitting every step to 4.5:1. It was tried, twice, and the measurement is
why this section exists. Contrast is not linear in lightness: lifting `/20` from 1.45:1 to 4.5:1
consumes 0.30 of L while the whole `/60`–`/90` range spans 0.26, so twelve steps end up competing
for 0.35 of L and compress unevenly — ΔL 0.193 at the light end against 0.098 at the dark end.
Measured consequences: the tool card's header (`/60`) and subtitle (`/45`) collapsed from ΔL 0.116 to
0.081 and read as the same grey, and the composer placeholder (`/40`) went from 2.58:1 to 5.40:1,
"too strong" against the text beside it. A ramp's job is even spacing; AA is a floor on the steps
that carry meaning.

An alpha ramp cannot clear AA on all 63 palettes at once — the measured floor ranges from `/50` to
`/90` depending on the palette — so `inkScale().muted` is that palette's own lightest legal step,
and `solarized-light` (ink 4.85:1) puts it on its own ink rather than inventing contrast.

An inverted surface (`bg-ink`) gets its own solved level, `--theme-on-ink-muted`: an alpha over the
canvas reads **2.91:1** there on `solarized-light`, and even the full canvas only reaches 4.99.

The classes `text-ink/40` … `text-ink/80` are mapped in `tailwind.css` onto `--theme-ink-NN`; the
names mean a **weight**, which is also how the icon system reads them
(`src/shared/lib/icons/icon-paint-weight.ts`). Never write `text-ink-NN` with a hyphen — that class
does not exist, and the element silently inherits its parent's colour.

Never write a hex in a component. Every colour is a `var(--theme-*)` or a Tailwind class mapped to
one.

---

## 2. Typography

- **UI: the system stack** (`-apple-system`, `Segoe UI`, `Roboto`, …) plus the bundled Nerd Font
  symbols face last. Stated once in `tailwind.css` (both `body` and `@theme --font-sans`). The
  product reads like the machine it runs on, and a console that ships a webfont for its chrome is
  paying a round trip for a voice it already has.
- **Data and code: Fira Code**, bundled from `@fontsource/fira-code`, with
  `font-variant-numeric: tabular-nums` everywhere numbers are compared (durations, tokens, diff
  counts, hashes, log lines).
- **Micro-headers**: 10-11px, weight 600, `uppercase`, `tracking-wider`, tertiary ink. This is a
  dense console; 10px is the floor for text a user must read, and there is no 8px or 9px step.
- No third-party webfont is loaded. If one ever is, the family must appear in a stylesheet.

---

## 3. Chroma is state, not decoration

The palette's five signal colours are for status and nothing else: a failing tool call, a
successful one, a warning, an informational fact, an accent. There is no gradient, glow, or
per-element hue as personality — with **one named exception**: the generating indicator's mark
(`.generating-mark-ring`, `src/client/tailwind.css`). The monochrome replacement shipped with no
motion at all (the `animate-pulse` its own comment promised was never applied), which left a busy
row looking identical to a settled one; the spun ring is what makes "a run is in flight" legible at
a glance. The gradient is declared once in the stylesheet — never inline in a component — and the
spin rides the shared `.animate-spin` so the reduced-motion rule slows it rather than freezing it.

**Icons.** Lucide is the functional glyph set (346 files import it), and the colour mode tints each
glyph by its own hue — solved per hue in **both** variants (`ICON_TONES`, `ICON_TONES_DARK`), never
one `hsl()` pair for the whole wheel, because a single pair spends its legibility budget on the worst
hue and leaves the muddiest row at a quarter of the vividest row's chroma. Monochrome paints them in
the current ink. A brand mark that does not exist in Lucide is drawn from its own SVG
(`provider-icon/glyphs.ts`, `file-icon`). Never add a decorative sparkle, wand, or orb: a glyph that
names nothing is noise in the densest part of the app.

Three rules make the mode safe, and each is enforced rather than reviewed:

- **An author's signal class wins.** `text-error`, `text-success`, `text-warning`, `text-info`,
  `text-meta` (and their `/60`-`/90` weights) on a glyph is a decision; the mode only paints glyphs
  that said nothing. A hue painting over a call site that named a state discards the only colour
  information it had.
- **A solid signal fill owns its icon's foreground.** `bg-error text-canvas` is a filled button, so
  the glyph takes the surface's own foreground; otherwise a trash can renders at 1:1 on its own fill.
  This holds in BOTH icon modes: `monochrome` is the default and it paints every glyph in the palette
  ink, which on that fill is 1.04:1 (measured on `osaka-jade-light`).
- **A filled control uses the `-text` slot, not the raw signal.** `--theme-error` and its family are
  chosen for a chip's ground and measure 2.73:1 (`error` on `mono-light`), 1.94:1 (`info` on
  `aura-light`), 1.75:1 (`success` on `nord-light`) against paper — they fail the 3:1 shape floor on
  7-9 of the 63 palettes, so a button filled with one has no edge. `--theme-<slot>-text` is the same
  hue solved to 4.5:1, and a `text-canvas` glyph on it reads 4.50:1 minimum across all 63. Hover is
  `color-mix(slot-text 88%, ink)`, which keeps 4.71:1 where `hover:opacity-90` drops to 3.77:1.
- **No palette rung, ever.** `text-amber-500` and its family measure 1.6-2.9:1 on light paper, and
  they ignore the theme. Use the signal tokens, which are solved to 4.5:1 minimum on every palette of
  both variants. `src/client/palette-class.test.ts` scans for violations.

---

## 4. Structure

The console has three columns and a rail on each side, and the user can reorder, collapse and
re-purpose all of them. `src/client/components/layout/desktop-layout/` is the composition; the
phone is the same product at one column (`src/client/components/mobile/`).

- **Left:** the session sidebar (folders and rows) plus a dock of plugin views, switched by a
  vertical rail. The sidebar width is per view and remembered.
- **Centre:** the chat timeline, with the composer docked at the bottom, and the editor column
  beside it when a file or diff is open. Panels are resizable, measured in pixels, and their
  widths are remembered per session.
- **Right:** a stack of telemetry and tool panels (context, files, search, source control, wiki,
  terminal, plugins), same rail, same reordering.
- **Chrome:** the desktop's top strip is `--theme-paper`; the phone's header is `--theme-canvas`.
  `src/shared/lib/theme/chrome.ts` owns that rule because two writers (the SSR shell and the client)
  must agree on it.

**Both layouts are one product.** A control added to the desktop belongs to the phone too, unless
the platform genuinely cannot do it, and then the phone says so in words.

---

## 5. Elevation, radius, motion

- **Elevation is rarity.** Panels sit flat on hairline borders. A dialog and a popover lift with
  `--glass-shadow` (or `shadow-lg`/`2xl` in the classic surface); a list row does not. A page where
  everything floats has no ground plane, which is what the density here needs.
- **Radius is a small set**: 4px for chips and rows, 6-8px for controls, 12px for panel cards,
  `--radius` for dialogs. Pill shapes belong to status badges and toggles only.
- **Motion is live state.** The generating dots, a spinner on a running tool call, the refresh
  pulse. Everything else is a 120-200ms colour or width transition. `prefers-reduced-motion`
  stops the ambient animation once, globally (`tailwind.css`): pulses park, spinners breathe
  slowly, nothing is left spinning at full speed for a user who asked it not to.
- **Glass is one surface style, not the default.** `data-surface="glass"` blurs the window plane
  and tints the chrome; the classic surface is opaque. Both ship, both must stay legible: the
  translucent chrome is tinted for contrast, never blurred into illegibility.

---

## 6. Copy

- **One language: English.** UI text, hints, `aria-label`s and `title`s.
- No em dashes in UI text. Use a colon, comma, or parentheses. An en dash (`–`) is the placeholder
  for an absent value, in data cells and timestamps.
- States name their cause and the next action: an empty list says why it is empty, a failed read
  says what failed and offers the retry, a demo run says it is demo data.
- No invented numbers, testimonials, or claims. Where a figure is real, its period is named.
- No marketing vocabulary ("seamless", "powerful", "AI-powered"). Say what the control does.

---

## 7. Accessibility floor

- WCAG AA for all text, on every palette, measured by `ink-scale.test.ts` and
  `tailwind-contrast.test.ts` rather than assumed.
- Every control reachable and operable by keyboard, with a visible focus ring; every dialog has a
  role, an accessible name, Escape, a Tab trap and restores focus to its opener
  (`src/client/hooks/ui/dialog-behaviour.ts`).
- Touch targets are 44px on a coarse pointer (`.tap-target` in `tailwind.css`), without inflating
  the dense desktop geometry.
- Every icon-only control has an `aria-label`; every image has `alt`; every region a landmark. A
  page has one `h1` and no skipped heading levels.
