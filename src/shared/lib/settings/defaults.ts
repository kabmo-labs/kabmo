/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Every Kabmo setting at its shipped value.
 *
 * It lives here, beside `mergeKabmoSettings`, rather than in the settings modal
 * that consumes it: the defaults are DATA about `SettingsState`, and the modal
 * had grown to the 350-line ceiling with a table that has nothing to do with
 * the modal's own job (reading a category, dispatching a write). Adding the
 * chat width mode there pushed it over.
 *
 * `satisfies SettingsState` (not a bare annotation) so a field added to the
 * state without a default is a build error here, and so the keys cannot drift:
 * `mergeKabmoSettings` overlays the stored blob on this object, and a key
 * missing from it is a setting whose default is `undefined`.
 */

import type { SettingsState } from '@/shared/types';
import { DEFAULT_THEME_ID } from '@/shared/lib/theme/catalog';
import { DEFAULT_CHAT_WIDTH_MODE, DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH } from '@/shared/lib/chat/timeline/width-mode';
import { DEFAULT_TOOL_RENDER_MODE } from '@/shared/lib/chat/timeline/tool-render-mode';
import { DEFAULT_SIDEBAR_STYLE } from '@/shared/lib/workspace/sidebar-style';
import { DEFAULT_MOBILE_PANEL_NAV, DEFAULT_PANEL_NAV } from '@/shared/lib/workspace/panel-nav';
import { DEFAULT_COMPOSER_STYLE } from '@/shared/lib/chat/composer/style';
import { DEFAULT_SURFACE_STYLE } from '@/shared/lib/theme/surface-style';
import { DEFAULT_BORDER_STYLE } from '@/shared/lib/theme/border-style';
import { DEFAULT_ICON_STYLE } from '@/shared/lib/theme/icon-style';
import { DEFAULT_TRAY_ICON_STYLE } from '@/shared/lib/theme/tray-icon-style';
import { EDITOR_DEFAULT_FONT_FAMILY } from '@/shared/lib/code/editor/typography';
import { EDITOR_DEFAULT_THEME_ID } from '@/shared/lib/code/editor/themes';
import { DEFAULT_DICTATION_CONFIG } from '@/shared/lib/dictation/settings';
import { DEFAULT_TTS_CONFIG } from '@/shared/lib/tts/settings';

export const DEFAULT_SETTINGS = {
  theme: DEFAULT_THEME_ID,
  editorFont: EDITOR_DEFAULT_FONT_FAMILY,
  editorTheme: EDITOR_DEFAULT_THEME_ID,
  autoSessionTitle: true,
  commitMessageMode: 'auto',
  commitMessageHarness: '',
  commitMessageModel: '',
  commitMessagePrompt: '',
  gitIdentities: [],
  soundAlerts: true,
  chatCompletionSound: true,
  notifyDesktopEnabled: true,
  notifyMobileEnabled: true,
  notifyOnFinish: false,
  notifyOnAsk: false,
  notifyOnError: false,
  goalAuditEnabled: true,
  goalAuditModel: '',
  goalDefaultBudget: null,
  chatWidthMode: DEFAULT_CHAT_WIDTH_MODE,
  chatColumnWidth: DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH,
  toolRenderStyle: DEFAULT_TOOL_RENDER_MODE,
  showChangedFiles: true,
  sidebarStyle: DEFAULT_SIDEBAR_STYLE,
  leftPanelNav: DEFAULT_PANEL_NAV,
  rightPanelNav: DEFAULT_PANEL_NAV,
  mobileLeftPanelNav: DEFAULT_MOBILE_PANEL_NAV,
  mobileRightPanelNav: DEFAULT_MOBILE_PANEL_NAV,
  composerStyle: DEFAULT_COMPOSER_STYLE,
  surfaceStyle: DEFAULT_SURFACE_STYLE,
  borderStyle: DEFAULT_BORDER_STYLE,
  iconStyle: DEFAULT_ICON_STYLE,
  trayIconStyle: DEFAULT_TRAY_ICON_STYLE,
  followUpBehavior: 'queue',
  keybindingSend: 'Enter',
  keybindingNewLine: 'Shift + Enter',
  keybindingSteering: 'Ctrl / Cmd + Enter',
  dictation: DEFAULT_DICTATION_CONFIG,
  tts: DEFAULT_TTS_CONFIG,
} satisfies SettingsState;
