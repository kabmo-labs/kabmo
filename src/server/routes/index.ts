import { Elysia } from 'elysia';
import { mountBindings, type HandlerBinding } from '@/server/lib/route-adapter';
import { agentBindings } from '@/server/routes/agent';
import { authBindings } from '@/server/routes/auth';
import { btwBindings } from '@/server/routes/btw';
import { consoleBindings } from '@/server/routes/console';
import { chamberBindings } from '@/server/routes/chamber';
import { chatBindings } from '@/server/routes/chat';
import { sessionsBindings } from '@/server/routes/sessions';
import { scheduleBindings } from '@/server/routes/schedule/bindings';
import { settingsBindings } from '@/server/routes/settings';
import { fsBindings } from '@/server/routes/fs';
import { foldersBindings } from '@/server/routes/folders';
import { filesBindings } from '@/server/routes/files';
import { telemetryBindings } from '@/server/routes/telemetry';
import { terminalBindings } from '@/server/routes/terminal';
import { terminalWsRoutes } from '@/server/routes/terminal/ws';
import { dictationWsRoutes } from '@/server/routes/dictation/ws';
import { browserBindings } from '@/server/routes/browser';
import { modelsBindings } from '@/server/routes/models';
import { ompBindings } from '@/server/routes/omp';
import { updatesBindings } from '@/server/routes/updates';
import { wikiBindings } from '@/server/routes/wiki';
import { panelsBindings } from '@/server/routes/panels/bindings';
import { pluginsBindings } from '@/server/routes/plugins/bindings';
import { realtimeWsRoutes } from '@/server/routes/realtime/ws';
import { healthBindings } from '@/server/routes/health';
import { wellKnownBindings } from '@/server/routes/well-known';

const allBindings: HandlerBinding[] = [
  ...authBindings,
  ...consoleBindings,
  // @deprecated pre-rename path; same handlers, kept for an old page.
  ...chamberBindings,
  ...agentBindings,
  ...btwBindings,
  ...chatBindings,
  ...sessionsBindings,
  ...scheduleBindings,
  ...settingsBindings,
  ...fsBindings,
  ...foldersBindings,
  ...filesBindings,
  ...telemetryBindings,
  ...terminalBindings,
  ...browserBindings,
  ...modelsBindings,
  ...ompBindings,
  ...updatesBindings,
  ...wikiBindings,
  ...panelsBindings,
  ...pluginsBindings,
  ...healthBindings,
  ...wellKnownBindings,
];

export const apiRoutes = mountBindings(new Elysia(), allBindings)
  .use(terminalWsRoutes)
  .use(dictationWsRoutes)
  .use(realtimeWsRoutes);
