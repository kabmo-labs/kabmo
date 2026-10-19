import type { ThemeId } from '@/shared/lib/theme/catalog';

/** Wire protocol for the live agent event stream (chat timeline). */
export type SettingsCategoryId =
  // KABMO
  | 'appearance'
  | 'chats'
  | 'notifications'
  | 'usage'
  | 'token-usage'
  /** Panel plugins — Kabmo's own extension surface (marketplaces of
   *  sandboxed panel views). Deliberately NOT under LIBRARY, which holds omp's
   *  plugins: these are Kabmo surfaces omp has no concept of. */
  | 'panel-plugins'
  // WORKSPACE
  | 'projects'
  // OMP
  | 'omp'
  | 'providers'
  | 'agents'
  | 'behavior'
  | 'commands'
  | 'mcp'
  // LIBRARY
  | 'plugins'
  | 'skills'
  | 'skills-catalog';

export interface SettingsCategoryItem {
  id: SettingsCategoryId;
  label: string;
  iconName: string;
  badge?: string;
  section: 'KABMO' | 'WORKSPACE' | 'OMP' | 'LIBRARY';
  description?: string;
}

export interface SettingsState {
  /** Palette id from the theme catalog (`shared/lib/theme/catalog.ts`). Typed
   *  as the catalog's own id union, so a theme dropped from it breaks the build
   *  here rather than rendering unstyled at runtime. */
  theme: ThemeId;
  /**
   * Font family the code editors are set in (`EDITOR_FONT_FAMILIES` in
   * `shared/lib/code/editor/typography.ts`). The value is a CSS family name the
   * editor puts FIRST in its stack, so a face the device does not have falls
   * through to the bundled Fira Code and then to the generic — a setting that
   * cannot render a broken editor, only a different one.
   */
  editorFont: string;
  /** Generate a session title from the first run. omp suppresses its
   *  own auto-titling under `--mode rpc-ui` (PI_NO_TITLE), so without this a
   *  Kabmo session keeps its `New Session - <timestamp>` placeholder. Asked
   *  once when the first user message settles, retried once at that run's end;
   *  a later run never re-titles it — and a user-set name is never overwritten. */
  autoSessionTitle: boolean;
  soundAlerts: boolean;
  chatCompletionSound: boolean;
  /**
   * Whether Kabmo's goal loop runs at all: an independent auditor decides
   * after every finished turn whether the goal continues. Off means a goal
   * still exists (the strip, pause/resume and the objective all work) but
   * nothing advances it on its own.
   */
  goalAuditEnabled: boolean;
  /**
   * Model the goal auditor asks, as `provider/modelId`. Empty means the
   * session's own model — the honest default, since the goal loop is otherwise
   * invisible in a user's provider choice.
   */
  goalAuditModel: string;
  /**
   * Token budget a NEW goal is created with when the composer's dialog leaves
   * the field empty. Null = no budget (the turn ceiling is then the only stop).
   */
  goalDefaultBudget: number | null;
  followUpBehavior: 'queue' | 'steering';
  keybindingSend: 'Enter' | 'Shift + Enter' | 'Ctrl / Cmd + Enter';
  keybindingNewLine: 'Enter' | 'Shift + Enter' | 'Ctrl / Cmd + Enter';
  keybindingSteering: 'Enter' | 'Shift + Enter' | 'Ctrl / Cmd + Enter';
}
