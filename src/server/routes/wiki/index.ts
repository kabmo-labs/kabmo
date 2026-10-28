/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as wikiRepo from '@/server/routes/wiki/repo';
import * as wikiPage from '@/server/routes/wiki/page';
import * as wikiAsset from '@/server/routes/wiki/asset';

export const wikiBindings: HandlerBinding[] = [
  ...bindingsFor(wikiRepo, '/api/wiki'),
  ...bindingsFor(wikiPage, '/api/wiki/page'),
  ...bindingsFor(wikiAsset, '/api/wiki/asset'),
];
