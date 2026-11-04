import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { AlertCircle, Check, GitBranch, Loader2, Search } from 'lucide-preact';
import type { GitImportController } from '@/client/hooks/settings/skill-git-import';

interface GitImportPanelProps {
  controller: GitImportController;
  /** Called after a successful install so the pane can adopt the new list. */
  onInstalled: () => void;
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink/60">{label}</div>
      {children}
    </div>
  );
}

/**
 * The From Git tab: paste a repository, list its SKILL.md files, pick, install.
 *
 * The listing step is the point. `bunx skills add <repo>` installs without ever
 * saying what is inside, and a repository can hold twenty skills — so the choice,
 * the install target and the overwrite decision all happen before a single file
 * is written. The outcome stays on screen afterwards: the server reports a skip
 * per row with its reason, and a toast would have thrown that away.
 */
export function GitImportPanel({ controller, onInstalled }: GitImportPanelProps) {
  const [url, setUrl] = useState(controller.url);
  const { skills, selected, mode, overwrite } = controller;

  // A source card's Import button inspects without touching this field, so the
  // input follows the repository the controller actually used — otherwise the
  // list below would describe a repository the field does not name.
  useEffect(() => {
    if (controller.url) setUrl(controller.url);
  }, [controller.url]);

  const usable = skills.filter((skill) => skill.loadable && !skill.installed);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Field label="Repository">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <GitBranch size={14} className="absolute left-3 top-2.5 text-ink/40 pointer-events-none" />
              <input
                type="text"
                value={url}
                onInput={(event) => setUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void controller.inspect(url);
                }}
                placeholder="https://github.com/owner/repo  ·  owner/repo  ·  a local path"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs font-mono text-ink transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={() => void controller.inspect(url)}
              disabled={controller.inspecting || !url.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 text-xs font-medium text-ink hover:bg-ink/5 disabled:opacity-50 transition-colors cursor-pointer flex-shrink-0"
            >
              {controller.inspecting ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              <span>{controller.inspecting ? 'Cloning…' : 'Inspect'}</span>
            </button>
          </div>
        </Field>
        <p className="text-[11px] text-ink/50 leading-relaxed">
          Kabmo clones the repository into a temporary directory, reads every SKILL.md, and removes the clone when it is
          done. Nothing is written to your skills until you press Install.
        </p>
      </div>

      {controller.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-error/40 bg-error/5 px-3 py-2 text-[11px] text-error">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">{controller.error}</span>
        </div>
      ) : null}

      {skills.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink">
              {controller.repo} · {skills.length} SKILL.md
            </span>
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => controller.toggleAll(true)}
                className="text-ink/60 hover:text-ink cursor-pointer"
              >
                Select all
              </button>
              <span className="text-ink/25">·</span>
              <button
                type="button"
                onClick={() => controller.toggleAll(false)}
                className="text-ink/60 hover:text-ink cursor-pointer"
              >
                None
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-ink/15 divide-y divide-ink/10 max-h-72 overflow-auto scrollbar-overlay-container">
            {skills.map((skill) => {
              const isSelected = selected.includes(skill.path);
              const blocked = !skill.loadable ? 'no description — omp will not load it' : skill.installed ? 'already installed' : '';
              return (
                <label
                  key={skill.path}
                  className={`flex items-start gap-2.5 p-3 transition-colors ${
                    blocked ? 'opacity-55' : 'cursor-pointer hover:bg-ink/[0.03]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={Boolean(blocked)}
                    onChange={() => controller.toggle(skill.path)}
                    className={`${CHECKBOX_CLASS} mt-0.5 accent-ink cursor-pointer disabled:cursor-not-allowed`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-semibold font-mono text-ink truncate">{skill.name}</span>
                      {blocked ? <span className="text-[10px] text-ink/50 flex-shrink-0">{blocked}</span> : null}
                    </div>
                    <p className="text-[11px] text-ink/65 leading-relaxed line-clamp-2">
                      {skill.description || 'No description in the frontmatter.'}
                    </p>
                    <div className="text-[10px] text-ink/40 font-mono truncate mt-0.5">{skill.path}/SKILL.md</div>
                  </div>
                </label>
              );
            })}
          </div>

          {controller.notes.length > 0 ? (
            <ul className="text-[11px] text-ink/55 space-y-0.5 list-disc list-inside">
              {controller.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <div className="rounded-lg border border-ink/15 p-3 space-y-2.5">
            <Field label="Install into">
              <div className="flex flex-col sm:flex-row gap-2">
                {(
                  [
                    {
                      id: 'managed_copy' as const,
                      title: 'Managed copy',
                      detail: 'Kabmo owns the files — editable and deletable here.',
                    },
                    {
                      id: 'registry' as const,
                      title: 'Registry install',
                      detail: 'Through the skills CLI into ~/.agents/skills — updateable, read-only here.',
                    },
                  ]
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => controller.setMode(option.id)}
                    className={`flex-1 text-left px-2.5 py-2 rounded-lg border transition-colors cursor-pointer ${
                      mode === option.id ? 'border-ink bg-ink/5' : 'border-ink/20 hover:border-ink/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${mode === option.id ? 'bg-ink' : 'border border-ink/40'}`}
                      />
                      <span className="text-xs font-semibold text-ink">{option.title}</span>
                    </div>
                    <div className="text-[10px] text-ink/55 leading-relaxed mt-0.5">{option.detail}</div>
                  </button>
                ))}
              </div>
            </Field>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(event) => controller.setOverwrite(event.currentTarget.checked)}
                className={`${CHECKBOX_CLASS} mt-0.5 accent-ink cursor-pointer`}
              />
              <span className="text-[11px] text-ink/70 leading-relaxed">
                Replace skills that already have the same name
                <span className="block text-[10px] text-ink/45">
                  Off by default: an existing directory may hold your own edits.
                </span>
              </span>
            </label>
          </div>
        </div>
      ) : null}

      {controller.result ? (
        <div className="rounded-lg border border-ink/20 bg-ink/[0.03] p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Check size={13} />
            <span>
              {controller.result.installed.length} installed
              {controller.result.skipped.length > 0 ? ` · ${controller.result.skipped.length} skipped` : ''}
            </span>
          </div>
          {controller.result.installed.length > 0 ? (
            <div className="text-[11px] text-ink/70 font-mono">{controller.result.installed.join(', ')}</div>
          ) : null}
          <ul className="text-[11px] text-ink/60 space-y-0.5">
            {controller.result.skipped.map((entry) => (
              <li key={`${entry.name}-${entry.reason}`}>
                <span className="font-mono text-ink/80">{entry.name}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {skills.length > 0 ? (
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-ink/55">
            {selected.length} of {usable.length} installable selected
          </span>
          <button
            type="button"
            onClick={async () => {
              const result = await controller.install();
              if (result && result.installed.length > 0) onInstalled();
            }}
            disabled={selected.length === 0 || controller.installing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {controller.installing ? <Loader2 size={13} className="animate-spin" /> : null}
            <span>
              {controller.installing
                ? 'Installing…'
                : `Install ${selected.length} skill${selected.length === 1 ? '' : 's'}`}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
