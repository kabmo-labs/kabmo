import type { SkillItem } from '@/shared/types';

/** How a discovery source reads in a 16px-wide badge slot. */
export function sourceBadge(skill: SkillItem): string {
  const source = skill.source ?? '';
  if (source.startsWith('native:')) return 'omp';
  if (source.startsWith('agents:')) return 'agents';
  if (source.startsWith('claude:')) return 'claude';
  if (source.startsWith('codex:')) return 'codex';
  if (source.startsWith('github:')) return 'github';
  if (source.startsWith('opencode:')) return 'opencode';
  return source.split(':')[0] || 'other';
}

/** The one-line provenance shown under a row's name. */
export function scopeLabel(skill: SkillItem): string {
  if (skill.source?.endsWith(':project')) return 'project';
  if (skill.source?.endsWith(':user')) return 'user';
  return skill.location;
}

export type SkillFilter = 'all' | 'managed' | 'read-only' | 'hidden';

export const SKILL_FILTERS: Array<{ id: SkillFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'managed', label: 'Managed' },
  { id: 'read-only', label: 'Read-only' },
  { id: 'hidden', label: 'Hidden' },
];

/**
 * Apply the sidebar's search and filter.
 *
 * `managed` and `read-only` are the distinction that decides whether the detail
 * pane may offer a save, so they are filters rather than a note in the header: a
 * user hunting for the file they can edit should be able to hide the ones they
 * cannot.
 */
export function filterSkills(skills: SkillItem[], query: string, filter: SkillFilter): SkillItem[] {
  const needle = query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (filter === 'managed' && skill.managed !== true) return false;
    if (filter === 'read-only' && skill.managed === true) return false;
    if (filter === 'hidden' && skill.hidden !== true) return false;
    if (!needle) return true;
    return `${skill.name} ${skill.description} ${skill.source ?? ''}`.toLowerCase().includes(needle);
  });
}

/** Counts for the filter chips, over the unfiltered list. */
export function filterCounts(skills: SkillItem[]): Record<SkillFilter, number> {
  return {
    all: skills.length,
    managed: skills.filter((skill) => skill.managed === true).length,
    'read-only': skills.filter((skill) => skill.managed !== true).length,
    hidden: skills.filter((skill) => skill.hidden === true).length,
  };
}
