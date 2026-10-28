import { useCallback } from 'preact/hooks';

export interface OpenFilePayload {
  path: string;
  name?: string;
  id?: number;
  content?: string;
  /** Absolute workspace root the path belongs to; the panel defaults it to the active project. */
  root?: string;
  /** Repo picked in the panel, relative to `root` — the path's own scope when set. */
  repo?: string;
  /**
   * The live handle a PWA launch opened this file through, when there is one.
   *
   * A launched file has NO path the server can reach — only a capability onto
   * it — so this id is what routes the tab's Save through `createWritable`
   * instead of `/api/fs/action`. See `client/lib/launch/file-handlers`.
   */
  handleId?: string;
  /**
   * True when the bytes came from the DEVICE rather than from the server (a
   * document the phone handed over). The tab renders and cannot be written back,
   * because there is no path to write to and no writable handle.
   */
  deviceFile?: boolean;
}

/**
 * Dispatches an event to open a file in the workspace editor.
 */
export function openFileInEditor(payloadOrPath: string | OpenFilePayload) {
  if (typeof window === 'undefined') return;

  const payload: OpenFilePayload = typeof payloadOrPath === 'string'
    ? { path: payloadOrPath }
    : payloadOrPath;

  const cleanPath = payload.path.replace(/^\/+/, '');
  const fileName = payload.name || cleanPath.split('/').pop() || 'file';

  window.dispatchEvent(
    new CustomEvent('omp:open-file', {
      detail: {
        path: cleanPath,
        name: fileName,
        id: payload.id,
        content: payload.content,
        root: payload.root,
        repo: payload.repo,
        handleId: payload.handleId,
        deviceFile: payload.deviceFile,
      }
    })
  );
}

/**
 * Hook providing a convenient callback to open files in editor.
 */
export function useOpenFile() {
  return useCallback((payloadOrPath: string | OpenFilePayload) => {
    openFileInEditor(payloadOrPath);
  }, []);
}
