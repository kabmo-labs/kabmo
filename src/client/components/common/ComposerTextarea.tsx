import { useRef } from 'preact/hooks';
import type { ClipboardEvent, KeyboardEvent, ReactElement, RefObject } from 'preact/compat';
import { useComposerTrigger } from '@/client/hooks/chat/composer';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { ComposerPicker, type ComposerPickerPlacement } from '@/client/components/common/ComposerPicker';
import { resolveComposerKeybindings, type ComposerKeybinding } from '@/shared/lib/chat/composer/keybindings';

export interface ComposerTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (options?: { steering?: boolean }) => void;
  disabled?: boolean;
  /** The server-injected settings map. The bindings are read out of it through
   *  `resolveComposerKeybindings`, which knows they live in the
   *  `omp_chamber_settings` blob rather than at the top level. */
  appSettings?: Record<string, any>;
  placeholder?: string;
  className?: string;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  rootPath?: string | null;
  /**
   * Whether the `@` / `/` / `!` / `#` autocomplete runs. Off for a composer with
   * nothing to complete against — the side-question form has no file tree, no
   * commands and no skills, and an `@` mention left in its text would reach the
   * model as a literal no prompt builder translates.
   */
  enablePicker?: boolean;
  /**
   * Where the popup opens (see `ComposerPickerProps.placement`). The docked
   * composer opens upward; a composer filling the viewport opens over the top
   * of its own textarea.
   */
  placement?: ComposerPickerPlacement;
  /**
   * Classes for the textarea's wrapper — the popup's positioning context. A
   * stretched composer makes it the flex member that owns the leftover height,
   * which is what lets the textarea be `h-full` inside it.
   */
  wrapperClassName?: string;
  /**
   * `mobile` makes a bare Enter insert a newline instead of sending: phone
   * keyboards have no Shift key, so the configured Enter-to-send binding would
   * leave no way to write a multi-line prompt. Modifier bindings
   * (Ctrl/Cmd + Enter) still work with a hardware keyboard; the send button is
   * the primary affordance on touch.
   */
  variant?: 'desktop' | 'mobile';
  /**
   * Externally owned textarea ref. The composer keeps its own for the picker,
   * so this is an ADDITIONAL handle — a modal uses it to size the box to its
   * content (`useAutoGrow`).
   */
  textareaRef?: RefObject<HTMLTextAreaElement>;
  /**
   * The composer's own element, for a caller that must WRITE into the draft
   * (a plugin's `useComposer().insert`, which places at the caret).
   *
   * Separate from `textareaRef` because that one is owned by a caller that
   * measures the box: two writers of one ref is how a plugin's caret position
   * and a grow hook's measurement end up fighting over the same node.
   */
  onReady?: (element: HTMLTextAreaElement | null) => void;
}

export function ComposerTextarea({
  value,
  onChange,
  onSend,
  disabled = false,
  appSettings,
  placeholder,
  className,
  onPaste,
  rootPath,
  enablePicker = true,
  placement = 'up',
  wrapperClassName = '',
  variant = 'desktop',
  textareaRef: externalRef,
  onReady,
}: ComposerTextareaProps): ReactElement {
  const isMobile = variant === 'mobile';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Two owners, one node: the picker needs the element to place the caret after
  // a completion, and a caller may need it to measure the box.
  const setTextareaRef = (node: HTMLTextAreaElement | null) => {
    textareaRef.current = node;
    if (externalRef) externalRef.current = node;
    onReady?.(node);
  };
  const composer = useComposerTrigger({ value, setValue: onChange, textareaRef, disabled, rootPath, enabled: enablePicker });

  useOnClickOutside(wrapperRef, composer.close);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // The autocomplete owns Arrow/Enter/Tab/Escape while it is open.
    if (composer.handleKeyDown(e)) return;
    if (e.key !== 'Enter') return;

    const { send: sendBinding, newLine: newLineBinding, steering: steeringBinding } =
      resolveComposerKeybindings(appSettings);

    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
    const isShift = e.shiftKey;

    const checkBinding = (binding: ComposerKeybinding) => {
      if (binding === 'Enter' && !isShift && !isCtrlOrCmd && !e.altKey) return true;
      if (binding === 'Shift + Enter' && isShift && !isCtrlOrCmd && !e.altKey) return true;
      if (binding === 'Ctrl / Cmd + Enter' && !isShift && isCtrlOrCmd && !e.altKey) return true;
      return false;
    };

    // A bare Enter on touch inserts a newline (see `variant`); every modified
    // combination keeps its configured meaning.
    const bareEnter = !isShift && !isCtrlOrCmd && !e.altKey;
    if (isMobile && bareEnter) return;

    if (checkBinding(steeringBinding)) {
      e.preventDefault();
      if (!disabled) {
        onSend({ steering: true });
      }
    } else if (checkBinding(sendBinding)) {
      e.preventDefault();
      if (!disabled) onSend();
    } else if (checkBinding(newLineBinding)) {
      // Allow default behavior (new line)
    } else {
      // Prevent default for other Enter combinations to avoid unwanted new lines
      e.preventDefault();
    }
  };

  return (
    <div className={`relative ${wrapperClassName}`} ref={wrapperRef}>
      <textarea
        ref={setTextareaRef}
        data-testid="composer-input"
        value={value}
        onChange={composer.handleChange}
        onCompositionStart={composer.handleCompositionStart}
        onCompositionEnd={composer.handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        disabled={disabled}
        placeholder={placeholder}
        enterkeyhint={isMobile ? 'enter' : undefined}
        className={className}
        aria-autocomplete="list"
        aria-expanded={composer.isOpen}
        aria-controls={composer.listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={
          composer.isOpen && composer.matches.length > 0
            ? composer.optionId(composer.activeIndex)
            : undefined
        }
      />

      <ComposerPicker
        open={composer.isOpen}
        kind={composer.trigger?.kind ?? 'mention'}
        placement={placement}
        phase={composer.trigger?.phase ?? 'name'}
        items={composer.matches}
        activeIndex={composer.activeIndex}
        loading={composer.loading}
        error={composer.error}
        listboxId={composer.listboxId}
        optionId={composer.optionId}
        onSelect={composer.selectItem}
        onHover={composer.setActiveIndex}
      />
    </div>
  );
}
