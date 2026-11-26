export type CommandScope = 'system' | 'user' | 'project';

/** Declarative subcommand of an oh-my-pi builtin (drives `/cmd <sub>` completion). */
export interface CommandSubcommand {
  name: string;
  description?: string;
  usage?: string;
}

export interface CommandItem {
  id: string;
  name: string;
  description: string;
  scope: CommandScope;
  /**
   * Markdown template. For a command backed by a file this is the file body
   * (`$ARGUMENTS`, `` !`shell` `` and `@file` are expanded by omp at run time);
   * for a builtin it is the literal `/name` token.
   */
  template: string;
  isBuiltIn?: boolean;
  /** Absolute path of the markdown command file backing this command, when it
   *  is one. Absent for a builtin, a skill, or an extension command. */
  filePath?: string;
  /** omp's discovery source: `builtin`, `skill`, `custom`, `extension`, `file`. */
  source?: string;
  /** True only for a markdown file under a root Kabmo owns
   *  (`~/.omp/agent/commands`, `<workspace>/.omp/commands`). Everything else —
   *  a builtin, a `.claude` command, an extension command — renders read-only
   *  and cannot be deleted through Kabmo. */
  managed?: boolean;
  /** oh-my-pi aliases (`/models` for `/model`); live agent commands only. */
  aliases?: string[];
  /** Declarative subcommands; live agent commands only. */
  subcommands?: CommandSubcommand[];
  /** Argument hint (`[on|off|status]`); live agent commands only. */
  inputHint?: string;
}
