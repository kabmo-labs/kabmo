/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What Kabmo advertises as a **v1** ACP client at `initialize`.
 *
 * v2 removed the client fs and terminal execution APIs, so a v2 connection
 * advertises `capabilities: {}` instead; the hybrid request in
 * `client-initialize.ts` carries both field sets so a v1 peer still sees this
 * object while a v2 peer ignores it as an unknown field.
 *
 * Every entry here is a promise the client answers itself, so the list is
 * narrower than the protocol: an advertised capability the client cannot serve
 * makes the agent park a turn on a call nobody answers (the failure mode
 * `session-requests.ts` exists to prevent).
 *
 *  - **fs** — `client-fs.ts` implements both methods against the session's
 *    workspace, so an agent that reads or writes through the client reaches the
 *    same files the user's editor is looking at.
 *  - **session.notices** — `AcpFrameMapper` already renders `notice` updates as
 *    notices; without the advertisement a spec-compliant agent had to model them
 *    as conversation text instead.
 *
 * Deliberately absent, each for a measured reason:
 *
 *  - `terminal` — this client has no bridge that surfaces an ACP terminal's
 *    output in the timeline, and advertising it would route an agent's shell
 *    work through a terminal the user cannot see.
 *  - `elicitation` — no form/URL dialog exists yet; advertising it would make
 *    the agent block on an `elicitation/create` nobody draws.
 *  - `auth.terminal` — Kabmo does not reproduce the agent's launch line in an
 *    interactive terminal for login.
 *  - `session.configOptions.boolean` — the selector UI is select-only.
 *  - `session.compaction` — compaction updates have no renderer.
 */
export const KABMO_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  session: { notices: {} },
} as const;

/** The latest protocol major this client sends; it also speaks v1. */
export const ACP_PROTOCOL_VERSION = 2;

/** Every major this client implements. */
export const ACP_SUPPORTED_VERSIONS = [1, 2] as const;

/**
 * Refuse an `initialize` answer this client cannot speak.
 *
 * Kabmo implements v1 and v2 side by side; a v1-only agent answers 1 and a v2
 * agent answers 2. Anything else is a connection this client cannot parse.
 */
export function assertProtocolVersion(result: { protocolVersion?: unknown; agentInfo?: { name?: string; title?: string } }): void {
  if (result.protocolVersion === 1 || result.protocolVersion === 2) return;
  const agent = result.agentInfo?.title ?? result.agentInfo?.name ?? 'The agent';
  throw new Error(
    `${agent} speaks ACP v${String(result.protocolVersion)}; Kabmo supports v1 and v2`,
  );
}
