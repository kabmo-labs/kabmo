import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as consoleRestart from '@/server/routes/console/restart';

/**
 * `/api/chamber/*` — the PRE-RENAME path for console operations.
 *
 * @deprecated Mounted for compatibility only. The current path is
 * `/api/console/restart` (`src/server/routes/console`), and both names reach
 * the same handler, so a page served from an older build keeps working until
 * it reloads. Do not add a new route here: a new operation belongs under
 * `/api/console/*`, and this folder exists so the old path keeps answering.
 */
export const chamberBindings: HandlerBinding[] = [
  ...bindingsFor(consoleRestart, '/api/chamber/restart'),
];
