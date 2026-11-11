/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which harnesses keep the conversation in the JSONL omp writes on disk.
 *
 * `omp-rpc` and `omp-acp` are the same product over two transports and both
 * write that file. Every other ACP agent keeps its history in its own store:
 * `session/load` replays the whole history and `session/fork` copies it whole,
 * so Kabmo can neither truncate it (rewind) nor cut it at a message (fork).
 *
 * An UNKNOWN harness keeps the historical allow: the caller has not resolved it
 * yet, and the endpoint answers the real refusal.
 */
export function harnessHasLocalTranscript(harness: string | null | undefined): boolean {
  return !harness || harness === 'omp-rpc' || harness === 'omp-acp';
}
