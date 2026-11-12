/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A peer (IRC) message that ended or interrupted a turn.
 *
 * omp 18.18.9 injects such a message as its own `irc:incoming` turn instead of
 * returning it inside the `wait` result, so this card replaces the message
 * block the wait panel used to draw. `SystemNotice` would print the model's
 * `<irc>` prompt envelope verbatim (tag, reply instructions and all); the
 * mapper lifts the sender and body out of `details` first, and this card draws
 * them the way omp's own TUI does.
 */

import { MessageSquare } from 'lucide-preact';
import type { IrcMessageData } from '@/shared/types/omp/session';
import { transcriptGutter } from '@/shared/lib/chat/timeline/gutter';
import { blockChrome } from '@/shared/lib/chat/timeline/block-chrome';
import { useToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';

interface IrcNoticeProps {
  irc: IrcMessageData;
  /** Phone layout: the card's frame is the timeline gutter itself. */
  isMobile?: boolean;
}

export function IrcNotice({ irc, isMobile = false }: IrcNoticeProps) {
  const mode = useToolRenderMode();
  const chrome = blockChrome(mode);
  return (
    <div className={`${transcriptGutter(isMobile)} text-[12px] text-ink select-text ${chrome.root}`}>
      {/* The rail is drawn once per TURN by `TurnRail`; this block only places
          its node. */}
      {mode === 'trace' && <span aria-hidden="true" className={chrome.node} />}
      <div className={chrome.frame || undefined}>
        <div className={chrome.header}>
          <span className={`${chrome.icon} bg-info/10 text-info`}>
            <MessageSquare size={13} />
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className={chrome.title}>Message from {irc.from}</span>
            {irc.replyTo && (
              <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] text-ink/60">
                reply to {irc.replyTo}
              </span>
            )}
            {irc.progress && (
              <span className="rounded bg-info/10 px-1.5 py-0.2 font-mono text-[10px] text-info">
                progress
              </span>
            )}
            {irc.broadcast && (
              <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] text-ink/60">
                broadcast
              </span>
            )}
          </span>
        </div>
        <div className={chrome.body}>
          {/* Plain pre-wrap: a peer message is prose and often pasted command
              lines, and the old wait block rendered it without markdown. */}
          <div className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink/85">
            {irc.message}
          </div>
        </div>
      </div>
    </div>
  );
}
