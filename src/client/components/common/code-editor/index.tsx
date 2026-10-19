import { useImperativeHandle, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CSSProperties, Ref, TargetedKeyboardEvent } from 'preact';

import { continuesTyping, mergeTyping, pushRecord } from '@/shared/lib/code/editor/history';
import { handleEditorKeydown, runEditorCommand, type EditorKeydownDeps } from '@/client/components/common/code-editor/handler';
import { layerStyle, layerStyles } from '@/shared/lib/code/editor/layers';
import { CODE_EDITOR_RESET_CSS } from '@/shared/lib/code/editor/reset-css';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { useOccurrences } from '@/client/hooks/editor/use-occurrences';
import { useEditorHistory } from '@/client/hooks/editor/use-editor-history';
import type { TextRange } from '@/shared/lib/code/editor/commands';
import type { CodeWindow, LineWindow } from '@/shared/lib/code/lazy-window';

/**
 * Preact hand-roll of the textarea-over-<pre> highlighting editor
 * (the pattern react-simple-code-editor popularized), trimmed to the
 * feature set this app actually uses.
 *
 * How it works: a transparent <textarea> sits on top of a syntax-highlighted
 * <pre>. Typing, selecting and copying hit the native textarea; the <pre>
 * below just mirrors the text with Shiki markup.
 *
 * For a long document only a window of lines is mirrored (`virtual`): the
 * textarea still holds every line, so editing, selection and copy are
 * untouched, while the `<pre>` carries just the visible ones and reserves the
 * rest as padding — the alignment that keeps the caret over its own row.
 */

export interface CodeEditorHandle {
  /** The `<textarea>` that owns the document — measurements and focus anchor on it. */
  textarea(): HTMLTextAreaElement | null;
  /** Current selection offsets, or null before the field is mounted. */
  getSelection(): { start: number; end: number } | null;
  /** Select a range; `focus` also moves the keyboard focus into the editor. */
  select(start: number, end: number, focus?: boolean): void;
  /**
   * Replace the whole buffer as ONE undoable edit and leave the caret at
   * `caretStart`/`caretEnd`, WITHOUT moving focus. Used by the find widget's
   * replace, which must not look like a burst of typing to the history (⌘Z has
   * to undo it in one step) and must not steal focus from its own field.
   */
  applyDocument(value: string, caretStart: number, caretEnd: number): void;
  /** Every range a ⌘D workflow has selected, primary included — the surface paints them. */
  occurrences(): readonly TextRange[];
  /**
   * Run an editor command by name — the palette's path into the editor. It goes
   * through the same dispatcher the keyboard uses, so a command cannot work
   * from a chord and do nothing from the palette.
   */
  run(command: EditorCommand): void;
}

export interface CodeEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Return the Shiki-highlighted HTML for `code`, limited to `range` when the surface is windowed. */
  highlight: (code: string, range: LineWindow | null) => string;
  padding?: number;
  /** Class applied to the inner <pre> holding the highlighted code. */
  preClassName?: string;
  /** Class applied to the transparent <textarea> on top. */
  textareaClassName?: string;
  /** Layout styles for the whole editor; typography must match both layers. */
  style?: CSSProperties;
  /** The `<pre>` layer that actually wraps the code — gutter alignment measures it. */
  preRef?: Ref<HTMLPreElement>;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Renders only this window of lines, with the rest reserved as space. Omit to mirror the whole value. */
  virtual?: CodeWindow | null;
  /** Imperative surface for the find widget (selection, reveal, one-shot replace). */
  handleRef?: Ref<CodeEditorHandle>;
  /**
   * Called when the extra selection ranges change, so the surface can paint
   * them. The textarea holds only the primary selection; everything ⌘D adds
   * lives here.
   */
  onOccurrencesChange?: (ranges: readonly TextRange[]) => void;
  /** Commands this editor does not own (find bar chords, word wrap, save). */
  onCommand?: (command: EditorCommand) => void;
  /**
   * The extra ⌘D ranges, held by the CALLER. The editor keeps its own copy in a
   * ref for synchronous reads; this prop is what makes the surface a controlled
   * view of them, so the paint and the editing model cannot disagree.
   */
  occurrences?: readonly TextRange[];
  /** Shiki language id, for the comment syntax. */
  language?: string;
}

const BASE_TEXTAREA_CLASS = 'code-editor-native-textarea';

export function CodeEditor({
  value,
  onValueChange,
  highlight,
  padding = 0,
  preClassName,
  textareaClassName,
  style,
  preRef,
  className,
  placeholder,
  readOnly,
  autoFocus,
  virtual,
  handleRef,
  occurrences,
  onOccurrencesChange,
  onCommand,
  language = 'javascript',
}: CodeEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [captureTab, setCaptureTab] = useState(true);
  const multi = useOccurrences({
    controlled: occurrences,
    onChange: (ranges) => onOccurrencesChange?.(ranges),
  });

  // A selection asked for before the field exists (the find widget opens and
  // the panel re-renders in the same tick) is applied as soon as it mounts.
  const pendingSelectionRef = useRef<{ start: number; end: number; focus: boolean } | null>(null);

  /**
   * The buffer and selection as of the last event that could precede an edit.
   *
   * `handleChange` has to know which range the BROWSER replaced, and the `input`
   * event reports the state AFTER the edit — useless for locating it. Keydown,
   * select and the component's own writes all land before the edit, so
   * recording there is what makes the diff in `handleChange` unambiguous.
   *
   * The buffer that goes with it comes from the history hook (`undoStack.buffer`),
   * NOT from the `value` prop: the prop lags a keystroke — it only moves once
   * the panel's state has re-rendered, and the next keystroke can arrive first
   * (measured: typing at several carets with a 30 ms gap). A stale `before`
   * turns the diff into a replacement of the whole word, which is what made a
   * five-letter burst take five undos.
   */
  const lastSelectionRef = useRef<TextRange>({ start: 0, end: 0 });

  const setSelection = (start: number, end: number, focus: boolean) => {
    lastSelectionRef.current = { start, end };
    const input = inputRef.current;
    if (!input) {
      pendingSelectionRef.current = { start, end, focus };
      return;
    }
    // Focus BEFORE the range: a textarea that is not the active element still
    // stores `selectionStart`/`selectionEnd`, but paints neither a caret nor a
    // selection band — which is why an outline jump scrolled and then looked
    // like it had selected nothing (measured: the range was correct and the
    // field was not focused). `preventScroll` is load-bearing: the editor's
    // `<textarea>` spans the whole document (only the highlighted layer is
    // windowed), so a plain `focus()` makes the browser scroll the container to
    // the caret's position at the END of the buffer region it can see — which
    // clamped the scroller to its maximum and left a search jump showing the
    // file's tail (measured: a hit on line 800 of 900 landed at the bottom with
    // its own highlight unpainted). The surface's own `revealOffset` is the
    // only thing that scrolls.
    if (focus) input.focus({ preventScroll: true });
    input.selectionStart = start;
    input.selectionEnd = end;
  };

  useImperativeHandle(
    handleRef ?? null,
    () => ({
      textarea: () => inputRef.current,
      getSelection: () => {
        const input = inputRef.current;
        return input ? { start: input.selectionStart, end: input.selectionEnd } : null;
      },
      select: setSelection,
      applyDocument: (next, caretStart, caretEnd) => {
        undoStack.commitEdit({ value: next, selectionStart: caretStart, selectionEnd: caretEnd });
        // Focus is deliberately left where it was: the find widget's Replace
        // button is about to be pressed again, and pulling focus into the
        // document would eat the next keystroke.
        setSelection(caretStart, caretEnd, false);
      },
      occurrences: () => multi.ranges,
      run: (command) => {
        const input = inputRef.current;
        if (input) runEditorCommand(command, keydownDeps(input));
      },
    }),
    // `applyEdits` closes over `onValueChange` and the history ref only, both of
    // which are stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onValueChange],
  );

  // Runs on every render: a selection asked for while the field was not yet
  // mounted (the find widget opens in the same tick as the panel's first
  // render) has to land as soon as the textarea exists.
  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending || !inputRef.current) return;
    pendingSelectionRef.current = null;
    setSelection(pending.start, pending.end, pending.focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const undoStack = useEditorHistory({ value, inputRef, onValueChange });

  /** Everything the dispatcher needs, built once per call from the live refs. */
  const keydownDeps = (input: HTMLTextAreaElement): EditorKeydownDeps => ({
    input,
    language,
    captureTab,
    toggleCaptureTab: () => setCaptureTab((prev) => !prev),
    history: undoStack,
    multi,
    select: (start, end) => setSelection(start, end, true),
    delegate: (command) => {
      onCommand?.(command);
    },
  });

  const handleKeyDown = (e: TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    // The selection as of the last event that could precede an edit:
    // `handleChange` needs to know which range the browser replaced, and the
    // `input` event reports the selection AFTER the edit.
    lastSelectionRef.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd };
    handleEditorKeydown(e, keydownDeps(e.currentTarget));
  };

  const handleChange = (e: Event) => {
    const input = e.target as HTMLTextAreaElement;
    const { value: next, selectionStart, selectionEnd } = input;
    const history = undoStack.history;
    const timestamp = Date.now();
    // With extra ranges live, the browser's edit becomes a template: it is
    // diffed out of the OLD buffer and replayed at every other range in one
    // pass, so a keystroke, a paste and an IME composition all need no special
    // case. The result is committed as one history entry, and the ranges
    // collapse to carets so a second keystroke continues at all of them.
    const replicated = multi.replicate(undoStack.buffer, next, lastSelectionRef.current);
    if (replicated) {
      undoStack.markApplied(replicated.value);
      input.value = replicated.value;
      input.selectionStart = replicated.caret;
      input.selectionEnd = replicated.caret;
      lastSelectionRef.current = { start: replicated.caret, end: replicated.caret };
      multi.set(replicated.rest);
      // The burst merge applies here too: without it each character of a word
      // typed at several carets became its own undo entry, so ⌘Z peeled off one
      // letter instead of the word — the exact behaviour the single-caret path
      // had already been fixed for.
      if (continuesTyping(history.stack[history.offset], replicated.value, replicated.caret, timestamp)) {
        mergeTyping(history, replicated.value, replicated.caret, replicated.caret, timestamp);
      } else {
        pushRecord(history, { value: replicated.value, selectionStart: replicated.caret, selectionEnd: replicated.caret, timestamp });
      }
      onValueChange(replicated.value);
      return;
    }

    undoStack.markApplied(next);
    // Merge typing bursts into one word-level undo entry.
    if (continuesTyping(history.stack[history.offset], next, selectionStart, timestamp)) {
      mergeTyping(history, next, selectionStart, selectionEnd, timestamp);
      onValueChange(next);
      return;
    }
    pushRecord(history, { value: next, selectionStart, selectionEnd, timestamp });
    onValueChange(next);
  };

  const { pre: preStyle, textarea: textareaStyle } = layerStyles(padding, virtual);
  const layer = layerStyle();

  const highlighted = highlight(value, virtual ?? null);

  return (
    <div className={className} style={{ position: 'relative', textAlign: 'left', boxSizing: 'border-box', padding: 0, overflow: 'hidden', ...style }}>
      <pre
        ref={preRef}
        className={preClassName}
        aria-hidden="true"
        style={{ ...layer, ...preStyle, position: 'relative', pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: highlighted + (virtual && !virtual.breakAtEnd ? '' : '<br />') }}
      />
      <textarea
        ref={inputRef}
        className={`${BASE_TEXTAREA_CLASS}${textareaClassName ? ` ${textareaClassName}` : ''}`}
        style={{ ...layer, ...textareaStyle, position: 'absolute', top: 0, left: 0, height: '100%', width: '100%', resize: 'none', color: 'inherit', overflow: 'hidden', WebkitTextFillColor: 'transparent' }}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={() => {
          const input = inputRef.current;
          if (input) lastSelectionRef.current = { start: input.selectionStart, end: input.selectionEnd };
        }}
        onBlur={() => multi.clear()}
        placeholder={placeholder}
        readOnly={readOnly}
        autoFocus={autoFocus}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellcheck={false}
        data-gramm={false}
      />
      {/* One <style> per editor instance; the rule is a constant so the
          duplicate elements are the same three lines the browser dedupes. */}
      <style dangerouslySetInnerHTML={{ __html: CODE_EDITOR_RESET_CSS }} />
    </div>
  );
}

export default CodeEditor;
