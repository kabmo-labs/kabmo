import { useEffect, useState } from 'preact/hooks';
import type { FormEvent, FunctionComponent } from 'preact/compat';
import { Check, Copy, Eye, EyeOff, Trash2 } from 'lucide-preact';
import type { CommandItem, CommandScope } from '@/shared/types';

interface CommandDetailPaneProps {
  command: CommandItem;
  isNew?: boolean;
  onSave: (updatedCommand: CommandItem) => void;
  onDelete?: (commandId: string) => void;
  /** Disabled for the project scope: there is no workspace to write it into. */
  projectScopeDisabled?: boolean;
}

/**
 * One command's detail pane.
 *
 * The three sections mirror what a command IS in oh-my-pi: a name, the scope
 * its file lives at, and a markdown template. The template is the whole
 * behavior — `$ARGUMENTS`, `` !`shell` `` and `@file` are expanded by omp when
 * the command runs — so the editor is the point of the pane, and the body is
 * what a save writes back into the file.
 *
 * A command backed by a file Kabmo does not own (a `.claude` or
 * `.agents` command, a builtin, a skill entry) renders read-only: its file
 * belongs to another tool and a save here would rewrite it.
 */
export const CommandDetailPane: FunctionComponent<CommandDetailPaneProps> = ({
  command,
  isNew = false,
  onSave,
  onDelete,
  projectScopeDisabled = false,
}) => {
  const [formData, setFormData] = useState<CommandItem>(command);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  // A LIVE command Kabmo does not own (a builtin, a `skill:<name>` entry,
  // an extension or a `.claude`/`.agents` file) renders read-only: its file, if
  // it has one, belongs to another tool. A Kabmo-store row and a brand-new
  // draft have no source and stay editable.
  const readOnly = !isNew && command.source != null && command.managed !== true;

  useEffect(() => {
    setFormData(command);
    setSavedSuccess(false);
  }, [command]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    onSave(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleCopyTemplate = () => {
    navigator.clipboard.writeText(formData.template);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 1800);
  };

  const handleInsertPlaceholder = (text: string) => {
    setFormData((prev) => ({
      ...prev,
      template: prev.template ? `${prev.template} ${text}` : text,
    }));
  };

  const lines = formData.template.split('\n');
  const lineCount = Math.max(lines.length, 6);

  return (
    <form onSubmit={handleSave} className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-6 md:p-8 space-y-6">
      {readOnly && (
        <div className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-[11px] text-ink/70 leading-relaxed">
          {formData.filePath ? (
            <>
              This command is provided by <span className="font-mono text-ink/80">{formData.source}</span> and is read-only here.
              Edit <span className="font-mono text-ink/80">{formData.filePath}</span> at its source, or create a command of your own
              under <span className="font-mono text-ink/80">~/.omp/agent/commands</span>.
            </>
          ) : (
            <>
              This is a <span className="font-mono text-ink/80">{formData.source ?? 'live'}</span> command built into the agent, not a
              file. It cannot be edited or deleted here — create a command with another name to extend it.
            </>
          )}
        </div>
      )}

      {/* SECTION 1: Identity */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
            Identity
          </h2>
          {readOnly && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-ink/5 border border-ink/10 text-ink/60">
              {formData.source ?? 'live'} · read-only
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Command Name
            </label>
            <div className="flex items-center border border-ink/20 hover:border-ink/40 focus-within:border-ink rounded-lg bg-paper transition-colors">
              <span className="px-3 py-2 font-mono text-xs text-ink/40 border-r border-ink/15 select-none">
                /
              </span>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    name: e.currentTarget.value.replace(/^\/+/, ''),
                  })
                }
                required
                placeholder="command-name"
                disabled={readOnly}
                className="w-full text-xs font-mono px-3 py-2 bg-transparent focus:outline-none disabled:opacity-60 text-ink"
              />
            </div>
          </div>

          <div className="w-40">
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Scope
            </label>
            <select
              value={formData.scope}
              onChange={(e) =>
                setFormData({ ...formData, scope: e.currentTarget.value as CommandScope })
              }
              disabled={readOnly || projectScopeDisabled}
              title={projectScopeDisabled ? 'Select a workspace folder to write a project command' : undefined}
              className="w-full text-xs py-2 px-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink disabled:opacity-60 text-ink transition-colors cursor-pointer"
            >
              <option value="user">user</option>
              {!projectScopeDisabled && <option value="project">project</option>}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink/80 mb-1.5">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.currentTarget.value })}
            disabled={readOnly}
            placeholder="What does this command do?"
            rows={2}
            className="w-full text-xs p-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink placeholder:text-ink/30 text-ink transition-colors disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink/80 mb-1.5">
            Argument Hint
          </label>
          <input
            type="text"
            value={formData.inputHint ?? ''}
            onChange={(e) => setFormData({ ...formData, inputHint: e.currentTarget.value })}
            disabled={readOnly}
            placeholder="[on|off|status]"
            className="w-full text-xs font-mono p-2.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink placeholder:text-ink/30 text-ink transition-colors disabled:opacity-60"
          />
          <p className="text-[11px] text-ink/60 mt-1">
            Shown as ghost text after <span className="font-mono">/{formData.name || 'name'}</span> in the composer.
          </p>
        </div>
      </div>

      <div className="border-t border-ink/10" />

      {/* SECTION 2: Command Template */}
      <div className="space-y-2 flex-1 flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-ink">
              Command Template
            </label>
            <p className="text-[11px] text-ink/60 mt-0.5">
              Use <code className="text-ink font-semibold font-mono">$ARGUMENTS</code>, <code className="text-ink font-semibold font-mono">!`shell`</code>, or <code className="text-ink font-semibold font-mono">@filename</code>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
              className="p-1 rounded-md text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
            >
              {showLineNumbers ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button
              type="button"
              onClick={handleCopyTemplate}
              className="flex items-center gap-1.5 text-xs text-ink/60 hover:text-ink transition-colors cursor-pointer"
            >
              {copiedTemplate ? <Check className="w-3.5 h-3.5 text-ink" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedTemplate ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Quick Insert Helper Buttons */}
        <div className="flex items-center gap-2 py-1">
          <button
            type="button"
            onClick={() => handleInsertPlaceholder('$ARGUMENTS')}
            disabled={readOnly}
            className="px-2.5 py-1 text-xs font-mono rounded-md bg-ink/5 hover:bg-ink/10 border border-ink/15 text-ink transition-colors cursor-pointer disabled:opacity-50"
          >
            +$ARGUMENTS
          </button>
          <button
            type="button"
            onClick={() => handleInsertPlaceholder('!`bun test`')}
            disabled={readOnly}
            className="px-2.5 py-1 text-xs font-mono rounded-md bg-ink/5 hover:bg-ink/10 border border-ink/15 text-ink transition-colors cursor-pointer disabled:opacity-50"
          >
            +!shell
          </button>
          <button
            type="button"
            onClick={() => handleInsertPlaceholder('@src/App.tsx')}
            disabled={readOnly}
            className="px-2.5 py-1 text-xs font-mono rounded-md bg-ink/5 hover:bg-ink/10 border border-ink/15 text-ink transition-colors cursor-pointer disabled:opacity-50"
          >
            +@filename
          </button>
        </div>

        <div className="flex rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 overflow-hidden flex-1 min-h-[140px] font-mono text-xs focus-within:border-ink transition-colors">
          {showLineNumbers && (
            <div className="w-10 py-3 pr-2 select-none text-right text-xs text-ink/30 border-r border-ink/10 bg-ink/[0.02] overflow-hidden leading-relaxed">
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <textarea
            value={formData.template}
            onChange={(e) => setFormData({ ...formData, template: e.currentTarget.value })}
            rows={Math.max(lineCount, 7)}
            disabled={readOnly}
            spellcheck={false}
            placeholder="Enter command template instructions..."
            className="flex-1 p-3 bg-transparent text-ink resize-none focus:outline-none leading-relaxed disabled:opacity-60"
          />
        </div>
      </div>

      {/* Footer Controls */}
      <div className="pt-3 border-t border-ink/10 flex items-center justify-between">
        <div>
          {!readOnly && !isNew && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(formData.id)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 hover:border-error hover:text-error text-ink/70 text-xs font-medium transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Command
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {savedSuccess && (
            <span className="flex items-center gap-1 text-xs text-ink font-medium">
              <Check className="w-3.5 h-3.5" />
              Saved successfully
            </span>
          )}
          {!readOnly && (
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer"
            >
              {isNew ? 'Create Command' : 'Save Command'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
};
