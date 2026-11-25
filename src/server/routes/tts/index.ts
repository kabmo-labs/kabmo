/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as speak from '@/server/routes/tts/speak';
import * as models from '@/server/routes/tts/models';

export const ttsBindings: HandlerBinding[] = [
  ...bindingsFor(speak, '/api/tts/speak'),
  ...bindingsFor(models, '/api/tts/models'),
];
