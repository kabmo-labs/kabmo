import { useRef } from 'preact/hooks';
import type { ChangeEvent } from 'preact/compat';
import { File as FileIcon, Maximize2, Minimize2, Paperclip, X } from 'lucide-preact';
import type { Attachment } from '@/shared/types';
import { attachmentName } from '@/shared/lib/chat/attachments';
import { ModeToggles } from '@/client/components/workspace/chat-timeline/chat-input/ModeToggles';
import type { ComposerModes } from '@/client/components/workspace/chat-timeline/chat-input/modes-props';

interface AttachmentToolbarProps {
  attachments: Attachment[];
  onFilesSelected: (files: File[]) => void;
  onRemove: (id: string) => void;
  /**
   * Plan/Goal toggles, hosted HERE on a phone and in the bottom toolbar on a
   * desktop. Both are supplied together or not at all: the row owns the
   * toggles only when it was handed the slice AND a way to open the modal.
   */
  modes?: ComposerModes;
  onOpenGoal?: () => void;
  /**
   * The stretch control, at the row's trailing edge. Omitted by a composer that
   * must not stretch (the New Chat modal owns its own card size, and the
   * side-question form sits inside a panel that is already sized).
   */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /**
   * The phone's compact composer: the textarea is gone, so this row carries the
   * affordance that brings it back — a "Type here" target beside the paperclip.
   * Tapping it (or the card) is what expands the composer, which is why it is a
   * button rather than a label.
   */
  compact?: boolean;
  onExpandComposer?: () => void;
}

export function AttachmentToolbar({ attachments, onFilesSelected, onRemove, modes, onOpenGoal, expanded, onToggleExpand, compact = false, onExpandComposer }: AttachmentToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.files && e.currentTarget.files.length > 0) {
      onFilesSelected(Array.from(e.currentTarget.files));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <>
      {/* No separator and no second surface: the card is ONE colour, so the
          header, the draft and the toolbar read as one panel. A hairline over
          a tinted strip made the composer look like three stacked bars. */}
      <div className="composer-attach-row flex items-center flex-wrap gap-1.5 px-3 py-2 text-ink/60">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center hover:bg-ink/5 p-1 rounded transition-colors text-ink/60 hover:text-ink shrink-0"
          title="Attach file or image"
        >
          <Paperclip size={14} />
        </button>

        {/* The compact composer's own placeholder. The textarea is not rendered
            at all in that state, so this is the only thing that says the card
            is still a composer — and the only thing a tap can hit to bring the
            box back. It sits right beside the paperclip, where the text used to
            start, so the row keeps its reading order. */}
        {compact && (
          <button
            type="button"
            data-composer-reopen
            onClick={onExpandComposer}
            className="min-w-0 flex-1 text-left text-[13px] text-ink/40 truncate"
          >
            Type here
          </button>
        )}

        {attachments.map(att => (
          <div key={att.id} className="relative flex items-center bg-canvas border border-ink/10 rounded-md p-0.5 pr-6 text-xs shadow-sm group">
            {att.preview ? (
              <img src={att.preview} alt="preview" className="w-6 h-6 object-cover rounded-sm mr-1.5 border border-ink/5" />
            ) : (
              <div className="w-6 h-6 flex items-center justify-center bg-ink/5 rounded-sm mr-1.5 text-ink/60">
                <FileIcon size={12} />
              </div>
            )}
            <span className="truncate max-w-[120px] font-mono text-[10px] text-ink/80">{attachmentName(att)}</span>
            <button
              onClick={() => onRemove(att.id)}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 text-ink/40 hover:text-error hover:bg-error/10 rounded transition-colors"
              title="Remove attachment"
            >
              <X size={10} />
            </button>
          </div>
        ))}

        {/* Plan/Goal sit HERE on a phone, not in the bottom row: that row is a
            single line whose left cluster (model, thinking, access) already
            fills it, so a third group pushed the voice button under the model
            label. `ml-auto` keeps them on the row's trailing edge, away from
            the paperclip and any attachment chips. */}
        {modes && onOpenGoal && (
          <div className="ml-auto flex-shrink-0">
            <ModeToggles
              plan={modes.plan}
              goal={modes.goalOpen}
              goalRecord={modes.goalRecord}
              pending={modes.pending}
              onTogglePlan={modes.onTogglePlan}
              onOpenGoal={onOpenGoal}
              planAvailable={modes.planAvailable}
            />
          </div>
        )}

        {/* The stretch control, always last on the row. `ml-auto` unless the
            mode toggles already took it, so the two trailing groups stay apart
            from the paperclip and the attachment chips. */}
        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-pressed={Boolean(expanded)}
            // "Maximize", not "Expand": `chat.e2e.ts` collects the tool cards'
            // titles with `[aria-label^="Expand "]` and requires every one to
            // name its tool, so a second control spelled that way would be read
            // as a tool card whose title is "composer".
            aria-label={expanded ? 'Restore composer' : 'Maximize composer'}
            title={expanded ? 'Restore composer' : 'Maximize composer'}
            className={`${modes && onOpenGoal ? '' : 'ml-auto '}flex items-center justify-center p-1 rounded transition-colors shrink-0 ${
              expanded ? 'bg-ink/10 text-ink' : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
            }`}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
      </div>

      <input
        type="file"
        multiple
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileSelect}
      />
    </>
  );
}
