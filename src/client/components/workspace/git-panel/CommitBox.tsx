import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';
import { Check, Loader2, Sparkles } from 'lucide-preact';

interface GitCommitBoxProps {
  message: string;
  hasStagedChanges: boolean;
  isBusy?: boolean;
  /** Rewrite the previous commit instead of adding one. */
  amend?: boolean;
  /**
   * The draft is exactly the text Amend's pre-fill loaded, untouched — the
   * panel uses it to say so rather than letting an auto-filled box read as a
   * stale draft. Cleared by the first edit.
   */
  seeded?: boolean;
  /** True while the commit-message model is answering. */
  isGenerating?: boolean;
  /** A generated message that was not written into a non-empty draft. */
  suggestion?: string | null;
  /** True while the draft is the generated text and the user has not edited it. */
  generated?: boolean;
  onToggleAmend?: (value: boolean) => void;
  onChangeMessage: (value: string) => void;
  onCommit: () => void;
  onGenerate?: () => void;
  onUseSuggestion?: () => void;
  onDismissSuggestion?: () => void;
}

/**
 * The commit box.
 *
 * **Amend is a checkbox, never implied.** `git commit --amend` rewrites the
 * previous commit rather than adding one, and it is the single most common
 * commit-shaped mistake; a box that amended because the index happened to be
 * empty would rewrite history the user did not ask to rewrite. It is offered
 * explicitly and cleared after every commit (`GitPanel.executeAction`), so the
 * next commit is a normal one.
 *
 * The button's enablement deliberately does NOT change with amend: an amend
 * with nothing staged is legitimate (`git commit --amend` there only re-edits
 * the message), and gating it on `hasStagedChanges` — which is what the plain
 * commit path needs — would refuse the case the checkbox exists for.
 *
 * **Ticking Amend pre-fills the draft with the message it is about to
 * rewrite**, because `--amend` REPLACES the message: an empty box asks the user
 * to retype what is already in the repository, and the common amend is a tweak
 * to the previous subject. The seeding lives in `useCommitBox` (see there for
 * why it never overwrites a draft the user typed); the placeholder says what
 * happened so an auto-filled box does not read as a stale draft.
 */
export function GitCommitBox({
  message,
  hasStagedChanges,
  isBusy = false,
  amend = false,
  seeded = false,
  isGenerating = false,
  suggestion = null,
  generated = false,
  onToggleAmend,
  onChangeMessage,
  onCommit,
  onGenerate,
  onUseSuggestion,
  onDismissSuggestion,
}: GitCommitBoxProps) {
  const canCommit = message.trim().length > 0 && !isBusy && (amend || hasStagedChanges);
  const canGenerate = (amend || hasStagedChanges) && !isBusy && !isGenerating;

  const commitTitle = amend
    ? 'Rewrite the previous commit with this message'
    : hasStagedChanges
      ? 'Commit staged changes'
      : 'Stage changes first';

  const generateTitle = isGenerating
    ? 'Generating…'
    : amend || hasStagedChanges
      ? 'Generate a commit message from the staged changes'
      : 'Stage changes first';

  return (
    <div className="border-t border-ink/10 bg-canvas/50 p-3 flex flex-col gap-2">
      {suggestion && (
        <div className="rounded border border-ink/20 bg-paper p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">Generated message</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onUseSuggestion}
                className="px-2 py-0.5 rounded bg-ink text-canvas text-[10px] font-medium hover:bg-ink/90 transition-colors cursor-pointer"
              >
                Use
              </button>
              <button
                type="button"
                onClick={onDismissSuggestion}
                className="px-2 py-0.5 rounded border border-ink/20 text-ink/70 text-[10px] font-medium hover:bg-ink/5 transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-words text-[11px] text-ink/80 font-mono max-h-32 overflow-y-auto">{suggestion}</pre>
        </div>
      )}

      <textarea
        value={message}
        onChange={(e) => onChangeMessage(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
            e.preventDefault();
            onCommit();
          }
        }}
        placeholder={amend ? 'New message for the previous commit (⌘/Ctrl+Enter to commit)' : 'Commit message (⌘/Ctrl+Enter to commit)'}
        rows={5}
        className="w-full resize-y min-h-[100px] max-h-[200px] bg-paper border border-ink/20 rounded px-2.5 py-1.5 text-xs text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40 transition-colors font-mono"
      />

      {generated && message.trim().length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-ink/40">
          <Sparkles size={10} /> Generated from staged changes
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-ink/70 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => onToggleAmend?.(e.currentTarget.checked)}
            className={`${CHECKBOX_CLASS} accent-ink cursor-pointer`}
          />
          Amend
        </label>
        {/* Names the pre-fill, so an auto-filled draft is not mistaken for a
            stale one the user left behind. It disappears on the first edit —
            the draft is theirs from then on. */}
        {amend && seeded && (
          <span className="text-[10px] text-ink/40" title="The previous commit's message, loaded as an editable starting point">
            previous message loaded
          </span>
        )}

        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          title={generateTitle}
          aria-label="Generate commit message with AI"
          className="ml-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-ink/20 text-ink/80 hover:bg-ink/5 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {isGenerating ? 'Generating…' : 'Generate'}
        </button>

        <button
          type="button"
          onClick={onCommit}
          disabled={!canCommit}
          title={commitTitle}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-ink text-canvas hover:bg-ink/90 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={12} />
          {amend ? 'Amend commit' : 'Commit'}
        </button>
      </div>
    </div>
  );
}
