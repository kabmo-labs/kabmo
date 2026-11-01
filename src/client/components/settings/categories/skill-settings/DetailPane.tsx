import { useEffect, useMemo, useState } from 'preact/hooks';
import { Info } from 'lucide-preact';
import type { SkillItem } from '@/shared/types';
import { SkillDetailHeader } from '@/client/components/settings/categories/skill-settings/DetailHeader';
import { InstructionsEditor } from '@/client/components/settings/categories/skill-settings/InstructionsEditor';

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

function draftBody(instructions: string): string {
  // The pane owns the frontmatter, so a saved body must not carry a second copy
  // of it — `writeSkillFile` serialises `name`/`description`/`hidden` itself and
  // a body that repeats them produced a SKILL.md with two frontmatter blocks.
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(instructions);
  return (match ? instructions.slice(match[0].length) : instructions).replace(/^\r?\n/, '');
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
  const [instructions, setInstructions] = useState('');
  const [hidden, setHidden] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  const readOnly = !isCreatingNew && skill != null && skill.managed !== true;
  const locationLabel = location === 'project' ? 'Project / .omp/skills' : 'User / omp agent';

  useEffect(() => {
    setConfirmingDelete(false);
    if (isCreatingNew || !skill) {
      setName('');
      setDescription('');
      setLocation(defaultLocation);
      setInstructions('');
      setHidden(false);
      return;
    }
    setName(skill.name);
    setDescription(skill.description);
    setLocation(skill.location);
    setInstructions(draftBody(skill.instructions));
    setHidden(skill.hidden === true);
  }, [skill, isCreatingNew, defaultLocation]);

  const dirty = useMemo(() => {
    if (isCreatingNew) return name.trim().length > 0 || description.trim().length > 0 || instructions.trim().length > 0;
    if (!skill) return false;
    return (
      name !== skill.name ||
      description !== skill.description ||
      location !== skill.location ||
      hidden !== (skill.hidden === true) ||
      instructions !== draftBody(skill.instructions)
    );
  }, [isCreatingNew, skill, name, description, location, hidden, instructions]);

  const validationError = useMemo(() => {
    if (readOnly) return null;
    const trimmed = name.trim();
    if (!trimmed) return 'A skill needs a name — it becomes the directory name and the /skill:<name> command.';
    if (/[\\/]/.test(trimmed)) return 'A skill name cannot contain a path separator.';
    if (!description.trim()) {
      return 'A description is required: omp does not load a SKILL.md without one, so this skill would never run.';
    }
    return null;
  }, [name, description, readOnly]);

  const handleSave = () => {
    if (readOnly || validationError) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      location,
      locationLabel,
      instructions: draftBody(instructions),
      hidden,
    });
    setSavedAt(Date.now());
  };

  return (
    <div className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-5 md:p-6 space-y-4">
      <SkillDetailHeader
        skill={skill}
        isCreatingNew={isCreatingNew}
        name={name}
        locationLabel={locationLabel}
        dirty={dirty}
        validationError={validationError}
        readOnly={readOnly}
        hidden={hidden}
        isReloading={isReloading}
        confirmingDelete={confirmingDelete}
        {...(onReload ? { onReload } : {})}
        {...(onOpenCatalog ? { onOpenCatalog } : {})}
        onHiddenChange={setHidden}
        onRequestDelete={() => setConfirmingDelete(true)}
        onCancelDelete={() => setConfirmingDelete(false)}
        onConfirmDelete={() => {
          setConfirmingDelete(false);
          if (skill && onDelete) onDelete(skill.id);
        }}
        onSave={handleSave}
      />

      {!readOnly ? (
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label htmlFor="skill-name" className="text-[11px] font-semibold text-ink/80">
                Name
              </label>
              <span className="group relative">
                <Info size={11} className="text-ink/35 cursor-help" />
                <span className="absolute left-0 top-4 hidden group-hover:block w-60 p-2 rounded-lg bg-ink text-paper text-[10px] shadow-lg z-20 pointer-events-none leading-relaxed">
                  Unique identifier and execution scope. A project skill is written under{' '}
                  <span className="font-mono">&lt;workspace&gt;/.omp/skills</span>.
                </span>
              </span>
            </div>
            <input
              id="skill-name"
              type="text"
              value={name}
              onInput={(event) => setName(event.currentTarget.value)}
              placeholder="skill-name"
              className="w-full px-2.5 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs font-mono text-ink transition-colors"
            />
          </div>

          <div>
            <label htmlFor="skill-description" className="block text-[11px] font-semibold text-ink/80 mb-1">
              Description <span className="text-error">*</span>
            </label>
            <textarea
              id="skill-description"
              rows={2}
              value={description}
              onInput={(event) => setDescription(event.currentTarget.value)}
              placeholder="When should the agent use this skill?"
              className="w-full px-2.5 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs text-ink transition-colors resize-none leading-relaxed"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-ink/80">Scope</span>
            {(['user', 'project'] as const).map((scope) => {
              const disabled = scope === 'project' && projectScopeDisabled;
              return (
                <button
                  key={scope}
                  type="button"
                  disabled={disabled}
                  title={disabled ? 'Select a workspace folder to write a project skill' : undefined}
                  onClick={() => setLocation(scope)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    location === scope ? 'bg-ink text-paper' : 'border border-ink/20 text-ink/70 hover:bg-ink/5'
                  }`}
                >
                  {scope === 'user' ? 'User' : 'Project'}
                </button>
              );
            })}
            <span className="text-[10px] text-ink/45 font-mono truncate">{locationLabel}</span>
          </div>
        </div>
      ) : null}

      <InstructionsEditor
        value={instructions}
        onChange={setInstructions}
        readOnly={readOnly}
        showLineNumbers={showLineNumbers}
        onToggleLineNumbers={() => setShowLineNumbers(!showLineNumbers)}
      />

      {savedAt > 0 && !dirty ? (
        <p className="text-[10px] text-ink/40">
          Last saved {new Date(savedAt).toLocaleTimeString()} — omp sessions were told to reload their skills.
        </p>
      ) : null}
    </div>
  );
}
