/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The navbar's view of the realtime channel's connection state. Kept as its own
 * module path because the layout's props are typed against it; the value itself
 * comes from the shared client.
 */

export { useAgentStreamStatus, type AgentStreamStatus } from '@/shared/lib/chat/omp/status';
