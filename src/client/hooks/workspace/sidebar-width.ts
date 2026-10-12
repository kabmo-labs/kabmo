/**
 * The session sidebar's width, as the desktop layout reads it.
 *
 * Backed by the GLOBAL `app_settings.omp_sidebar_width` (see
 * `shared/lib/workspace/sidebar-width.ts`) rather than the per-session
 * `layout.panelWidths` map: the sidebar lists the same sessions in every chat, so
 * a width that moved when the user picked a different session read as the layout
 * jumping on its own.
 *
 * The width is read synchronously from the primed settings snapshot, so the first
 * render already has the right value. The effect below retires the old slot: a
 * blob written while the sidebar still lived in `layout.panelWidths` carries a
 * `left`, which is handed to the migration once and then deleted, so the stored
 * state stops holding a second answer for a question that now has one home.
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { PANEL_WIDTHS_KEY } from '@/client/hooks/workspace/panel-widths';
import { getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { resolveSidebarWidth, saveSidebarWidth } from '@/shared/lib/workspace/sidebar-width';

export function useSidebarWidth(): [number, (px: number) => void] {
  const { sessionId, ready } = useSessionStateContext();
  const [width, setWidth] = useState(() => resolveSidebarWidth());

  useEffect(() => {
    if (!ready) return;
    const stored = getSessionValue<Record<string, unknown>>(sessionId, PANEL_WIDTHS_KEY);
    const retired = stored?.left;
    if (retired === undefined) return;
    setWidth(resolveSidebarWidth(retired));
    const rest = { ...stored };
    delete rest.left;
    setSessionKey(sessionId, PANEL_WIDTHS_KEY, rest);
  }, [sessionId, ready]);

  const commitWidth = useCallback((px: number) => {
    setWidth(px);
    saveSidebarWidth(px);
  }, []);

  return [width, commitWidth];
}
