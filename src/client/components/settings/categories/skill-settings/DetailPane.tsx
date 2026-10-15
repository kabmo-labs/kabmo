import { useEffect, useState } from 'preact/hooks';
import { Check, Eye, EyeOff, Info, RefreshCw, Save, Sparkles, Trash2, User } from 'lucide-preact';
import type { SkillItem } from '@/shared/types';

interface SkillDetailPaneProps {
  skill: SkillItem | null;
  isCreatingNew: boolean;
  onSave: (skillData: Partial<SkillItem>) => void;
  onDelete?: (id: string) => void;
  onOpenCatalog?: () => void;
  onReload?: () => void;
  isReloading?: boolean;
  /** Disabled when no workspace is selected: there is no `.omp/skills` to
   *  write a project skill into. */
  projectScopeDisabled?: boolean;
  /**
   * Root a NEW skill lands in, from the scope the panel is showing. Without
   * this a create made while a workspace is selected wrote to the user root —
   * the skill then appeared in a list the panel was not showing, and the
   * workspace's own `.omp/skills` never received it.
   */
  defaultLocation?: 'user' | 'project';
}

export function SkillDetailPane({
  skill,
  isCreatingNew,
  onSave,
  onDelete,
  onOpenCatalog,
  onReload,
  isReloading = false,
  projectScopeDisabled = false,
  defaultLocation = 'user',
}: SkillDetailPaneProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<'user' | 'project'>('user');
  const [locationLabel, setLocationLabel] = useState('User / omp agent');
  const [instructions, setInstructions] = useState('');
  const [hidden, setHidden] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  // A skill the chamber does not own (a Claude plugin, a registry package) is
  // shown read-only: its file belongs to another tool, and a save here would
  // rewrite it. `managed` is absent on a brand-new draft, which is editable.
  const readOnly = !isCreatingNew && skill != null && skill.managed !== true;

  useEffect(() => {
    if (isCreatingNew || !skill) {
      setName('new-skill');
      setDescription('');
      setLocation(defaultLocation);
      setLocationLabel(defaultLocation === 'project' ? 'Project / .omp/skills' : 'User / omp agent');
      setInstructions(`---
description: ""
---
`);
      setHidden(false);
    } else {
      setName(skill.name);
      setDescription(skill.description);
      setLocation(skill.location);
      setLocationLabel(skill.locationLabel || 'User / omp agent');
      setInstructions(skill.instructions);
      setHidden(skill.hidden === true);
    }
  }, [skill, isCreatingNew, defaultLocation]);

  const handleSave = () => {
    onSave({
      name: name.trim() || 'unnamed-skill',
      description: description.trim(),
      location,
      locationLabel,
      instructions,
      hidden,
    });
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  const lines = instructions.split('\n');
  const lineCount = Math.max(lines.length, 6);

  return (
    <div className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-6 md:p-8 space-y-6">
      {/* Pane Header */}
      <div className="flex items-start justify-between pb-4 border-b border-ink/10 gap-4">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-ink">
            {isCreatingNew ? 'New Skill' : name}
          </h2>
          <p className="text-xs text-ink/60 mt-0.5">
            {isCreatingNew ? 'Configure a new skill' : `Configure skill details and prompt rules · ${locationLabel}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onReload && (
            <button
              type="button"
              onClick={onReload}
              disabled={isReloading}
              title="Re-discover skills in the running agents"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={isReloading ? 'animate-spin text-ink/70' : 'text-ink/70'} />
              <span>Reload</span>
            </button>
          )}
          {onOpenCatalog && (
            <button
              type="button"
              onClick={onOpenCatalog}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer"
            >
              <Sparkles size={14} className="text-ink/70" />
              <span>Browse Catalog</span>
            </button>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-2 text-[11px] text-ink/70 leading-relaxed">
          This skill is provided by <span className="font-mono text-ink/80">{skill?.source}</span> and is read-only here.
          Edit <span className="font-mono text-ink/80">{skill?.filePath}</span> at its source, or install a copy into
          {' '}<span className="font-mono text-ink/80">~/.omp/agent/skills</span> to own it.
        </div>
      )}

      {/* Basic Information Section */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
          Basic Information
        </h3>

        {/* Skill Name & Location */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <label className="text-xs font-semibold text-ink/80">
              Skill Name & Location
            </label>
            <div className="group relative">
              <Info size={13} className="text-ink/40 cursor-help" />
              <div className="absolute left-0 top-5 hidden group-hover:block w-64 p-2 rounded-lg bg-ink text-paper text-[11px] shadow-lg z-20 pointer-events-none leading-relaxed">
                Unique identifier and runtime execution scope for this skill. A project skill is written under
                {' '}<span className="font-mono">&lt;workspace&gt;/.omp/skills</span>.
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              disabled={readOnly}
              placeholder="skill-name"
              className="flex-1 px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs font-mono text-ink transition-colors disabled:opacity-60"
            />
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-ink/20 bg-ink/5 text-xs text-ink/80 flex-shrink-0">
              <User size={14} className="text-ink/60" />
              <span>{locationLabel}</span>
            </div>
          </div>

          {/* Scope selector: only a chamber-managed skill can move roots, and
              the project scope needs a workspace to land in. */}
          {!readOnly && (
            <div className="flex items-center gap-2 mt-2">
              {(['user', 'project'] as const).map((scope) => {
                const disabled = scope === 'project' && projectScopeDisabled;
                return (
                  <button
                    key={scope}
                    type="button"
                    disabled={disabled}
                    title={disabled ? 'Select a workspace folder to write a project skill' : undefined}
                    onClick={() => {
                      setLocation(scope);
                      setLocationLabel(scope === 'user' ? 'User / omp agent' : 'Project / .omp/skills');
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      location === scope ? 'bg-ink text-paper' : 'border border-ink/20 text-ink/70 hover:bg-ink/5'
                    }`}
                  >
                    {scope === 'user' ? 'User scope' : 'Project scope'}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <label className="text-xs font-semibold text-ink/80">
              Description <span className="text-error">*</span>
            </label>
            <div className="group relative">
              <Info size={13} className="text-ink/40 cursor-help" />
              <div className="absolute left-0 top-5 hidden group-hover:block w-64 p-2 rounded-lg bg-ink text-paper text-[11px] shadow-lg z-20 pointer-events-none leading-relaxed">
                Short description helping autonomous agents decide when to invoke this skill. Required — omp does not
                load a SKILL.md without one.
              </div>
            </div>
          </div>

          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            disabled={readOnly}
            placeholder="Brief description of what this skill does..."
            className="w-full px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs text-ink transition-colors resize-none leading-relaxed disabled:opacity-60"
          />
        </div>

        {/* Model invocation toggle */}
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hidden}
            disabled={readOnly}
            onChange={(e) => setHidden(e.currentTarget.checked)}
            className="mt-0.5 accent-ink cursor-pointer"
          />
          <span className="text-xs text-ink/80 leading-relaxed">
            Hide from the model&apos;s skill listing
            <span className="block text-[11px] text-ink/50">
              The skill stays runnable via <span className="font-mono">/skill:{name || 'name'}</span>; it is only kept out
              of the automatic skill catalog the model sees.
            </span>
          </span>
        </label>
      </div>

      {/* Instructions Section */}
      <div className="space-y-2 pt-2 border-t border-ink/10">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
            Instructions
          </h3>
          <button
            type="button"
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            title={showLineNumbers ? 'Hide Line Numbers' : 'Show Line Numbers'}
            className="p-1 rounded-md text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            {showLineNumbers ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        </div>

        {/* Code Editor */}
        <div className="rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 overflow-hidden flex flex-col font-mono text-xs focus-within:border-ink transition-colors">
          <div className="flex">
            {showLineNumbers && (
              <div className="w-10 py-3 pr-2 select-none text-right font-mono text-xs text-ink/30 border-r border-ink/10 bg-ink/[0.02] overflow-hidden leading-relaxed">
                {Array.from({ length: lineCount }).map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
            )}
            <textarea
              rows={Math.max(lineCount, 8)}
              value={instructions}
              onChange={(e) => setInstructions(e.currentTarget.value)}
              disabled={readOnly}
              spellcheck={false}
              className="flex-1 p-3 bg-transparent text-ink font-mono text-xs leading-relaxed resize-none focus:outline-none overflow-y-auto disabled:opacity-60"
              placeholder="Type markdown instructions..."
            />
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="pt-4 border-t border-ink/10 flex items-center justify-between">
        {!isCreatingNew && skill && onDelete && !readOnly ? (
          <button
            type="button"
            onClick={() => onDelete(skill.id)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 hover:border-error hover:text-error text-ink/70 text-xs font-medium transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
            <span>Delete Skill</span>
          </button>
        ) : (
          <div />
        )}

        {!readOnly && (
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer"
          >
            {savedToast ? <Check size={14} /> : <Save size={14} />}
            <span>{savedToast ? 'Saved' : isCreatingNew ? 'Create Skill' : 'Save Changes'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
