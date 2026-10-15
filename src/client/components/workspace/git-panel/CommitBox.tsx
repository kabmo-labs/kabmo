import { Check } from 'lucide-preact';

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
  onToggleAmend?: (value: boolean) => void;
  onChangeMessage: (value: string) => void;
  onCommit: () => void;
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
  onToggleAmend,
  onChangeMessage,
  onCommit,
}: GitCommitBoxProps) {
  const canCommit = message.trim().length > 0 && !isBusy && (amend || hasStagedChanges);

  const commitTitle = amend
    ? 'Rewrite the previous commit with this message'
    : hasStagedChanges
      ? 'Commit staged changes'
      : 'Stage changes first';

  return (
    <div className="border-t border-ink/10 bg-canvas/50 p-3 flex flex-col gap-2">
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

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-ink/70 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => onToggleAmend?.(e.currentTarget.checked)}
            className="accent-ink cursor-pointer"
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
          onClick={onCommit}
          disabled={!canCommit}
          title={commitTitle}
          className="ml-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-ink text-canvas hover:bg-ink/90 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={12} />
          {amend ? 'Amend commit' : 'Commit'}
        </button>
      </div>
    </div>
  );
}
