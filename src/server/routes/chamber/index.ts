import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as chamberRestart from '@/server/routes/chamber/restart';

/**
 * `/api/chamber/*` — operations on the console itself rather than on omp.
 *
 * A restart belongs here and not under `/api/omp/*`: it replaces the process
 * serving this page, not an omp child.
 */
export const chamberBindings: HandlerBinding[] = [
  ...bindingsFor(chamberRestart, '/api/chamber/restart'),
];
