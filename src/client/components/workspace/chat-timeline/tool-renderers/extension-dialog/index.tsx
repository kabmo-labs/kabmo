
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CheckCircle2 } from 'lucide-preact';
import type { ExtensionUiDialogRequest } from '@/client/hooks/chat/omp';
import { ExtensionDialogHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Header';
import { ExtensionDialogSelectBody } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/SelectBody';
import { ExtensionDialogFooter } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Footer';
import { ApprovalBody } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/ApprovalBody';
import { dialogMethodMeta, useDialogShortcuts } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/shortcuts';
import { isApprovalGateFrame } from '@/shared/lib/chat/omp/approval-gate';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';

export type ExtensionDialogResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true }
  /** One `ask` answer per question, in question order (grouped ask mode). */
  | { answers: { id: string; selectedOptions: string[]; customInput?: string }[] };

interface ExtensionDialogProps {
  request: ExtensionUiDialogRequest;
  onRespond: (request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;
}

/**
 * Blocking extension dialog that has no card of its own to render in: an
 * approval gate under `always-ask`, or a picker an extension raised. The `ask`
 * tool's own dialogs render inline on its tool card instead (see ask-panel) —
 * a modal would only ever show the question currently in flight.
 */
export function ExtensionDialog({ request, onRespond }: ExtensionDialogProps) {
  const [value, setValue] = useState(request.method === 'editor' ? request.prefill ?? '' : '');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const options = request.options ?? [];
  const optionDetails = request.optionDetails ?? [];
  // An approval gate is a `select` frame whose title is omp's approval prompt
  // (see `isApprovalGateFrame`). It has no "Other" option, and omp's own
  // answer parser treats any free-text answer as a DENY — so the free-text
  // field is hidden for it rather than offered as a way to deny by typo.
  const isApprovalGate = isApprovalGateFrame(request);

  // Reset for a NEW dialog only. `request` is the identity to depend on —
  // `options`/`optionDetails` above are derived arrays, re-created on every
  // render, so listing one as a dependency re-ran this effect after every
  // commit and threw away whatever had just been typed: an editor/input frame
  // carries no `options` at all, so the reset fired on every keystroke and the
  // dialog could not be typed into.
  useEffect(() => {
    const items = request.options ?? [];
    setValue(request.method === 'editor' ? request.prefill ?? '' : '');
    setSelectedOption(items.length > 0 ? items[0] : null);
    setCustomValue('');
  }, [request]);

  // Focus once per dialog, for the same reason: a fresh dependency on every
  // render also pulls the caret back into the field the user just left.
  useEffect(() => {
    panelRef.current?.focus();
    if (request.method === 'input') {
      inputRef.current?.focus();
    } else if (request.method === 'editor') {
      textareaRef.current?.focus();
    } else if (request.method === 'select') {
      // When the AI offers an "Other"-style option, the intended interaction
      // is typing a custom answer — focus the input right away.
      const hasOther = (request.options ?? []).some((option) => /^other\b/i.test(option.trim()));
      if (hasOther) {
        customInputRef.current?.focus();
      }
    }
  }, [request]);

  const cancel = useCallback(() => {
    onRespond(request, { cancelled: true });
  }, [onRespond, request]);

  const submitValue = useCallback(() => {
    if (request.method === 'confirm') {
      onRespond(request, { confirmed: true });
    } else if (request.method === 'select') {
      // A typed custom answer is the actual response — the "Other" option
      // label itself is not. It wins over the highlighted option.
      //
      // An APPROVAL gate is the exception: omp's answer parser reads any
      // string that is not one of its choice labels as a DENY (measured:
      // "Approve" allows, "yes please" denies), so a custom answer there can
      // only ever refuse. The gate answers with its chosen label.
      if (customValue.trim() && !isApprovalGate) {
        onRespond(request, { value: customValue.trim() });
      } else if (selectedOption) {
        onRespond(request, { value: selectedOption });
      }
    } else {
      onRespond(request, { value });
    }
  }, [onRespond, request, selectedOption, value, customValue, isApprovalGate]);

  const handleConfirmOption = useCallback(
    (option: string) => {
      // Never submit the literal "Other…" label (e.g. via double-click) —
      // it is a prompt to type, not an answer. Redirect to the input instead.
      if (/^other\b/i.test(option.trim())) {
        setSelectedOption(option);
        customInputRef.current?.focus();
        return;
      }
      onRespond(request, { value: option });
    },
    [onRespond, request]
  );

  const handleSelectOption = useCallback(
    (option: string) => {
      setSelectedOption(option);
      // "Other"-style options expect a typed answer; put the caret in the
      // custom input instead of leaving the label itself as the response.
      if (/^other\b/i.test(option.trim())) {
        customInputRef.current?.focus();
      }
    },
    []
  );

  // Keyboard navigation & shortcuts.
  useDialogShortcuts({
    method: request.method,
    options,
    selectedOption,
    onSelectOption: setSelectedOption,
    customInputRef,
    onSubmit: submitValue,
    onCancel: cancel,
  });

  const methodMeta = dialogMethodMeta(request.method, options.length);

  return (
    <div
      className="extension-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{
        background: 'color-mix(in srgb, var(--theme-ink) 55%, transparent)',
        backdropFilter: 'blur(8px)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.title || methodMeta.label}
        tabIndex={-1}
        className="extension-dialog-panel w-full max-w-[560px] overflow-hidden rounded-2xl border border-ink/15 bg-paper shadow-2xl outline-none"
        style={{
          boxShadow: '0 24px 64px -8px color-mix(in srgb, var(--theme-ink) 28%, transparent)',
        }}
      >
          <ExtensionDialogHeader
            title={request.title}
            options={options}
            methodLabel={methodMeta.label}
            badge={methodMeta.badge}
            icon={methodMeta.icon}
            onCancel={cancel}
          />

          <div className="max-h-[65vh] overflow-y-auto px-6 py-5 space-y-4">
            {/* The approval gate: what is being approved, and why. */}
            <ApprovalBody title={request.title} options={options} />

            {/* Prompt / Context Message with Markdown */}
            {request.message && (
              <div className="rounded-xl border border-ink/8 bg-canvas/40 p-4 text-[13px] leading-relaxed text-ink/85 select-text">
                <MarkdownRenderer content={request.message} />
              </div>
            )}

            {/* Select Options */}
            {request.method === 'select' && (
              <ExtensionDialogSelectBody
                options={options}
                optionDetails={optionDetails}
                selectedOption={selectedOption}
                customValue={customValue}
                onCustomChange={setCustomValue}
                customInputRef={customInputRef}
                onSelect={handleSelectOption}
                onConfirmOption={handleConfirmOption}
                hideCustomAnswer={isApprovalGate}
              />
            )}

            {/* Confirm Banner */}
            {request.method === 'confirm' && (
              <div className="flex items-center gap-3 rounded-xl border border-ink/10 bg-canvas/30 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink">
                  <CheckCircle2 size={18} />
                </div>
                <div className="text-[12.5px] leading-relaxed text-ink/75">
                  Confirming will allow the autonomous agent to proceed with this operation. Press <kbd className="rounded border border-ink/20 bg-paper px-1 py-0.2 font-mono text-[10.5px]">Enter</kbd> to confirm or <kbd className="rounded border border-ink/20 bg-paper px-1 py-0.2 font-mono text-[10.5px]">Esc</kbd> to abort.
                </div>
              </div>
            )}

            {/* Single-line Input */}
            {request.method === 'input' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-medium tracking-wider text-ink/50 uppercase">
                  <span>Your Response</span>
                  <span className="font-mono text-[10px] text-ink/40">Press [Enter] to submit</span>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  placeholder={request.placeholder || 'Type your response...'}
                  onChange={(e) => setValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitValue();
                    }
                  }}
                  className="w-full rounded-xl border border-ink/15 bg-paper px-4 py-3 text-[13.5px] text-ink placeholder:text-ink/35 outline-none transition-all focus:border-ink focus:ring-2 focus:ring-ink/15"
                />
              </div>
            )}

            {/* Multiline Editor */}
            {request.method === 'editor' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-medium tracking-wider text-ink/50 uppercase">
                  <span>Buffer Content</span>
                  <span className="font-mono text-[10px] text-ink/40">{value.split('\n').length} lines · ⌘↵ to save</span>
                </div>
                <textarea
                  ref={textareaRef}
                  value={value}
                  onChange={(e) => setValue(e.currentTarget.value)}
                  rows={8}
                  placeholder={request.placeholder || 'Enter content...'}
                  className="w-full rounded-xl border border-ink/15 bg-canvas/30 px-4 py-3 font-mono text-[12px] leading-relaxed text-ink placeholder:text-ink/35 outline-none transition-all focus:border-ink focus:bg-paper focus:ring-2 focus:ring-ink/15"
                />
              </div>
            )}
          </div>

          <ExtensionDialogFooter
            method={request.method}
            optionsLength={options.length}
            selectedOption={selectedOption}
            hasCustomAnswer={customValue.trim().length > 0}
            onCancel={cancel}
            onSubmit={submitValue}
          />
      </div>
    </div>
  );
}
