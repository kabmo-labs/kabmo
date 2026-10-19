/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel UI kit.
 *
 * These are ordinary host components, not a sandboxed mini-app's widgets: a
 * plugin renders inside Kabmo's own tree, so the kit uses Kabmo's
 * theme variables and Tailwind utilities directly and looks native in every
 * palette with no CSS bridge.
 *
 * The kit exists so a plugin does not re-invent the same six shapes — a titled
 * panel, a label/value row, a text field, a button, an empty state, a note —
 * and so those shapes stay consistent across plugins the way they are within
 * Kabmo itself.
 *
 * Every component takes its colours from the theme variables (`bg-paper`,
 * `text-ink`, `border-ink/10`), never a literal, which is what keeps a plugin
 * legible in the light and dark palettes without knowing they exist.
 */

import type { ComponentChildren } from 'preact';
import { uiKitServices } from './services';

interface PanelProps {
  title: string;
  children: ComponentChildren;
}

/** A panel's outer chrome: a title bar over a scrolling body. */
export function Panel({ title, children }: PanelProps) {
  return (
    <div class="flex flex-col h-full w-full bg-paper text-ink">
      <div class="flex-shrink-0 border-b border-ink/10 px-3 py-2">
        <span class="text-xs font-semibold text-ink">{title}</span>
      </div>
      <div class="flex-1 min-h-0 overflow-auto p-3">{children}</div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  hint?: string;
}

/** One labelled fact. The label is a micro-header, the value is machine text. */
export function Field({ label, value, hint }: FieldProps) {
  return (
    <div class="flex flex-col gap-0.5">
      <span class="text-[10px] uppercase font-mono text-ink/40">{label}</span>
      <span class="text-xs font-mono text-ink break-all">{value}</span>
      {hint ? <span class="text-[11px] text-ink/50">{hint}</span> : null}
    </div>
  );
}

/** A stack of `Field`s. */
export function FieldList({ children }: { children: ComponentChildren }) {
  return <div class="flex flex-col gap-3">{children}</div>;
}

interface TextAreaFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onInput: (value: string) => void;
}

/**
 * A labelled textarea.
 *
 * Controlled through `onInput` rather than owning its own state, so the caller
 * decides what a keystroke means — the session-persisting hook debounces the
 * write, while a purely local field can keep the value in the caller.
 */
export function TextAreaField({ id, label, value, placeholder, hint, onInput }: TextAreaFieldProps) {
  return (
    <div class="flex flex-col gap-1">
      <label for={id} class="text-[10px] uppercase font-mono text-ink/40">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        onInput={(event) => onInput((event.currentTarget as HTMLTextAreaElement).value)}
        class="w-full min-h-20 resize-y bg-canvas border border-ink/15 rounded px-2.5 py-1.5 text-xs font-mono text-ink placeholder-ink/35 focus:outline-none focus:border-ink/40"
      />
      {hint ? <span class="text-[11px] text-ink/50">{hint}</span> : null}
    </div>
  );
}

interface ButtonProps {
  children: ComponentChildren;
  onClick: () => void;
  disabled?: boolean;
  /** The one action a panel wants the user to take. */
  variant?: 'default' | 'primary';
}

/** A button. */
export function Button({ children, onClick, disabled, variant = 'default' }: ButtonProps) {
  const tone =
    variant === 'primary'
      ? 'bg-ink text-canvas border-ink hover:opacity-90'
      : 'border-ink/15 hover:bg-ink/5 text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      class={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-default ${tone}`}
    >
      {children}
    </button>
  );
}

/** Centred placeholder for a panel with nothing to show. */
export function Empty({ children }: { children: ComponentChildren }) {
  return (
    <div class="h-full flex items-center justify-center px-6 text-center">
      <p class="text-xs text-ink/45 font-mono">{children}</p>
    </div>
  );
}

/** A message. `error` is the only chroma a panel should use. */
export function Note({ children, tone = 'default' }: { children: ComponentChildren; tone?: 'default' | 'error' }) {
  const colour = tone === 'error' ? 'text-error' : 'text-ink/60';
  return <p class={`text-[11px] ${colour}`}>{children}</p>;
}

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Render markdown through Kabmo's own pipeline.
 *
 * The pipeline itself is not in this package: it is Kabmo's marked /
 * KaTeX / mermaid / Shiki chain plus its file-opening and clipboard hooks, and
 * bundling it here would make every plugin carry a second copy of a large tree.
 * The host injects the component (`UiKitServices.markdown`), so a wiki page or
 * a plan reads exactly like the chat timeline without the kit owning any of it.
 *
 * A host that injects nothing renders the source as plain text rather than
 * failing: a panel showing raw markdown is degraded, not broken.
 */
export function Markdown({ content, className }: MarkdownProps) {
  const Renderer = uiKitServices()?.markdown?.() ?? null;
  if (!Renderer) return <pre class={`text-xs font-mono whitespace-pre-wrap ${className ?? ''}`}>{content}</pre>;
  return <Renderer content={content} className={className} />;
}

