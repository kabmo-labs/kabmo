import { useState } from 'preact/hooks';
import { Maximize2, Minimize2, X } from 'lucide-preact';
import { ChatInput } from '@/client/components/workspace/chat-timeline/chat-input/index';
import { seedNewChatDraft } from '@/shared/lib/chat/new-chat-seed';
import type { Attachment } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

/**
 * The composer's growth bounds, in px. The minimum matches the `min-h-[80px]`
 * the composer already renders at, so the box never starts smaller than it
 * looks. The ceilings are what keeps a pasted transcript from turning the modal
 * into a full-screen scroll: the default one is roughly half the card at its
 * default size, and the expanded one is half the viewport, past which the
 * textarea scrolls itself.
 */
const MODAL_COMPOSER_MIN_HEIGHT_PX = 80;
const MODAL_COMPOSER_MAX_HEIGHT_PX = 320;
const MODAL_COMPOSER_MAX_EXPANDED_PX = 480;

/**
 * The card's own size, in px of viewport. Applied as an inline style rather
 * than `h-[92vh]` / `max-w-[min(96vw,1600px)]`: an arbitrary-value class only
 * exists if the CSS generator emitted a rule for that exact string, and a
 * missing rule fails SILENTLY (the element keeps its content height while the
 * `aria-pressed` toggle says it is expanded — measured in the browser).
 */
const MODAL_EXPANDED_STYLE = { width: 'min(96vw, 1600px)', height: '92vh' } as const;
const MODAL_DEFAULT_STYLE = { maxWidth: '42rem', maxHeight: '90vh' } as const;

interface NewChatModalProps {
  initialContent: string;
  /**
   * Attachments of the row this chat was seeded from. A committed row carries
   * the persisted display fields (name/type/size/preview/dataBase64/content) —
   * everything the composer chip renderer and the send path read, so an image
   * or an inlined text file survives into the new chat.
   */
  initialAttachments?: Attachment[];
  onClose: () => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  appSettings?: Record<string, any>;
  accessMode: ApprovalMode;
  onAccessModeChange: (mode: ApprovalMode) => void;
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
}

export function NewChatModal({
  initialContent,
  initialAttachments = [],
  onClose,
  onSend,
  appSettings,
  accessMode,
  onAccessModeChange,
  composerModelRef,
}: NewChatModalProps) {
  // The seed is a quotation, and the user's own instruction goes under it — the
  // divider is what keeps the two apart (see `new-chat-seed.ts`).
  const [inputValue, setInputValue] = useState(() => seedNewChatDraft(initialContent));
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  // Maximize: the modal takes most of the viewport and the composer grows to
  // fill it, so a long seeded message and a long instruction are both readable
  // while they are written.
  const [maximized, setMaximized] = useState(false);

  const handleSend = (atts: Attachment[]) => {
    onSend(inputValue, atts);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 animate-in fade-in duration-200 p-4">
      <div 
        className="bg-canvas border border-ink/15 rounded-xl shadow-xl w-full flex flex-col overflow-hidden"
        style={maximized ? MODAL_EXPANDED_STYLE : MODAL_DEFAULT_STYLE}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink/10 bg-paper">
          <h2 className="text-[13px] font-semibold text-ink">New Chat</h2>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setMaximized((prev) => !prev)}
              aria-pressed={maximized}
              aria-label={maximized ? 'Restore chat size' : 'Expand chat'}
              title={maximized ? 'Restore' : 'Expand'}
              className={`p-1 rounded transition-colors cursor-pointer ${maximized ? 'bg-ink/10 text-ink' : 'text-ink/60 hover:bg-ink/10 hover:text-ink'}`}
            >
              {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close new chat"
              title="Close"
              className="p-1 rounded hover:bg-ink/10 text-ink/60 hover:text-ink transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        
        <div className="p-4 flex-1 min-h-0 flex flex-col scrollbar-overlay-container">
          <p className="text-xs text-ink/60 mb-3 shrink-0">
            Start a new session in this workspace based on the selected message.
          </p>
          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSend={handleSend}
            isGenerating={false}
            appSettings={appSettings}
            accessMode={accessMode}
            onAccessModeChange={onAccessModeChange}
            composerModelRef={composerModelRef}
            autoGrow={{ minHeightPx: MODAL_COMPOSER_MIN_HEIGHT_PX, maxHeightPx: maximized ? MODAL_COMPOSER_MAX_EXPANDED_PX : MODAL_COMPOSER_MAX_HEIGHT_PX }}
          />
        </div>
      </div>
    </div>
  );
}
