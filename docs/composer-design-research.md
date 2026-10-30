# Composer design research — desktop & mobile option catalog

Status: **shipped** — the four styles below are selectable in `Chats › Composer`
(`composerStyle` in the `kabmo_settings` blob). §8 is the contract that was
implemented, kept as the reference for the next style.

Purpose: turn "what should the composer look like" into a small set of selectable
styles, each with a desktop and a mobile form, so a setting picks one instead of the
product guessing.

Scope: the chat composer (`src/client/components/workspace/chat-timeline/chat-input/`),
not the BTW panel form, not the New Chat modal (both consume `ChatInput` but own their
size), not the editor.

**How it landed:** `shared/lib/chat/composer/style.ts` (the table, five styles),
`client/hooks/chat/composer/style.ts` (the live writer), `chat-input/ComposerRows.tsx`
+ `chat-input/styles/index.tsx` (the renderer), `chat-settings/ComposerStyleSection.tsx`
(the picker), and the `[data-composer-style]` rules in `src/client/tailwind.css`.

---

## 1. TL;DR

- The market converged on **one architecture**: a calm default surface, capability
  behind one `+` entry, armed scope as dismissible chips, and send as the only strong
  action. Products differ in *what they keep visible at rest*, not in structure.
- Kabmo's current composer is the **densest** end of that spectrum: model, thinking,
  access, plan/goal, voice and send are all permanently on one row, plus a permanent
  attachment row above the draft. That is a deliberate agent-console choice, and it is
  one valid option — not the only one.
- Four styles are drawn, desktop and mobile, in §5.1–§5.4 (each maps onto existing
  modules rather than a rewrite): **classic** (today), **calm** (pill), **console**
  (terminal rail), **stage** (hero on an empty chat, dock after the first send).
- §5.5 is `glass`, which began as a rejected shape and was shipped as an opt-in style;
  §5.6 renders **seven rejected shapes at the same fidelity** — R2–R3 are dropped
  alternatives, R4–R8 are the anti-patterns drawn out, so a rejection can be compared
  instead of taken on trust.
- Hard constraint unique to Kabmo: **access mode and plan/goal are safety contracts,
  not preferences.** A style may hide them behind `+` only if arming one leaves a
  visible, dismissible chip. Otherwise the style is disqualified — the user would send
  a write-capable turn believing it was read-only.
- Recommendation: keep `classic` as the default, ship `calm` second, `console` third,
  `stage` last (it also touches the empty state). Measure first-message completion and
  mode-discovery separately, as the source playbook recommends.

---

## 2. Current composer, measured from the code

Anatomy today (`chat-input/index.tsx`, `AttachmentToolbar.tsx`, `Toolbar.tsx`,
`expansion.ts`):

```
┌────────────────────────────────────────────────────────────┐
│ [attachments / chips]          Plan  Goal  ⤢               │  AttachmentToolbar
├────────────────────────────────────────────────────────────┤
│ Draft textarea (auto-grow, max CHAT_COMPOSER_MAX_LINES)    │  ComposerTextarea
├────────────────────────────────────────────────────────────┤
│ Opus 4.8 ▾ │ high ▾ │ full-auto ▾ │ Plan Goal        🎙  ➤  │  ComposerToolbar
└────────────────────────────────────────────────────────────┘
```

Facts that constrain every option:

- **Two rows are permanent** even with an empty draft; the card is a transcript card
  (`rounded-xl border-ink/10 bg-paper`), not a floating chrome surface.
- **`variant` is desktop/mobile only.** Mobile hosts plan/goal in the top row because
  the bottom row is full (`Toolbar.tsx:136-153`).
- **Mobile already has three states**: docked, compact (textarea removed, "Type here"
  target), and stretched (`fixed inset-0 z-40`, keyboard inset via `useKeyboardInset`).
- **Expansion semantics are a module, not a ternary** (`expansion.ts`): phone takes the
  viewport, desktop grows in place to `38vh`, popup flips over the draft on mobile.
- **Send collapses the stretch only when a send was dispatched** (`onSent`, not the
  click). Any style must preserve that distinction.
- **iOS guard exists**: `composer-type` keeps the control ≥16px so Safari does not zoom
  on focus (`tailwind.css`). A pill style must not reintroduce a smaller font.
- **Plugin slots** (`PluginComposerActions`, `PluginComposerBanners`), goal surfaces,
  mode-error strip, dictation notice and drag overlay are siblings of the rows. A style
  is a re-arrangement of these, never a replacement.
- **`DESIGN.md` is binding**: paper/ink, hairline borders, zero drop shadows, zero
  gradients, chroma reserved for `--theme-error`. "Pill" here means a paper capsule
  with a hairline, not glassmorphism.

---

## 3. What the market converged on (desktop)

Sources: AI UX Playground teardowns of ChatGPT, Claude, Perplexity, Gemini, Grok, Kimi,
plus the composer comparison and build playbook (links in §9).

| Product | At rest | Capability entry | Armed scope | Model / cost | Signature bet |
|---|---|---|---|---|---|
| ChatGPT | Empty bar + starter pills | one `+` (attach, image, think, research, search) | removable chips | outcome labels in `+` | calm default, hide power |
| Claude | Card + starter pills, model + effort **already visible** | `+` for attach/skills/connectors | context chips | model + effort on the bar | cost visible before send |
| Perplexity | Ask bar with **Search / Computer chips in the bar** | `+` for uploads/connectors | file card + source toggles | model picker on bar | mode is the product |
| Gemini | Empty pill, no chips | `+` leads with Drive | attachment preview in pill | Flash nickname on bar | ecosystem pull |
| Grok | Nearly empty canvas | `+` (upload, recent, skills, connectors) | chips | Fast tier on bar | time-to-first-query |
| Kimi | Familiar bar + **seven job pills** | `+` (files, plugins, skills) | slash-invoked chips | Instant/K3/Swarm + effort | task dispatcher, not chat box |
| Cursor | Sidebar composer, inline diffs | `@` context, mode chips | file pills | model picker | composer is where the diff lands |

Five decisions repeat, and they are the only ones that matter for Kabmo:

1. **What is visible at rest** (calm vs cost-visible).
2. **One capability entry or several** (`+` vs bar chips). Two parallel doors with no
   bridge confuse discovery.
3. **Armed scope must be visible** as a chip before send; invisible armed modes are the
   most repeated anti-pattern in every teardown.
4. **Attachments are first-class**: preview inside the card, dismiss per item. Hiding
   attach inside `+` fights the paperclip habit — acceptable only when there is a second
   path (drop, paste).
5. **Send is a state, not a button**: empty → disabled with a reason; armed → primary;
   running → stop (or queue, in Kabmo's case).

Two patterns are specifically relevant to a coding agent:

- **Mode chips that rewrite the surface** (Perplexity Computer, Kimi pills): choosing a
  job changes placeholder, starters and the picker label. Kabmo's Plan/Goal already do
  this partially through `GoalSurfaces`.
- **Keyboard-first invocation** (`/`, `@`): Cursor, Kimi and Claude all keep the pointer
  path *and* a slash path. Kabmo already has both (`ComposerTextarea` picker).

---

## 4. What changes on mobile

Constraints (platform, not taste):

- The soft keyboard does not shrink the layout viewport on mobile browsers; the card must
  be lifted by the measured overlap (`useKeyboardInset`), not by CSS alone.
- Safe-area insets are mandatory top and bottom (`env(safe-area-inset-*)`).
- A control below 16px font makes iOS Safari zoom the page on focus.
- Apple HIG: a hit region of at least **44×44 pt**.
- No hardware Enter: send must always be a visible target, never only a keyboard binding.
- One thumb: primary actions belong bottom-right; destructive/secondary bottom-left.
- Every dialog must stay above a stretched composer (Kabmo uses `z-40` for the card,
  `z-50`–`z-[200]` for dialogs/toasts).

Patterns that ship on phones:

| Pattern | Evidence | What it buys | Cost |
|---|---|---|---|
| Docked sheet with grabber | assistant-ui mobile composer | one-handed, familiar messaging shape | transcript loses height |
| Quick-action row above the input, **hidden when keyboard opens** | assistant-ui mobile composer | teaches jobs without crowding typing | actions disappear exactly when focused |
| Mic only while empty; send replaces it when typing | assistant-ui, Grok | one trailing slot, no icon clutter | mode swap must be legible |
| Send ↔ stop in the same slot | assistant-ui, ChatGPT | run state is one control | queue-vs-stop semantics need a label |
| Tap input → full-screen compose | ChatGPT, Claude mobile, Kabmo today | long prompts are writable | hides the transcript being answered |
| Inline transcription with confirm | Claude | edit before send; no accidental send | competes with attach during dictation |
| Attachment preview inside the card | ChatGPT, Claude, Gemini, Grok | scope is visible before send | multi-file crowding |

Kabmo already implements the strongest mobile behaviours (keyboard lift, compact state,
full-screen stretch, send-collapses-stretch, dictation appends instead of replacing).
A new mobile style is therefore a **different resting shape**, not new plumbing.

---

## 5. Option catalog

Four styles. Each style is one row: a desktop form and a mobile form. One setting picks
the style; the platform picks the form. This keeps "a fact stated once" — the style name
is the fact, the two forms are its rendering.

### 5.1 `classic` — current dock card

Desktop:

```
┌──────────────────────────────────────────────────────────────┐
│ [report.pdf ×]  [img ×]                       Plan  Goal  ⤢  │  AttachmentToolbar
├──────────────────────────────────────────────────────────────┤
│ Draft…                                                       │  ComposerTextarea
├──────────────────────────────────────────────────────────────┤
│ Opus 4.8 ▾ │ high ▾ │ full-auto ▾ │ Plan Goal           🎙 ➤  │  ComposerToolbar
└──────────────────────────────────────────────────────────────┘
```

Mobile — the same card in its three states:

```
DOCKED
┌────────────────────────────────────┐
│ [report.pdf ×]      Plan  Goal  ⤢  │
├────────────────────────────────────┤
│ Draft…                             │
├────────────────────────────────────┤
│ Opus ▾ │ high ▾ │ full-auto  🎙  ➤  │
└────────────────────────────────────┘

COMPACT  (textarea removed, draft kept)
┌────────────────────────────────────┐
│ [report.pdf ×]   Type here…  🎙  ➤  │
└────────────────────────────────────┘

STRETCHED  (fixed inset-0 z-40; keyboard lift measured)
┌────────────────────────────────────┐
│ Draft…                             │
│                                    │
│                                    │
└────────────────────────────────────┘
▲ padding-bottom = keyboardInset (or env(safe-area-inset-bottom))
```

- Visible at rest: everything. On a phone plan/goal move to the top row, because the
  bottom row is already filled by model, thinking, access, voice and send.
- Tradeoff: zero discovery cost, highest visual density; the draft competes with two
  control rows for height.
- Keep when: the composer is treated as an agent console and access/plan state must be
  readable at a glance. This is the honest default for Kabmo today.
- Cost to ship: none.

### 5.2 `calm` — pill + armed chips

Desktop:

```
┌──────────────────────────────────────────────────────────────┐
│ [+]  Ask, @ files, / commands…                  Opus ▾  🎙 ➤  │
└──────────────────────────────────────────────────────────────┘

  [Plan] [Goal] [full-auto]   ← armed scope: dismissible, only when set
  [report.pdf ×]              ← attachment chip: only when attached
```

Mobile (capsule):

```
  [Fix tests] [Explain] [Summarize]   ← hidden while the keyboard is up
┌────────────────────────────────────┐
│ + │ Message                  🎙  ➤  │
└────────────────────────────────────┘
                   ▬ grabber
  tap the capsule → the existing full-screen stretch
```

- At rest: draft + model + voice + send. Nothing else.
- `+` opens: attach, plan, goal, access, thinking, plugins (one list, grouped by intent).
- Arming anything appends a chip **above** the pill; the chip is the contract. Access
  mode is never hidden without a chip (safety invariant).
- Tap the pill on mobile → the existing full-screen stretch. Keyboard-up hides the quick
  actions row (assistant-ui pattern).
- Tradeoff: two doors (`+` and chips) must share one mental model; access mode is one tap
  further away than today.
- Keep when: first-message calm matters and the user already knows the modes. This is the
  ChatGPT/Gemini shape, restyled in paper + hairline (no glass, no gradient).

### 5.3 `console` — terminal rail

Desktop:

```
 omp ›  ┌──────────────────────────────────────────────────────┐
        │ draft…                                               │
        │                                                      │
        └──────────────────────────────────────────────────────┘
        plan:off  goal:off  access:full-auto  opus-4.8  think:high   ⌘↵ send
        ↑ prompt glyph, mono status rail — the rail is controls, not output
```

Mobile (focus) — tapping the composer opens a full-screen compose surface with the same
status rail pinned above the keyboard; no docked textarea:

```
  ┌──────────────────────────────────┐
  │ plan:off  goal:off  full-auto    │
  ├──────────────────────────────────┤
  │ draft…                           │
  │                                  │
  └──────────────────────────────────┘
     ⌘↵ = return to send
```

- At rest: a prompt glyph, a multiline box (min 3 lines), and a **mono status rail** that
  reads like telemetry. Model/thinking/access are text, not pills.
- Uses IBM Plex Mono and tabular numerals per `DESIGN.md` §2.
- Tradeoff: excellent for long prompts and power users; the least discoverable surface
  for a newcomer, and the rail can be mistaken for output rather than controls.
- Keep when: Kabmo leans into "diagnostic workbench". This is the only style that makes
  the composer look like the rest of the telemetry UI.

### 5.4 `stage` — hero on empty chat, dock after the first send

Desktop, empty session:

```
              ┌──────────────────────────────────────────────┐
              │ Ask omp anything…                      send  │
              └──────────────────────────────────────────────┘

      [Plan] [Goal]     [@ files]  [/ commands]

      fix a failing test · review this diff · summarize session
```

After the first send: falls back to `classic` (or `calm`, per setting).

Mobile: capsule at the bottom of the empty state; the first send docks the sheet.

```
        ┌──────────────────────────────┐
        │ Ask omp anything…       send │
        └──────────────────────────────┘

   [Plan] [Goal] [@ files]
   fix a failing test · review…
```

- Tradeoff: strong first-run teaching (Perplexity/Grok/Kimi bet), but two composer
  personalities to maintain, and the empty state already has
  `EmptyWorkspacePrompt` copy to coordinate with.
- Keep when: onboarding and first-message rate are the metric. Highest implementation
  cost of the four; it is a *state* of the composer plus an empty-state redesign.

### 5.5 `glass` — translucent capsule

This one was **R1 in §5.6, rejected on principle, then requested and shipped as an
opt-in style.** It is a SURFACE, not an order: the rows are `classic`'s, and only the
frame changes.

Desktop (docked):

```
  ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒
  ╭──────────────────────────────────────────────────────────╮
  │ Ask, @ files, / commands…                  [mic]  [send] │
  ╰──────────────────────────────────────────────────────────╯
  ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒
  ↑ frosted paper: 58% of --theme-paper, 16px blur, ink sheen
```

Mobile (stretched — the state the effect exists for):

```
  ┌────────────────────────────────────┐  ← the transcript is
  │  transcript, blurred behind        │    visible THROUGH the
  │  the capsule                       │    card, at 58% + 16px
  ├────────────────────────────────────┤
  │ draft…                             │
  ├────────────────────────────────────┤
  │ Opus ▾ │ high ▾ │ auto     🎙  ➤  │
  └────────────────────────────────────┘
```

- **Token-based, deliberately.** No hex, no chroma: `--theme-paper` at 58%,
  `--theme-ink` at 3–5% for the sheen, so every palette in the catalog moves it too.
  The original render's coloured glow behind send is **not** reproduced — chroma is
  reserved for `--theme-error` (`DESIGN.md` §1), and a style is not a licence to break
  the palette.
- **The blur has a subject only when stretched.** Docked, the card sits in normal flow
  below the transcript, over the canvas, so it reads as frosted paper; stretched
  (`fixed inset-0` on a phone) it covers the transcript and blurs it for real. Said
  plainly rather than pretending the docked state is a glass window.
- **Fallback**: a browser without `backdrop-filter` gets an OPAQUE paper card
  (`@supports not …`), because 58% paper over the transcript is illegible.
- Tradeoff: it is the one style that departs from the paper identity in `DESIGN.md`
  §4 (flat, opaque, zero gradients). That is the reason it is a choice and not the
  default.
- Keep when: the user wants the composer to recede into the conversation. It is the
  most decorative of the five and the least "workbench".

### 5.6 Rejected — rendered

A rejection argued in prose is only a preference. Rendered at the same fidelity as
§5.1–§5.4, each can be compared against the four options instead of taken on trust.

**R1 (`glass`) is no longer here** — it was requested and now ships as §5.5. Its render
stays in this list as the record of what it looks like, marked SHIPPED, because the
rejection's reasoning (palette deviation) is still the reason it is not the default.

Two groups:

- **R1–R3** are alternative shapes — whole composers that were considered and dropped.
  R1 came back as a setting.
- **R4–R8** are anti-patterns drawn as a composer, so the cost is visible rather than
  asserted. R4, R5, R6 and R8 are §9's own items; R7 is a layout mistake rather than a
  menu mistake (it is the desktop half of the expansion rule).

Each render is desktop first, then the phone form where the two differ — most of these
fail on the phone *first* and only then on the desktop. Box widths are computed, not
typed: every row in a frame is the same display width (wide glyphs counted double), so
the borders line up in a monospace viewer.

#### R1 `glass` — translucent capsule (SHIPPED as §5.5)

Desktop:

```
  ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒
  ╭────────────────────────────────────────────────────────╮
  │ Ask, @ files, / commands…               [mic]  [send]  │
  ╰────────────────────────────────────────────────────────╯
  ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒
```

Mobile:

```
     ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒
     ╭────────────────────────────────╮
     │ Message          [mic] [send]  │
     ╰────────────────────────────────╯
     ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒
```

- Breaks: `DESIGN.md` §1 (chroma is reserved for `--theme-error`), §4 (zero gradients),
  and the hairline-border identity. On a light paper canvas the translucent treatment
  loses the card edge that separates the composer from the transcript — the capsule and
  the message behind it read as one surface.
- Honest caveat: `DESIGN.md` §4 also claims "zero drop shadows", but the shipped composer
  already uses `shadow-sm` docked and `shadow-md` stretched (`expansion.ts:109`, `:160`).
  So this rejection rests on **gradients, translucency and chroma**, not on shadows — the
  shadow rule is already uneven in the code and must not be cited as if it were enforced.
- Verdict: **shipped anyway, as an opt-in style, with the palette deviation kept out.**
  It is the opposite of the product's default visual identity, which is exactly why it
  is a choice and not the default. What shipped uses `--theme-paper` at 58% and an
  ink-only sheen — no chroma, so the one thing this rejection was right about is the
  one thing the implementation does not do.

#### R2 `bar-modes` — mode chips are the only path (Perplexity shape)

Desktop:

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Draft…                                                                   │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ Search  Computer  Plan  Goal  Auto  Full  Opus 4.8  high      mic  send  │
  └──────────────────────────────────────────────────────────────────────────┘
```

Mobile:

```
  ┌──────────────────────────────────┐
  │ Draft…                           │
  ├──────────────────────────────────┤
  │ [Search][Computer][Plan][Go      │
  └──────────────────────────────────┘
```

- Breaks: §6.10 (one fact, one module — the row becomes a second settings surface) and
  the weight rule: plan/access are free and local, model/thinking cost money and time.
  Rendering all eight at one weight teaches the user that they are the same kind of
  choice.
- Note this is *close to what `classic` already does* in its bottom row. The difference is
  that `classic` keeps the two exclusive contracts visible and pushes the rest into
  dropdowns; R2 puts everything on the bar at once. Rendering it is the argument for
  `calm`, not against `classic`.
- Verdict: reject as a style. It is the density ceiling, not a design — and on the phone
  it pushes send off-screen, which is the one control that must never be optional.

#### R3 `plus-attach` — attach only inside `+` (ChatGPT / Gemini shape)

Desktop:

```
  ┌──────────────────────────────────────────────────────────┐
  │ +   Ask anything…                         [mic]  [send]  │
  └──────────────────────────────────────────────────────────┘

          │
          └─► +  →  "Upload files"  →  OS file picker      (3 taps)
```

Mobile:

```
  ┌──────────────────────────────────┐
  │ +   Message       [mic]  [send]  │
  └──────────────────────────────────┘
```

- Breaks: the paperclip habit — attach is the most common non-text intent, and on a phone
  `+` sits in the least reachable corner while the OS picker replaces the draft it just
  interrupted.
- Verdict: reject. Keep a direct attach control in every style; `+` may *also* list
  attach, but it must never be the only door. Kabmo's drop and paste paths do not rescue
  it: neither is discoverable from a blank phone screen.

#### R4 `promise-starters` — starter pills that promise jobs the product cannot do

Desktop, empty session:

```
  ┌──────────────────────────────────────────────────────────┐
  │ Ask omp anything…                                   send │
  └──────────────────────────────────────────────────────────┘

  [Deploy to prod]    [Fix flaky test]    [Rotate secrets]
   no such command       real skill        no such command
  ^^^^^^^^^^^^^^^^    ^^^^^^^^^^^^^^^^    ^^^^^^^^^^^^^^^^
```

Mobile:

```
  ┌──────────────────────────────────┐
  │ Ask omp anything…           send │
  └──────────────────────────────────┘

   [Deploy to prod] [Fix flaky test] [Rot…]
```

- Breaks: §9 anti-pattern and the send contract (§6.1) — a pill is a promise that a
  message will do the job. Two of the three here cannot be kept, and the failure arrives
  after the user has committed to the turn.
- Verdict: reject. `stage` must draw starters from real commands and skills only — the
  same source `ComposerTextarea`'s picker already reads.

#### R5 `two-doors` — `+` and starter row as parallel discovery with no bridge

Desktop:

```
  ┌──────────────────────────────────────────────────┐
  │ Ask omp anything…                           send │
  └──────────────────────────────────────────────────┘

  [+]  Plan  Goal                           ← door A: capability
  [Fix a test]  [Review diff]               ← door B: jobs
        ^ nothing in B appears in A; A's words never appear in B
```

Mobile: door A collapses into a hidden `+`, door B stays visible — so the phone teaches a
vocabulary the desktop does not, and the two layouts describe different products.

- Breaks: one mental model. The user learns two names for one action and cannot tell
  whether `Plan` in A and "Review diff" in B are the same kind of choice.
- Verdict: reject. Pick one door; the other may exist only as a shortcut into the *same*
  list. Kimi's `/` palette is the acceptable version: same catalog, second entry point.

#### R6 `slash-only` — capability reachable only by typing `/`

Desktop:

```
  ┌──────────────────────────────────────────────────────────┐
  │ Type / to attach, plan, or pick a model…                 │
  └──────────────────────────────────────────────────────────┘
```

Mobile:

```
  ┌──────────────────────────────────┐
  │ Type / to attach, plan, or…      │
  └──────────────────────────────────┘
```

- Breaks: §6.1/§6.2 — nothing states scope before send, and a user who never types `/`
  never learns the composer has a model choice at all. Apple HIG and the source playbook
  both treat discovery as a visible affordance, not learned syntax.
- Verdict: reject as the only path. Kabmo already has both paths (the picker *and* the
  visible controls); keep the pointer path primary and `/` as the accelerator.

#### R7 `fullscreen-desktop` — the stretched composer IS the composer on desktop

Desktop:

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ transcript: the answer this prompt is replying to                        │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ ██████ COMPOSER ██████  Draft…                                           │
  │ ██████ the draft takes the viewport ██████                               │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ transcript: covered                                                      │
  └──────────────────────────────────────────────────────────────────────────┘
```

Mobile: this is exactly the shipped `expanded` state — and there it is correct, because
the phone has no room for both surfaces.

- Breaks: on desktop the chat sits in a column *beside* the editor and right panel, so
  covering it removes the thing the prompt is written against. This is why
  `expansion.ts` makes desktop grow **in place** to `38vh` instead of taking the viewport.
- Verdict: reject on desktop, keep on mobile. The asymmetry is already the shipped rule;
  this render exists to show why it must not be "unified" into one behaviour.

#### R8 `flat-menu` — rows carry no cost or latency cue

Rendered against the **actual** row (`model-dropdown/Item.tsx:131-156`), which already
draws a fixed context column and a thinking pill:

Desktop:

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ Opus 4.8    kenari    200k   high  ✓  ☆                          │
  │ Sonnet 4.7  kenari    200k   med      ☆                          │
  │ Haiku 4.5   kenari    200k            ☆                          │
  │ omp-fast-1m local       1m            ☆                          │
  └──────────────────────────────────────────────────────────────────┘
```

Mobile:

```
  ┌──────────────────────────────────┐
  │ Opus 4.8     200k  high ✓ ☆      │
  │ Sonnet 4.7   200k  med    ☆      │
  │ omp-fast-1m    1m         ☆      │
  └──────────────────────────────────┘
```

- Breaks: §9 (equal weight when cost/latency differ), in the narrow form that survives
  the current picker: a metered provider, a local model and a native one are
  interchangeable at a glance. Context window is a memory measurement, not the thing that
  changes the bill.
- Verdict: reject as a style; fix as a picker change. Add an outcome or cost cue per row
  (fast / balanced / deep, or a mono price column) — independent of which composer style
  ships, because every style opens this same list.
- Side finding while reading that row (not a composer-style issue): the favourite star is
  `text-sky-400` (`Item.tsx:164,168`, and `Section.tsx:64`), chroma outside the palette
  and outside the `--theme-error` exception `DESIGN.md` §1 grants. Same class of defect as
  R1 — and the reason "we never use chroma" cannot currently be argued from the code.

---

## 6. Invariants every style must satisfy

These are not style choices; a style that breaks one is a bug.

1. **Send contract**: disabled with a reason when nothing is sendable; primary when it is;
   stop/queue while running; a refused send leaves the draft and the stretched layout
   untouched.
2. **Scope before send**: plan, goal and access are visible whenever armed. Access mode is
   a safety contract (read-only vs write/execute) and may never be implicit.
3. **Attachment preview**: name (or thumbnail) + per-item dismiss, inside the card.
4. **Keyboard lift** on mobile is measured (`useKeyboardInset`), not assumed; safe-area
   insets applied top and bottom.
5. **iOS type floor**: the editable control stays ≥16px (`composer-type`).
6. **44×44 pt** hit regions on touch, regardless of visual size.
7. **Expansion semantics** stay in one module: phone = viewport, desktop = in place,
   popup flips over the draft on mobile, Escape exits, a dispatched send collapses.
8. **Plugin slots, goal banner, mode-error strip, dictation notice, drag overlay** remain
   reachable in every style (they are siblings, not children of a row).
9. **Dialogs stay above** a stretched composer (`z-40` card, dialogs `z-50`+).
10. **One fact, one module**: the style table owns which rows exist; components do not
    re-derive it.

---

## 7. Recommendation and rollout

All four shipped at once as **one setting with four values** — not four releases, and
not two independent settings. A per-platform override (`composerStyleMobile`) is
deliberately absent: two settings for one decision is how the chat-width bug class
starts, and nothing measured so far argues for it.

| Style | Why it exists | Main risk | How it was verified |
|---|---|---|---|
| `classic` | the shipped card, and the default | density; height lost to two control rows | baseline: 12px radius, 68/80px draft floor |
| `calm` | the market's default direction (ChatGPT/Gemini shape) | the draft leads, so the attachment row sits lower | order asserted in a unit test; 16px radius measured |
| `console` | differentiates Kabmo as a workbench; reuses the mono tokens | discoverability; the rail can read as output | `Fira Code` 12.5px and the `omp ›` glyph measured; rail is `aria-hidden` |
| `stage` | strongest first-run teaching | two composer personalities, and it touches the empty state | `hero` fires only on an empty chat: 132px draft floor measured at both widths |
| `glass` | the composer recedes into the conversation | the one style that leaves the paper identity; the blur only has a subject when stretched | 58% `--theme-paper`, `blur(16px) saturate(1.15)`, 20px radius, 0px when stretched — all measured |

Still unmeasured, and the reason the setting exists rather than a switch: whether `calm`
actually improves first-message completion for a diagnostic workbench, or whether it
hides the access mode that makes Kabmo trustworthy. That is a product measurement, not a
code one.

---

## 8. How it became an option (as shipped)

- **Domain module** `src/shared/lib/chat/composer/style.ts` —
  `COMPOSER_STYLES = ['classic','calm','console','stage']`, copy per style, default
  `classic`, and a pure `composerStyleLayout({ style, hero })` that returns the ROW
  ORDER plus the two CSS attributes. It states order and structure only; the single
  owner of the decision, the analogue of `width-mode.ts` for chat width.
- **Settings**: `composerStyle` on `SettingsState` and in `DEFAULT_SETTINGS`; persisted
  through the `kabmo_settings` blob like `sidebarStyle` — never a raw top-level key.
- **Live apply**: `client/hooks/chat/composer/style.ts` (`useComposerStyle`,
  `applyComposerStyle`) and one branch in `settings/apply-side-effects.ts`, so the
  composer behind the modal redraws on click. Primed from the boot snapshot, so the
  first render already has the stored style.
- **Settings UI**: `chat-settings/ComposerStyleSection.tsx` — four `aria-pressed` cards
  whose miniature is drawn FROM `composerStyleLayout().wire`, so a style whose order
  changes cannot leave its picture behind. Placed second in `ChatSettings`, after width.
- **Rendering**: `chat-input/ComposerRows.tsx` builds all five rows unconditionally;
  `chat-input/styles/index.tsx` (`ComposerFrame`) loops over the table's `rows`. One
  frame component, not four: the difference between styles is data, and four frames is
  four places a control can go missing.
- **CSS**: `[data-composer-style]` / `[data-composer-hero]` rules in
  `src/client/tailwind.css`, with `.composer-draft` / `.composer-attach-row` /
  `.composer-toolbar-row` hooks on the rows. **Not classes on the card** — see the
  measurement below.
- **Size discipline**: `index.tsx` 316 lines, `ComposerRows.tsx` 178, `style.ts` 160,
  `styles/index.tsx` 101, `ComposerStyleSection.tsx` 163. All under 350.
- **Tests**: `shared/lib/chat/composer/style.test.ts` (table: every style renders every
  row exactly once, draft above toolbar, notice adjacent to draft, console alone gets
  the rail/glyph, `stage` alone reacts to `hero`); `chat-input/styles.test.tsx` (mounts
  the real composer per style and asserts the paperclip, stretch, Plan, Goal, access,
  send and the draft are all present, plus the row order and the glyph).
- **Smoke**: 1440×900 and 390×844, all four styles — empty chat, open session, `@`
  picker (35 items), typed draft with Send enabled, stretched phone card `fixed inset-0
  z-40` at 390×844, and a settings click re-attributing the live card without a reload.

### The measurement that changed the design

The first implementation put the style's pixels in `composerStyleLayout` as Tailwind
classes (`cardClass: 'rounded-md'`, `textareaClass: 'font-mono … min-h-[132px]'`).
Measured in the browser on `console`: the card rendered **12px** — `rounded-xl` from
`expansion.ts` — because Tailwind resolves two utilities of the same property by the
order it EMITTED the rules, not by the order they appear in `className`. `min-h` and
`font-size` lost the same way. This is the trap `cardPositionClass` already exists for
(position utilities are ordered `static, fixed, absolute, relative, sticky`).

So the table stopped carrying pixels: it carries two attributes, and the pixels are
plain unlayered CSS. Verified after the change: `console` → 6px, `calm` → 16px,
`stage` hero → 132px draft floor, `console` draft in `Fira Code` at 12.5px.

---

## 9. Anti-patterns to refuse (from the sources)

Each of these has a rendered composer in §5.6 — the parenthesised id is the render.

- A wall of mode chips before the first send. (**R2**)
- Armed modes with no chip in the bar. (**R1**, **R2**)
- Attach hidden with no second path (drop/paste counts only if it is taught). (**R3**)
- Mode rows with equal visual weight when cost/latency differ. (**R8**)
- Starter pills promising jobs the product cannot do. (**R4**)
- Disabled send with no explanation.
- Two parallel discovery doors (`+` and starters/pills) with no bridge. (**R5**)
- Two voice entry points that look identical.
- Hiding model/effort when the choice changes spend or wait. (**R6**, **R8**)
- A desktop composer that covers the transcript it is answering. (**R7**)

---

## 10. Open questions

1. Does `calm` measurably reduce time-to-first-message for a *diagnostic workbench*, or
   does it hide the access mode that makes Kabmo trustworthy?
2. Is `console` a style, or should it be the editor-side composer only?
3. Does `stage` belong to the composer at all, or to `EmptyWorkspacePrompt`?
4. Should the armed-scope chip row scroll horizontally or wrap on a phone with three
   attachments plus plan/goal? (Current attachment row is the pressure point.)

---

## 11. Sources

- AI UX Playground — [How to Design AI Chat Composer UX](https://aiuxplayground.com/guides/how-to-design-ai-chat-composer)
- AI UX Playground — [Composer UX compared: ChatGPT, Claude, Perplexity, Gemini](https://aiuxplayground.com/teardowns/compare/design-the-composer)
- AI UX Playground — [ChatGPT composer](https://aiuxplayground.com/teardowns/chatgpt/composer), [Claude composer](https://aiuxplayground.com/teardowns/claude/composer), [Perplexity composer](https://aiuxplayground.com/teardowns/perplexity/composer), [Gemini composer](https://aiuxplayground.com/teardowns/gemini/composer), [Grok composer](https://aiuxplayground.com/teardowns/grok/composer), [Kimi composer](https://aiuxplayground.com/teardowns/kimi/composer)
- AI UX Playground — [Slash Commands](https://www.aiuxplayground.com/pattern/slash-command)
- assistant-ui — [Mobile composer](https://www.assistant-ui.com/elements/mobile-composer)
- Apple HIG — [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Buttons (44×44 pt hit region)](https://developer.apple.com/design/human-interface-guidelines/buttons)
- CSS-Tricks — [16px or larger text prevents iOS form zoom](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom)
- Cursor — [New Composer UI](https://cursor.com/changelog/0-43-x)
- Repo: `DESIGN.md`, `src/client/components/workspace/chat-timeline/chat-input/*`,
  `src/client/components/mobile/MainView.tsx`, `.wiki/App-Shell-and-Layout.md`
