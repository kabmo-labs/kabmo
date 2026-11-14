import { useCallback, useState } from 'preact/hooks';
import type { GitRepoInspection, GitSkillEntry, GitSkillInstallResult } from '@/shared/types';

export interface GitImportState {
  inspecting: boolean;
  installing: boolean;
  /** The repository as the last successful inspection named it. */
  repo: string | null;
  url: string;
  skills: GitSkillEntry[];
  notes: string[];
  /** Repo-relative paths the user ticked. */
  selected: string[];
  overwrite: boolean;
  error: string | null;
  result: GitSkillInstallResult | null;
}

export interface GitImportController extends GitImportState {
  inspect: (url: string) => Promise<void>;
  toggle: (path: string) => void;
  toggleAll: (select: boolean) => void;
  setOverwrite: (overwrite: boolean) => void;
  install: () => Promise<GitSkillInstallResult | null>;
  reset: () => void;
}

const INITIAL: GitImportState = {
  inspecting: false,
  installing: false,
  repo: null,
  url: '',
  skills: [],
  notes: [],
  selected: [],
  overwrite: false,
  error: null,
  result: null,
};

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/settings/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

/**
 * The From-Git pane's state machine: inspect a repository, pick skills, install.
 *
 * Every entry starts TICKED except the ones the server already reported as
 * installed or unloadable — the common case is "install everything in this
 * repository", and a row that would be skipped anyway is better pre-unticked than
 * reported as a failure after the click.
 *
 * `install` never clears `result`: the dialog renders the outcome (installed and
 * skipped, with the server's reason per row) instead of a toast that closes the
 * only place the reasons could be read.
 */
export function useSkillGitImport(): GitImportController {
  const [state, setState] = useState<GitImportState>(INITIAL);

  const inspect = useCallback(async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setState((prev) => ({ ...prev, error: 'Paste a repository URL first.' }));
      return;
    }
    setState((prev) => ({ ...prev, inspecting: true, error: null, result: null, url: trimmed }));
    try {
      const inspection = await post<GitRepoInspection & { repo: string }>({ type: 'inspect_git_repo', url: trimmed });
      const installable = inspection.skills.filter((skill) => skill.loadable && !skill.installed);
      setState((prev) => ({
        ...prev,
        inspecting: false,
        repo: inspection.repo,
        url: trimmed,
        skills: inspection.skills,
        notes: inspection.notes ?? [],
        selected: installable.map((skill) => skill.path),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        inspecting: false,
        skills: [],
        selected: [],
        repo: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const toggle = useCallback((path: string) => {
    setState((prev) => ({
      ...prev,
      selected: prev.selected.includes(path)
        ? prev.selected.filter((entry) => entry !== path)
        : [...prev.selected, path],
    }));
  }, []);

  const toggleAll = useCallback((select: boolean) => {
    setState((prev) => ({
      ...prev,
      selected: select
        ? prev.skills.filter((skill) => skill.loadable && !skill.installed).map((skill) => skill.path)
        : [],
    }));
  }, []);

  const setOverwrite = useCallback((overwrite: boolean) => {
    setState((prev) => ({ ...prev, overwrite }));
  }, []);

  const install = useCallback(async () => {
    if (state.selected.length === 0 || !state.url) return null;
    setState((prev) => ({ ...prev, installing: true, error: null, result: null }));
    try {
      const result = await post<GitSkillInstallResult>({
        type: 'install_git_skills',
        url: state.url,
        paths: state.selected,
        overwrite: state.overwrite,
      });
      setState((prev) => ({ ...prev, installing: false, result }));
      return result;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
  }, [state.selected, state.url, state.overwrite]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, inspect, toggle, toggleAll, setOverwrite, install, reset };
}
