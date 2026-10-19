import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as consoleRestart from '@/server/routes/console/restart';

/**
 * `/api/console/*` — operations on the console itself rather than on omp.
 *
 * A restart belongs here and not under `/api/omp/*`: it replaces the process
 * serving this page, not an omp child.
 *
 * `restart` was `/api/chamber/restart` before the rename, and that path is
 * still mounted (see `chamberBindings`) because a page loaded from an older
 * build keeps posting to it until it reloads. The handler is the SAME function,
 * so the two paths cannot drift into different behaviour; the old one is a
 * compatibility mount, not a second implementation.
 */
export const consoleBindings: HandlerBinding[] = [
  ...bindingsFor(consoleRestart, '/api/console/restart'),
];
