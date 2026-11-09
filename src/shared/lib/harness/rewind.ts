/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which harnesses Kabmo can rewind IN PLACE.
 *
 * Undo and Retry truncate the conversation and then re-run a turn, so the
 * agent's own context must be truncatable with it. That is only true where the
 * transcript is the JSONL omp writes — `omp-rpc` and `omp-acp` are the same
 * product over two transports, and the ACP child is torn down before the file
 * is rewritten (the next prompt resumes it over RPC).
 *
 * Every other ACP agent keeps the conversation in its own store, and ACP
 * defines no truncation verb (`session/load` replays the whole history, a fork
 * copies it). Truncating Kabmo's copy there would leave the agent answering
 * from turns the timeline no longer shows — a silent divergence, not a rewind.
 * An UNKNOWN harness keeps the historical allow: the caller has not resolved it
 * yet, and the endpoint answers the real refusal.
 */
export function harnessSupportsRewind(harness: string | null | undefined): boolean {
  return !harness || harness === 'omp-rpc' || harness === 'omp-acp';
}
