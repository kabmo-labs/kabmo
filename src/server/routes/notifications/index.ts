import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as notificationsStream from '@/server/routes/notifications/stream';

export const notificationsBindings: HandlerBinding[] = [
  ...bindingsFor(notificationsStream, '/api/notifications/stream'),
];
