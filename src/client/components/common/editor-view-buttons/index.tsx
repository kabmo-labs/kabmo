import { MessageSquareOff, PanelLeftClose } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';
import { useSharedSessionState } from '@/client/hooks/workspace/session-state';
import type { ToolbarOverflowAction } from '@/client/components/common/toolbar-row';
import {
  DEFAULT_EDITOR_VIEW_MODE,
  EDITOR_VIEW_MODE_KEY,
  isEditorViewMode,
  toggledEditorViewMode,
  type EditorViewMode,
  type EditorViewModeTarget,
} from '@/shared/lib/workspace/editor-view-mode';

/**
 * The two width modes, as data.
 *
 * Each is a row so the buttons, their labels and their icons cannot drift
 * apart: the label states exactly which columns disappear, because "Compact"
 * and "Full" are words that could mean anything, and the icons are DIFFERENT
 * SHAPES rather than two spellings of the same one — the third width control
 * beside them (full SCREEN, which covers the right panel too) keeps its own
 * `Maximize` glyph.
 */
export const EDITOR_VIEW_MODES: Array<{
  target: EditorViewModeTarget;
  label: string;
  hint: string;
  Icon: LucideIcon;
}> = [
  {
    target: 'compact',
    label: 'Compact view',
    hint: 'Editor takes the chat width — chat hidden, sidebar and right panel kept',
    Icon: MessageSquareOff,
  },
  {
    target: 'full',
    label: 'Full view',
    hint: 'Editor takes the chat and sidebar width — chat and sidebar hidden, right panel kept',
    Icon: PanelLeftClose,
  },
];

/** The mode in force, and the setter the buttons share. */
export function useEditorViewMode(): { mode: EditorViewMode; setMode: (next: EditorViewMode) => void } {
  const [stored, setMode] = useSharedSessionState<EditorViewMode>(EDITOR_VIEW_MODE_KEY, DEFAULT_EDITOR_VIEW_MODE);
  return { mode: isEditorViewMode(stored) ? stored : DEFAULT_EDITOR_VIEW_MODE, setMode };
}

/**
 * The same two modes as `⋯` menu rows, for a toolbar too narrow to draw them.
 *
 * A hook rather than a plain function because the menu row has to CLICK the same
 * slot the buttons write, and a row built from a stale mode would enter the mode
 * already in force (which the toggle reads as "leave it").
 */
export function useEditorViewActions(): ToolbarOverflowAction[] {
  const { mode, setMode } = useEditorViewMode();
  return EDITOR_VIEW_MODES.map(({ target, label, Icon }) => ({
    // A menu row has no hover title, so the sentence that explains the mode is
    // part of what the row says rather than lost with the button's tooltip.
    label,
    icon: Icon,
    active: mode === target,
    onSelect: () => setMode(toggledEditorViewMode(mode, target)),
  }));
}

interface EditorViewButtonsProps {
  /** Glyph size: the editor toolbar draws 14px, the diff toolbar 13px. */
  size?: number;
}

/**
 * The two width-mode buttons, drawn by BOTH the editor and the diff toolbar.
 *
 * One component because the two toolbars are the same surface on two tab kinds:
 * a mode entered from the diff and a mode entered from a file must be the same
 * mode, and a second copy of these rules is how the diff ends up offering a
 * width the layout does not implement. The state is the shared session slot
 * (see `useEditorViewLayout`) so the layout collapses the columns on the same
 * render.
 */
export function EditorViewButtons({ size = 14 }: EditorViewButtonsProps) {
  const { mode, setMode } = useEditorViewMode();

  return (
    <>
      {EDITOR_VIEW_MODES.map(({ target, label, hint, Icon }) => {
        const active = mode === target;
        return (
          <button
            key={target}
            type="button"
            onClick={() => setMode(toggledEditorViewMode(mode, target))}
            className={`flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer flex-shrink-0 ${
              active ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink hover:bg-ink/5'
            }`}
            title={hint}
            aria-label={label}
            aria-pressed={active}
          >
            <Icon size={size} />
          </button>
        );
      })}
    </>
  );
}
