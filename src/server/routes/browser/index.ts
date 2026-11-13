import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as browserEngine from '@/server/routes/browser/engine';
import * as browserStream from '@/server/routes/browser/stream';
import * as browserTabs from '@/server/routes/browser/tabs';

export const browserBindings: HandlerBinding[] = [
  // Static segment first: it shares the `/api/browser/…` position with the
  // parameter routes below, and a parameter route winning the match would
  // answer 405 for the engine probe.
  ...bindingsFor(browserEngine, '/api/browser/engine'),
  ...bindingsFor(browserStream, '/api/browser/:sessionId/stream'),
  // Mutating route: `bindingsFor` adds the 405 GET fallback on its own.
  ...bindingsFor(browserTabs, '/api/browser/:sessionId/tabs/close'),
];
