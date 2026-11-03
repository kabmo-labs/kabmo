/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as review from '@/server/routes/review/index';

export const reviewBindings: HandlerBinding[] = bindingsFor(review, '/api/review', {
  mutating: ['POST', 'DELETE'],
});
