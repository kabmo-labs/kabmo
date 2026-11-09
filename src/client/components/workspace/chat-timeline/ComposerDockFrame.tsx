import type { ComponentChildren } from 'preact';

interface ComposerDockFrameProps {
  isMobile: boolean;
  children: ComponentChildren;
}

/**
 * The dock's frame: the padding, the chat-column width and the phone's
 * safe-area inset every "rows above the composer" stack shares.
 *
 * It exists because that dock is drawn in two places — the real timeline
 * (`ComposerDock`) and the pending `new-…` chat, whose composer lives in
 * `EmptyWorkspacePrompt` until the spawn adopts it. Spelled out separately, the
 * two drifted: the pending view kept the landing page's `p-8` and its
 * `space-y-3` stack, while the dock used `p-4 pt-1` with the rows flush. The
 * generating indicator therefore sat **28px higher** while the spawn was in
 * flight (`Loading…`, 141px above the pane's bottom) than once the run streamed
 * (`Thinking…`, 113px) — the row jumped at the moment the chat was adopted, and
 * the jump read as two different indicators.
 *
 * The `relative` belongs here: it keeps the queue/indicator stack anchored
 * above the input while the side-question form takes the composer's place.
 */
export function ComposerDockFrame({ isMobile, children }: ComposerDockFrameProps) {
  return (
    <div
      data-composer-dock=""
      className={`border-t-0 bg-transparent flex-shrink-0 ${isMobile ? 'px-3 pt-1' : 'p-4 pt-1'}`}
      style={isMobile ? { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' } : undefined}
    >
      <div className="chat-column relative">{children}</div>
    </div>
  );
}
