import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as settingsRoot from '@/server/routes/settings/root';
import * as settingsAgents from '@/server/routes/settings/agents';
import * as settingsBehavior from '@/server/routes/settings/behavior';
import * as settingsCommands from '@/server/routes/settings/commands';
import * as settingsMcp from '@/server/routes/settings/mcp';
import * as settingsModelOverride from '@/server/routes/settings/model-override';
import * as settingsMcpTest from '@/server/routes/settings/mcp-test';
import * as settingsOmpConfig from '@/server/routes/settings/omp-config';
import * as settingsProjects from '@/server/routes/settings/projects';
import * as settingsProviderEntry from '@/server/routes/settings/provider-entry';
import * as settingsProviderIcon from '@/server/routes/settings/provider-icon';
import * as settingsProviderModels from '@/server/routes/settings/provider-models';
import * as settingsProviderRefresh from '@/server/routes/settings/provider-refresh';
import * as settingsProviderModel from '@/server/routes/settings/provider-model';
import * as settingsProviders from '@/server/routes/settings/providers';
import { logoutAction } from '@/server/routes/settings/provider-logout';
import * as settingsPlugins from '@/server/routes/settings/plugins';
import * as settingsSkills from '@/server/routes/settings/skills';
import * as settingsUsage from '@/server/routes/settings/usage';
import * as settingsUsageReset from '@/server/routes/settings/usage-reset';

export const settingsBindings: HandlerBinding[] = [
  ...bindingsFor(settingsRoot, '/api/settings'),
  ...bindingsFor(settingsAgents, '/api/settings/agents'),
  ...bindingsFor(settingsBehavior, '/api/settings/behavior'),
  ...bindingsFor(settingsCommands, '/api/settings/commands'),
  ...bindingsFor(settingsMcp, '/api/settings/mcp'),
  ...bindingsFor(settingsModelOverride, '/api/settings/model-override'),
  ...bindingsFor(settingsMcpTest, '/api/settings/mcp-test'),
  ...bindingsFor(settingsOmpConfig, '/api/settings/omp-config'),
  ...bindingsFor(settingsProjects, '/api/settings/projects'),
  ...bindingsFor(settingsProviderEntry, '/api/settings/provider-entry'),
  // A provider's fetched web icon; served outside the settings payload so the
  // panel's first paint does not carry ~50 KB per provider.
  ...bindingsFor(settingsProviderIcon, '/api/provider-icon'),
  ...bindingsFor(settingsProviderModels, '/api/settings/provider-models'),
  ...bindingsFor(settingsProviderRefresh, '/api/settings/providers/refresh'),
  ...bindingsFor(settingsProviderModel, '/api/settings/provider-model'),
  ...bindingsFor(settingsProviders, '/api/settings/providers'),
  // Credential removal, distinct from the `disabledProviders` toggle above.
  { method: 'POST', path: '/api/settings/providers/logout', handler: logoutAction },
  ...bindingsFor(settingsPlugins, '/api/settings/plugins'),
  ...bindingsFor(settingsSkills, '/api/settings/skills'),
  ...bindingsFor(settingsUsage, '/api/settings/usage'),
  ...bindingsFor(settingsUsageReset, '/api/settings/usage/reset'),
];
