/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as panelsRegistry from '@/server/routes/panels/registry';
import * as panelsBundle from '@/server/routes/panels/bundle';
import * as panelsCss from '@/server/routes/panels/css';
import * as panelsIcon from '@/server/routes/panels/icon';
import * as panelsReadme from '@/server/routes/panels/readme';
import * as panelsInstall from '@/server/routes/panels/install';
import * as panelsBuild from '@/server/routes/panels/build';

export const panelsBindings: HandlerBinding[] = [
  ...bindingsFor(panelsRegistry, '/api/panels'),
  ...bindingsFor(panelsBundle, '/api/panels/bundle/:plugin'),
  ...bindingsFor(panelsCss, '/api/panels/css/:plugin'),
  ...bindingsFor(panelsIcon, '/api/panels/icon/:plugin/*'),
  ...bindingsFor(panelsReadme, '/api/panels/readme/:plugin/*'),
  ...bindingsFor(panelsInstall, '/api/panels/install'),
  ...bindingsFor(panelsBuild, '/api/panels/build'),
];
