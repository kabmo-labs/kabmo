/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness tab strip inside the model dropdown.
 *
 * A TAB, not a second control row: the composer's toolbar is full (model,
 * thinking, access, plan, goal, voice, send) and the harness changes WHAT THE
 * LIST IS, which is what a tab means. `Header.tsx` sits under it because the
 * search field then applies to whichever list the tab selected.
 *
 * Four rules the markup encodes:
 *
 *  - a harness that cannot run here is DISABLED, never hidden — hiding is what
 *    makes "why is Claude not there" unanswerable;
 *  - the reason is the agent's own words, in `title`, so the hover explains
 *    `mcode login` or `executable not found (command: pi)`;
 *  - the active tab is read-only for a live chat. Harness is a SPAWN property,
 *    so switching it must start a new session — the row says so instead of
 *    silently changing the frame source under a running transcript;
 *  - a tab is the MARK ONLY. Three to five tabs share one strip, and their names
 *    (`claude`, `deepseek-harness`, `omp (ACP)`) are longer than the marks they
 *    sit beside, so the strip spent its width on words for the same agent the
 *    logo already names. With the label gone the mark is the accessible name:
 *    `aria-label` carries the harness's own label, and `title` still carries the
 *    reason a tab is unavailable.
 */

import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { harnessBadgeLabel } from '@/shared/lib/harness/catalog';
import type { HarnessSummary } from '@/shared/types/harness';

interface HarnessTabsProps {
  harnesses: HarnessSummary[];
  /** The session's harness, or null for a chat that has not spawned yet. */
  active: string | null;
  /** False while a chat has messages: the choice would change the transcript's
   *  owner, which no frame source can do retroactively. */
  editable: boolean;
  onSelect: (harness: string) => void;
  /** Opens the settings page for a harness that needs install or login. */
  onFix?: (harness: string) => void;
}

export interface HarnessBlock {
  /** The agent's own words, or a plain statement that it is missing. */
  reason: string;
  /**
   * The command that would actually fix it, or null.
   *
   * ONLY for a harness that never launched. A PROBE refusal means the binary
   * DID run and answered — measured in the running picker, `codex` was blocked
   * with "Authentication required" and the tab offered
   * `npm i -g @agentclientprotocol/codex-acp`, i.e. told the user to install a
   * program that had just replied. The fix in that case is the agent's own
   * sentence (`Run \`codex login\``), never an install hint.
   */
  fix: string | null;
}

/** What stops a harness running here, and the command that would unblock it. */
export function harnessBlock(summary: HarnessSummary): HarnessBlock | null {
  // A BUILT-IN transport is never blocked, whatever else the row says. `omp`
  // over RPC is the path this app IS: it has no agent to spawn and no launch
  // command, so a probe of it can only report "no launch command is configured"
  // — and that record used to paint a ⚠ over the DEFAULT tab and DISABLE it, so
  // the harness every session actually runs on could not be selected (measured).
  if (summary.builtIn) return null;
  if (!summary.canLaunch) {
    return { reason: summary.unavailable ?? 'Not installed', fix: summary.install ?? null };
  }
  const blocked = summary.probe?.capabilities.blocked;
  return blocked ? { reason: blocked, fix: null } : null;
}

/** Why a tab cannot be picked, in the agent's own words, or null when it can. */
export function harnessBlockedReason(summary: HarnessSummary): string | null {
  return harnessBlock(summary)?.reason ?? null;
}

export interface HarnessTabState {
  /** What stops the harness running here, or null. */
  block: HarnessBlock | null;
  /** False once the chat owns a transcript: the harness is a SPAWN property. */
  editable: boolean;
  /** The harness the open chat is (or will be) running on. */
  active: string | null;
}

/**
 * The one sentence a tab says when the pointer rests on it.
 *
 * A reason, not a restatement of the name: the mark IS the name now, so a
 * tooltip that only echoed the label would spend the one available sentence
 * answering a question the icon already answered. Four cases, in this order —
 * and the order is the contract, because a tab can be both unusable and the
 * agent already running the chat, and the FIRST fact is the one that stops the
 * press:
 *
 *  1. **cannot run here** → the agent's own words (`Authentication required:
 *     Run \`codex login\``), plus an install command ONLY when the binary never
 *     launched (see `HarnessBlock.fix`);
 *  2. **the chat is already owned by an agent** → name the agent it started on.
 *     "Start a new chat to use claude" was measured to be answerable but not
 *     informative: it never said WHICH agent the open chat had already picked,
 *     so the user could not tell whether they were looking at a lock or at a
 *     mistake of their own;
 *  3. the tab IS that agent → say so, instead of offering it as an alternative
 *     to itself;
 *  4. otherwise the probe's identity (`claude · 2.0.1`), which is the question a
 *     pointer rests on an available tab to ask.
 */
export function harnessTabTitle(summary: HarnessSummary, state: HarnessTabState): string {
  if (state.block) {
    return `${summary.label}: ${state.block.reason}${state.block.fix ? ` — install: ${state.block.fix}` : ''}`;
  }
  if (!state.editable) {
    const owner = state.active ? harnessBadgeLabel(state.active) : null;
    if (summary.id === state.active) {
      return `${summary.label} is the agent this chat already started on. Start a new chat to use another one.`;
    }
    if (owner) {
      return `Cannot switch to ${summary.label}: this chat already started on ${owner}. Start a new chat to use ${summary.label}.`;
    }
    return `Start a new chat to use ${summary.label}`;
  }
  if (summary.probe) {
    const build = `${summary.probe.capabilities.agentName ?? ''} ${summary.probe.capabilities.agentVersion ?? ''}`.trim();
    if (build) return `${summary.label} · ${build}`;
  }
  return summary.label;
}

/**
 * Whether `harnessTabTitle` said something BEYOND the tab's own name.
 *
 * Only an extra sentence belongs in `aria-description`/`title`: a tab whose title
 * is just its label (an unprobed but usable harness) already carries that word as
 * its accessible name, and repeating it makes a screen reader say "claude,
 * claude, tab".
 */
export function harnessTabReason(summary: HarnessSummary, state: HarnessTabState, title: string): string | null {
  if (state.block || !state.editable) return title;
  return title === summary.label ? null : title;
}

/**
 * The tone a tab paints: which one is current, and what a press would do.
 *
 * Three cursor states, each earned:
 *
 *  - **blocked → `pointer`** — pressing opens THAT agent's settings page, which
 *    is where a login or an install is fixed.
 *  - **locked → `not-allowed`** — the chat already runs on another agent, so a
 *    press cannot switch anything. This is the state a user meets most often
 *    (every tab but one, once a chat has a transcript), and the prohibition sign
 *    is the only affordance that says "not here" before the click.
 *  - **selectable → `pointer`** — it really does select.
 *
 * The ACTIVE tab of a locked chat keeps `default`: it is the current selection,
 * not a refused one. `cursor-help` (an earlier value) is drawn on macOS as a
 * question mark, which read as a stray icon over an icon-only tab.
 */
function tabTone(isActive: boolean, blocked: boolean, editable: boolean): string {
  const cursor = blocked
    ? 'cursor-pointer'
    : !editable
      ? isActive ? 'cursor-default' : 'cursor-not-allowed'
      : 'cursor-pointer';
  if (isActive) return `bg-paper text-ink shadow-[inset_0_-2px_0_0_currentColor] ${cursor}`;
  if (blocked || !editable) return `text-ink/35 ${cursor}`;
  return `text-ink/65 hover:bg-ink/5 hover:text-ink ${cursor}`;
}

export function HarnessTabs({ harnesses, active, editable, onSelect, onFix }: HarnessTabsProps) {
  if (harnesses.length === 0) return null;
  return (
    <div
      // `flex-none` is load-bearing: the panel is a flex COLUMN with a measured
      // max height, so without it this strip was the first child to shrink and
      // collapsed to 5px — the tabs were in the DOM and painted 1px tall
      // (measured: `elementFromPoint` on the first tab answered the row BELOW
      // it). The list scrolls inside itself; the strip must not.
      className="flex-none flex items-stretch gap-0.5 overflow-x-auto border-b border-ink/10 bg-canvas/40 px-1 pt-1 scrollbar-overlay-container"
      role="tablist"
      aria-label="Harness"
      // The one surface where a harness HUE is not decoration: with no label in
      // the tab, colour is the only thing separating `omp` (RPC) from `omp`
      // (ACP), so `icon-paint-css.ts` keeps these two marks painted even in
      // monochrome mode. The attribute is that rule's scope.
      data-harness-tabs=""
    >
      {harnesses.map((summary) => {
        const state: HarnessTabState = {
          block: harnessBlock(summary),
          editable,
          active,
        };
        const { block } = state;
        const isActive = summary.id === active;
        // NOT the native `disabled`. Measured in Chromium: a `<button disabled>`
        // never shows its `title` (so the reason was unreachable — the one thing
        // a blocked tab exists to explain), and a press on it never reaches
        // `onClick` (so `onFix` — "open the settings that fix this" — could not
        // fire either; measured, `elementFromPoint` on the tab answered the tab
        // itself and the handler ran 0 times).
        //
        // `aria-disabled` states the same thing to assistive tech without
        // removing the element from the pointer. Every unusable tab therefore
        // stays pressable and pressing it either explains itself (a transcript
        // already owns this chat) or opens the fix.
        const unusable = Boolean(block) || !editable;
        // One sentence, used by BOTH the pointer and assistive tech — so the two
        // can never say different things about the same tab.
        const title = harnessTabTitle(summary, state);
        const reason = harnessTabReason(summary, state, title);
        return (
          <button
            key={summary.id}
            type="button"
            role="tab"
            // The NAME, because the mark is now the whole control: a `<button>`
            // whose only child is a decorative svg would be announced with no
            // name at all.
            aria-label={summary.label}
            aria-selected={isActive}
            aria-disabled={unusable}
            // The same sentence for the keyboard/assistive path. `title` is a
            // POINTER affordance (and, on a `disabled` element, none at all —
            // the measured reason this tab stopped using it); an `aria-disabled`
            // tab is still focusable, so a screen reader would otherwise hear
            // "claude, tab, dimmed" with no reason attached. The NAME stays the
            // label: a reason in the name would make the tab unaddressable by
            // the word the user is thinking of.
            aria-description={reason ?? undefined}
            title={title}
            onClick={() => {
              if (block) {
                onFix?.(summary.id);
                return;
              }
              if (!editable) return;
              onSelect(summary.id);
            }}
            // `relative` for the ⚠ badge, `p-1.5` so the strip stays compact at
            // the larger mark: the label that used to supply the tab's width and
            // its lead-in is gone, so the padding is the whole frame. `tap-chip`
            // still raises it to 44px on a coarse pointer, which is what keeps an
            // icon-only tab pressable on a phone.
            className={`tap-chip relative flex shrink-0 items-center justify-center rounded-t p-1.5 transition-colors ${tabTone(isActive, Boolean(block), editable)}`}
          >
            {/* `inherit`, because the button's colour is now the only thing that
                says active / muted: the mark used to be one of two children and
                its own `text-ink/55` was the default it shared with every row.
                A BLOCKED harness is additionally dimmed by OPACITY rather than
                by a colour, so the signal survives the colour mode — there the
                paint rule sets a brand hue that no `text-ink/35` can outrank,
                and an unavailable agent would have looked exactly as ready as
                the one beside it. Non-editable-but-runnable tabs stay at full
                strength: the agent is available, this chat is not the place,
                and `title` is what says so.

                `decorative` is load-bearing: the component's own
                `title="Session runs on claude"` sits INSIDE this button, and a
                nested `title` is the one the browser shows — measured, hovering
                a locked tab announced the generic sentence and never the
                explanation one level up. */}
            <HarnessGlyph
              harness={summary.id}
              size={HARNESS_GLYPH_SIZE.tab}
              inherit
              decorative
              className={block ? 'opacity-40' : ''}
            />
            {block && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 text-[9px] leading-none text-ink/40"
              >
                ⚠
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
