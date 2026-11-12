import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as chatRoot from '@/server/routes/chat/root';
import * as chatSession from '@/server/routes/chat/session';
import * as chatRewind from '@/server/routes/chat/rewind';
import * as chatStream from '@/server/routes/chat/stream';
import * as chatTurns from '@/server/routes/chat/turns';
import * as chatPromptHistory from '@/server/routes/chat/prompt-history';

export const chatBindings: HandlerBinding[] = [
  ...bindingsFor(chatRoot, '/api/chat'),
  // Static segment in the same position as `:sessionId`: registered BEFORE the
  // parameter route, explicitly, so the recall list is never answered by the
  // session loader.
  ...bindingsFor(chatPromptHistory, '/api/chat/prompt-history'),
  ...bindingsFor(chatSession, '/api/chat/:sessionId'),
  ...bindingsFor(chatRewind, '/api/chat/:sessionId/rewind'),
  ...bindingsFor(chatStream, '/api/chat/stream'),
  ...bindingsFor(chatTurns, '/api/chat/:sessionId/turns'),
];
