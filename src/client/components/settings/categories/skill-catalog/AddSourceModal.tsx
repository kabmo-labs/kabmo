import { useState } from 'preact/hooks';
import type { FormEvent } from 'preact/compat';
import { AlertCircle, GitBranch, Plus, X } from 'lucide-preact';
import type { SkillCatalogSource } from '@/shared/types';

interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSource: (source: SkillCatalogSource) => void;
}

export function AddSourceModal({ isOpen, onClose, onAddSource }: AddSourceModalProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanRepo = repoUrl.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');

    if (!cleanRepo) {
      setError('Please provide a valid GitHub repository path (e.g. owner/repo).');
      return;
    }

    const name = sourceName.trim() || cleanRepo.split('/')[1] || cleanRepo;

    const newSource: SkillCatalogSource = {
      id: `custom-${Date.now()}`,
      name,
      repo: cleanRepo,
      stars: '1.2K',
      updatedAt: 'Just now',
      skillCount: 3,
      isCustom: true,
    };

    onAddSource(newSource);
    setRepoUrl('');
    setSourceName('');
    setError(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-paper border border-ink/20 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 text-ink animate-in fade-in zoom-in-95 duration-150 max-h-full overflow-y-auto scrollbar-overlay-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-ink/10">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-ink/70" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
              Add Custom Skill Source
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-ink/70 leading-relaxed">
          Connect any public or private Git repository containing skill definitions and prompt directives.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Source Name
            </label>
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.currentTarget.value)}
              placeholder="e.g. Acme Internal Skills"
              className="w-full px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs text-ink transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink/80 mb-1.5">
              Git Repository <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.currentTarget.value);
                setError(null);
              }}
              placeholder="e.g. owner/skills-repo or https://github.com/..."
              className="w-full px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs font-mono text-ink transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-error p-2.5 rounded-lg bg-error/10 border border-error/20">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <div className="pt-3 border-t border-ink/10 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-ink/20 hover:border-ink/40 text-xs font-medium text-ink/80 hover:text-ink transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Source</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
