import { actionBindings, bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as harnessRoot from '@/server/routes/harness/root';
import * as harnessUpdate from '@/server/routes/harness/update';
import * as harnessUpdateStatus from '@/server/routes/harness/update-status';
import * as harnessVersions from '@/server/routes/harness/versions';

export const harnessBindings: HandlerBinding[] = [
  ...actionBindings(harnessRoot.action, '/api/harness', harnessRoot.loader),
  // Static paths registered as their own routes. A `/api/harness/:id` parameter
  // route sharing this position is the shape that makes the parameter win the
  // match and hide the real handler behind a 405.
  // The update's BACKGROUND progress is its own GET: `/api/harness/update` keeps
  // answering the version rows for compatibility.
  ...bindingsFor(harnessUpdateStatus, '/api/harness/update/status'),
  ...actionBindings(harnessUpdate.action, '/api/harness/update', harnessVersions.loader),
  ...actionBindings(harnessRoot.action, '/api/harness/versions', harnessVersions.loader),
];
