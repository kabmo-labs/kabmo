/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as speak from '@/server/routes/tts/speak';

export const ttsBindings: HandlerBinding[] = [
  ...bindingsFor(speak, '/api/tts/speak'),
];
