import type { ProjectConfigItem } from '@/shared/types';

/**
 * Legacy seed rows for the one-shot migration off `omp_projects_config`.
 *
 * Read ONLY by `migrateLegacyProjectSettings`: when the legacy row exists but
 * is not an array, that migration falls back to this list. Nothing else may
 * read it — the live project list comes from the `workspace_folders` table, and
 * the accent palette lives in `@/shared/lib/workspace/project-accent`.
 */
export const DEFAULT_PROJECTS_LIST: ProjectConfigItem[] = [
  { id: 'proj-workspace', name: 'Workspace', path: '/Users/rajebdev/JatisMobile/Workspace', model: 'Not selected', accentColor: '#a3e635', icon: 'default' },
  { id: 'proj-drrealhandler', name: 'drrealhandler', path: '/Users/rajebdev/JatisMobile/drrealhandler', model: 'Not selected', accentColor: '#94a3b8', icon: 'default' },
  { id: 'proj-testing', name: 'testing', path: '/Users/rajebdev/JatisMobile/testing', model: 'Not selected', accentColor: '#f87171', icon: 'default' },
  { id: 'proj-countingtoken', name: 'CountingToken', path: '/Users/rajebdev/JatisMobile/CountingToken', model: 'Not selected', accentColor: '#38bdf8', icon: 'default' },
  { id: 'proj-opencode-models-discovery', name: 'opencode-models-discovery', path: '/Users/rajebdev/JatisMobile/opencode-models-discovery', model: 'Not selected', accentColor: '#2dd4bf', icon: 'default' },
  { id: 'proj-openchamber', name: 'openchamber', path: '/Users/rajebdev/JatisMobile/openchamber', model: 'Not selected', accentColor: '#f43f5e', icon: 'default' },
  { id: 'proj-opencode-vibeguard', name: 'opencode-vibeguard', path: '/Users/rajebdev/JatisMobile/opencode-vibeguard', model: 'Not selected', accentColor: '#38bdf8', icon: 'default' },
  { id: 'proj-qwencloudgenerator', name: 'qwencloudgenerator', path: '/Users/rajebdev/JatisMobile/qwencloudgenerator', model: 'Not selected', accentColor: '#84cc16', icon: 'default' },
  { id: 'proj-authentication-api', name: 'authentication-api', path: '/Users/rajebdev/JatisMobile/authentication-api', model: 'Not selected', accentColor: '#94a3b8', icon: 'default' },
  { id: 'proj-opencode-cmd-provider-1', name: 'opencode-commandcode-provider', path: '/Users/rajebdev/JatisMobile/opencode-commandcode-provider', model: 'Not selected', accentColor: '#fbbf24', icon: 'default' },
  { id: 'proj-opencode-blob-office', name: 'opencode-blob-office', path: '/Users/rajebdev/JatisMobile/opencode-blob-office', model: 'Not selected', accentColor: '#fbbf24', icon: 'default' },
  { id: 'proj-transmitterbsa', name: 'transmitterbsa', path: '/Users/rajebdev/JatisMobile/transmitterbsa', model: 'Not selected', accentColor: '#84cc16', icon: 'default' },
  { id: 'proj-opencode-snip', name: 'opencode-snip', path: '/Users/rajebdev/JatisMobile/opencode-snip', model: 'Not selected', accentColor: '#38bdf8', icon: 'default' },
  { id: 'proj-outline-cli', name: 'outline-cli', path: '/Users/rajebdev/JatisMobile/outline-cli', model: 'Not selected', accentColor: '#84cc16', icon: 'default' },
  { id: 'proj-bofis-api', name: 'bofis-api', path: '/Users/rajebdev/JatisMobile/bofis-api', model: 'Not selected', accentColor: '#38bdf8', icon: 'default' },
  { id: 'proj-media-broadcaster', name: 'media-broadcaster', path: '/Users/rajebdev/JatisMobile/media-broadcaster', model: 'Not selected', accentColor: '#2dd4bf', icon: 'default' },
  { id: 'proj-dompetai', name: 'DompetAI', path: '/Users/rajebdev/JatisMobile/DompetAI', model: 'Not selected', accentColor: '#f43f5e', icon: 'default' },
  { id: 'proj-jns-tools-app', name: 'JNS Tools App', path: '/Users/rajebdev/JatisMobile/JNS Tools App', model: 'Not selected', accentColor: '#f87171', icon: 'default' },
  { id: 'proj-jatismobile', name: 'JatisMobile', path: '/Users/rajebdev/JatisMobile/JatisMobile', model: 'Not selected', accentColor: '#84cc16', icon: 'default' },
  { id: 'proj-jns-tools-new', name: 'jns_tools_new', path: '/Users/rajebdev/JatisMobile/jns_tools_new', model: 'Not selected', accentColor: '#f87171', icon: 'default' },
  { id: 'proj-literasi-web', name: 'literasi-web', path: '/Users/rajebdev/JatisMobile/literasi-web', model: 'Not selected', accentColor: '#2dd4bf', icon: 'default' },
  { id: 'proj-jns-tools-jin', name: 'jns-tools-jin', path: '/Users/rajebdev/JatisMobile/jns-tools-jin', model: 'Not selected', accentColor: '#38bdf8', icon: 'default' },
  { id: 'proj-mcp-html-to-asci', name: 'mcp-html-to-asci', path: '/Users/rajebdev/JatisMobile/mcp-html-to-asci', model: 'Not selected', accentColor: '#84cc16', icon: 'default' },
  { id: 'proj-opencode-cmd-provider-2', name: 'opencode-cmd-provider', path: '/Users/rajebdev/JatisMobile/opencode-cmd-provider', model: 'Not selected', accentColor: '#94a3b8', icon: 'default' },
  { id: 'proj-bofis-pro', name: 'bofis-pro', path: '/Users/rajebdev/JatisMobile/bofis-pro', model: 'Not selected', accentColor: '#fbbf24', icon: 'default' },
  { id: 'proj-ompweb', name: 'ompweb', path: '/Users/rajebdev/JatisMobile/ompweb', model: 'Not selected', accentColor: '#f43f5e', icon: 'default' },
  { id: 'proj-kabmo', name: 'kabmo', path: '/Users/rajebdev/JatisMobile/kabmo', model: 'Not selected', accentColor: '#38bdf8', icon: 'default' },
];
