import { SettingsModal } from '@/client/components/settings/LazyModal';

/**
 * Modals shared by the desktop and mobile sidebars.
 *
 * The scheduler lives in its own folder (`./scheduler-modal`) and the New
 * Workspace dialog in `./new-workspace-modal` — both are real features with
 * state, a server API and their own sub-components, not presentational
 * dialogs. This module is the entry point the two sidebars import from, so the
 * move did not have to touch either of them.
 */
export { SettingsModal };
export { AboutModal } from '@/client/components/layout/session-sidebar/about-modal';
export { NewWorkspaceModal } from '@/client/components/layout/session-sidebar/new-workspace-modal';
export type { NewWorkspaceModalProps } from '@/client/components/layout/session-sidebar/new-workspace-modal';
