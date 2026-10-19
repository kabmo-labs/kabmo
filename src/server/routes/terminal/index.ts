import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as terminalSessions from '@/server/routes/terminal/sessions';

export const terminalBindings: HandlerBinding[] = [
  ...bindingsFor(terminalSessions, '/api/terminal/sessions'),
];
