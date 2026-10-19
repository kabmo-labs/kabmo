/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The add/edit dialog for a user's own command.
 *
 * ## Why the dialog shell is written here
 *
 * Kabmo's own modals sit on `src/client/components/common/Modal.tsx`, and
 * a plugin bundle cannot import Kabmo source — `@/…` does not resolve in it.
 * So the shell is reproduced with the same classes and the same ARIA pair
 * (`role="dialog"` + `aria-modal`), which is what makes it read as one of the
 * app's dialogs to a screen reader rather than as a floating div.
 *
 * ## The two fields that decide what actually runs
 *
 * **Scope** is `global` or `repo`, and the difference is real rather than
 * cosmetic: a global command is offered in every workspace, a repo one only under
 * the workspace it was created in. Both are needed — a lint wrapper is the same
 * command everywhere, while `deploy staging` names a directory that exists in one
 * checkout.
 *
 * **Directory** is stored RELATIVE to the workspace root. A `package.json` script
 * in a monorepo only resolves when the cwd is its own directory, and a user who
 * opens this dialog while browsing `packages/api` means that directory. Storing
 * the absolute path instead would break the moment the workspace moved.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import type { CustomCommand, CustomScope } from '../protocol';

export interface CustomFormProps {
  /** The command being edited, or null for a new one. */
  editing: CustomCommand | null;
  /** The workspace root a `repo` command would belong to, or null. */
  root: string | null;
  /** The repo-relative directory the panel is currently scoped to. */
  defaultCwd: string;
  onCancel: () => void;
  onSubmit: (input: { command: string; scope: CustomScope; cwd: string; previousId: string | null }) => void;
  /** The server's refusal, when the last submit was rejected. */
  error: string | null;
}

export function CustomForm({ editing, root, defaultCwd, onCancel, onSubmit, error }: CustomFormProps) {
  const [command, setCommand] = useState(editing?.command ?? '');
  // A new command defaults to the workspace it was created in: that is the more
  // specific of the two and the safer default — a global command is offered
  // everywhere, so it is the one that should take a deliberate click.
  const [scope, setScope] = useState<CustomScope>(editing?.scope ?? (root ? 'repo' : 'global'));
  const [cwd, setCwd] = useState(editing?.cwd ?? (defaultCwd || '.'));
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus lands in the field the dialog exists for, so the user types rather
  // than tabs. Preact runs effects after paint, which is what makes the ref set.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = command.trim();
  /**
   * The refusals the SERVER would apply, applied here first so the button says
   * why instead of the request coming back with a sentence.
   *
   * There is deliberately NO newline check here, and that is not an omission: the
   * field is `<input type="text">`, and the HTML value sanitization algorithm
   * strips newlines from a single-line input — so a pasted two-line command
   * arrives as one line and the branch would be unreachable code. The SERVER keeps
   * the check, because an RPC caller is not a browser and can send anything.
   */
  const reason = !trimmed
    ? 'Type the command to run.'
    : scope === 'repo' && !root
      ? 'This workspace has no root to scope the command to.'
      : null;

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
      }}
      onClick={onCancel}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit command' : 'Add command'}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (reason) return;
          onSubmit({
            command: trimmed,
            scope,
            cwd: cwd.trim() || '.',
            previousId: editing?.id ?? null,
          });
        }}
        className="bg-paper border border-ink/15 rounded-xl shadow-2xl w-full max-w-md max-h-full flex flex-col overflow-hidden text-ink"
      >
        <div className="px-5 py-4 border-b border-ink/10 flex-shrink-0">
          <h2 className="text-sm font-semibold text-ink">{editing ? 'Edit command' : 'Add command'}</h2>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3 min-h-0 overflow-y-auto scrollbar-overlay-container">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-ink/40">Command</span>
            <input
              ref={inputRef}
              type="text"
              value={command}
              placeholder="bun run build"
              onInput={(event) => setCommand((event.currentTarget as HTMLInputElement).value)}
              className="w-full bg-canvas border border-ink/15 rounded px-2.5 py-1.5 text-xs font-mono text-ink placeholder-ink/35 focus:outline-none focus:border-ink/40"
            />
            {/* The shell is named because it decides what the text may contain:
                a pipe, a `&&` and a variable all work, and a user who expected
                argv semantics would be surprised that they do. */}
            <span className="text-[11px] text-ink/50">Runs through `sh -c`, so pipes and `&amp;&amp;` work.</span>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-[10px] uppercase font-mono text-ink/40">Available in</legend>
            {/* Native radios, not buttons with `aria-pressed`: a mutually
                exclusive choice is what a radio group IS, and the platform then
                gives arrow-key navigation, one Tab stop and the right
                announcement without any of it being re-implemented. */}
            <div className="flex flex-col gap-1">
              <ScopeChoice
                name="command-runner-scope"
                value="repo"
                checked={scope === 'repo'}
                disabled={!root}
                label="This workspace"
                hint={root ?? 'No workspace folder is active.'}
                onSelect={() => setScope('repo')}
              />
              <ScopeChoice
                name="command-runner-scope"
                value="global"
                checked={scope === 'global'}
                label="Every workspace"
                hint="Offered in every repository you open."
                onSelect={() => setScope('global')}
              />
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-ink/40">Directory</span>
            <input
              type="text"
              value={cwd}
              placeholder="."
              onInput={(event) => setCwd((event.currentTarget as HTMLInputElement).value)}
              className="w-full bg-canvas border border-ink/15 rounded px-2.5 py-1.5 text-xs font-mono text-ink placeholder-ink/35 focus:outline-none focus:border-ink/40"
            />
            <span className="text-[11px] text-ink/50">Relative to the workspace root. `.` is the root itself.</span>
          </label>

          {error ? <p className="text-[11px] text-error">{error}</p> : null}
        </div>

        <div className="px-5 py-3 border-t border-ink/10 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-ink/15 text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={reason !== null}
            title={reason ?? (editing ? 'Save this command' : 'Add this command')}
            className="px-3 py-1.5 text-xs rounded border border-ink bg-ink text-canvas hover:opacity-90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {editing ? 'Save' : 'Add'}
          </button>
        </div>

      </form>
    </div>
  );
}

/** One radio row of the scope choice. The whole row is the label, so a click
 * anywhere on it selects — a bare radio beside text leaves the words inert. */
function ScopeChoice({
  name,
  value,
  checked,
  disabled,
  label,
  hint,
  onSelect,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <label
      title={disabled ? hint : undefined}
      className={`w-full flex items-start gap-2 px-2.5 py-2 rounded border transition-colors ${
        disabled ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-ink/5'
      } ${checked ? 'border-ink/40 bg-ink/5' : 'border-ink/15'}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 flex-shrink-0 accent-ink"
      />
      <span className="flex flex-col min-w-0">
        <span className="text-xs text-ink">{label}</span>
        <span className="text-[11px] text-ink/50 truncate" title={hint}>
          {hint}
        </span>
      </span>
    </label>
  );
}
