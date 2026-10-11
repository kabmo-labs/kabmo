/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as pluginsRpc from '@/server/routes/plugins/rpc';
import * as pluginsState from '@/server/routes/plugins/state';
import * as pluginsHttp from '@/server/routes/plugins/http';
import { PLUGIN_HTTP_ROUTE } from '@/server/routes/plugins/http';

export const pluginsBindings: HandlerBinding[] = [
  ...bindingsFor(pluginsState, '/api/plugins'),
  ...bindingsFor(pluginsRpc, '/api/plugins/:pluginId/rpc/:method'),
  ...bindingsFor(pluginsHttp, PLUGIN_HTTP_ROUTE),
];
