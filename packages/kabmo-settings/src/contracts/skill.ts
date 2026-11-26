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

/**
 * A git repository offered as a skill source.
 *
 * There is deliberately no star count and no "last updated" here: Kabmo never
 * fetched either one, and the two used to be rendered from literals (`'1.2K'`,
 * `'Just now'`) — a panel stating a number no request produced. `skillCount` is
 * `null` until a scan of that repository reports a real one, and the card says
 * "Not scanned" rather than inventing a number.
 */
export interface SkillCatalogSource {
  id: string;
  name: string;
  repo: string;
  /** SKILL.md files found by the last scan, or null when never scanned. */
  skillCount: number | null;
  /** Epoch ms of the last successful scan, or null. */
  scannedAt?: number | null;
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
  /** Weekly downloads reported by the Skillshare registry; absent for a git-repo entry. */
  installs?: number;
}

/** One SKILL.md found inside a cloned repository. */
export interface GitSkillEntry {
  /** Repo-relative directory holding the SKILL.md, e.g. `skills/review-pr`. */
  path: string;
  name: string;
  description: string;
  /** False when omp would refuse to load it (no `description` in frontmatter). */
  loadable: boolean;
  /** A skill with this name is already installed, so a plain install skips it. */
  installed?: boolean;
}

/** What `inspect_git_repo` answers: the repository and the skills inside it. */
export interface GitRepoInspection {
  repo: string;
  /** Branch/tag the clone resolved, when git reported one. */
  ref?: string | null;
  skills: GitSkillEntry[];
  /** Notes worth showing (a scan hit its cap, a subtree was skipped, …). */
  notes: string[];
}

export interface GitSkillInstallResult {
  repo: string;
  installed: string[];
  skipped: Array<{ name: string; reason: string }>;
  /** The refreshed discovery list, so the pane needs no second round trip. */
  skills: SkillItem[];
}
