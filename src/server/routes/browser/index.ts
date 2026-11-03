import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as browserStream from '@/server/routes/browser/stream';
import * as browserTabs from '@/server/routes/browser/tabs';

export const browserBindings: HandlerBinding[] = [
  ...bindingsFor(browserStream, '/api/browser/:sessionId/stream'),
  // Mutating route: `bindingsFor` adds the 405 GET fallback on its own.
  ...bindingsFor(browserTabs, '/api/browser/:sessionId/tabs/close'),
];
