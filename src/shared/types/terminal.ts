/**
 * Live terminal inventory, as served by `GET /api/terminal/sessions`.
 *
 * The frame types themselves live in `@/shared/lib/workspace/terminal/protocol`
 * — they are the wire contract the socket encodes and decodes, not domain data.
 */

import type { TerminalSnapshot } from '@/shared/lib/workspace/terminal/protocol';

export interface TerminalSessionsResponse {
  terminals: TerminalSnapshot[];
}
