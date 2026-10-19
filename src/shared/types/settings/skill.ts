export type SkillLocation = 'user' | 'project';

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  location: SkillLocation;
  locationLabel?: string;
  group?: string;
  /**
   * The SKILL.md body for a skill Kabmo owns (`managed`), or the file
   * path for a read-only one — where the settings pane shows the source
   * location instead of an editor it must not save through.
   */
  instructions: string;
  project: string;
  /** Absolute path of the SKILL.md backing this skill. */
  filePath?: string;
  /** omp's discovery source, e.g. `native:user`, `agents:project`. */
  source?: string;
  /** Kabmo-owned: editable and deletable through the settings pane. */
  managed?: boolean;
  /** Excluded from the model's `<skills>` listing (`hide` / disableModelInvocation). */
  hidden?: boolean;
  isInstalledFromCatalog?: boolean;
  catalogSource?: string;
}

export interface SkillCatalogSource {
  id: string;
  name: string;
  repo: string;
  stars: string;
  updatedAt: string;
  skillCount: number;
  isCustom?: boolean;
}

export interface CatalogSkillItem {
  id: string;
  sourceId: string;
  name: string;
  description: string;
  repoTag: string;
  githubUrl?: string;
  instructions?: string;
  installed?: boolean;
}
