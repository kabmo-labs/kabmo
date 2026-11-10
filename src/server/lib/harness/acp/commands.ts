/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command vocabulary an ACP session accepts, as ONE dispatch table.
 *
 * The routes already speak this vocabulary for omp (`prompt`, `steer`, `abort`,
 * `set_model`, `get_state`, `extension_ui_response`, …), so a second table would
 * be a place for the two transports to answer differently. What changes per
 * harness is only what the agent can actually DO, and every branch here says so
 * instead of pretending:
 *
 *  - `steer`/`follow_up` refuse when the capability record says the agent has no
 *    mid-turn channel. Falling back to `session/prompt` is NOT an option: a
 *    second prompt CANCELS the running turn (measured), which would throw away
 *    the answer the user was reading.
 *  - `set_model`/`set_thinking_level`/`set_mode` throw when the agent published
 *    no such selector, naming the harness, rather than silently doing nothing.
 */

import { configOption, promptBlocks } from '@/server/lib/harness/acp/prompt';
import { acpOptionValues } from '@/server/lib/harness/acp/protocol';
import { notePromptTitle } from '@/server/lib/harness/session-title.server';
import { isApprovalMode, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { AcpConfigOption, AcpSessionModeState } from '@/server/lib/harness/acp/protocol';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** The slice of `AcpSession` this table drives. Narrow on purpose: the dispatch
 *  rules are testable against a stub, with no process and no protocol. */
export interface AcpCommandHost {
  readonly harness: HarnessId;
  readonly sessionId: string;
  readonly capabilities: HarnessCapabilities;
  readonly configOptions: AcpConfigOption[];
  /** The older Session Modes API, when the agent publishes no selector. */
  readonly modes?: AcpSessionModeState | null;
  /** `session/set_mode`; present only when the session can speak it. */
  setMode?(modeId: string): Promise<unknown>;
  /** Dispatch one turn. Returns the ACK (`{agentInvoked:true}`), never the
   *  turn: the route's answer means "accepted", and the turn's end arrives as
   *  the session's `agent_end` frame. */
  startTurn(message: string, images: unknown): Promise<unknown> | unknown;
  isAlive(): boolean;
  destroyAndWait(): Promise<void>;
  steer(blocks: unknown[], queue: 'steering' | 'followUp'): Promise<unknown>;
  cancelTurn(): void;
  /** Adopt the composer's approval tier. ACP decides approvals in-process. */
  setAccessMode(mode: ApprovalMode): void;
  setConfig(configId: string, value: string | boolean): Promise<unknown>;
  resolvePermission(dialogId: string, confirmed: boolean): unknown;
  webState(): Record<string, unknown>;
  /** The agent's own slash-command list, when it published one. */
  agentCommands: { name: string; description?: string; inputHint?: string }[];
}

  /** The command vocabulary the routes already use. */
  export async function dispatchCommand(host: AcpCommandHost, command: Record<string, unknown>): Promise<unknown> {
    if (!host.isAlive()) throw new Error('ACP session is not running');
    const type = typeof command.type === 'string' ? command.type : '';

    // The composer sends its access pick with each request (the warmup and the
    // prompt both carry it). ACP has no spawn flag for it, so the tier is adopted
    // here and used when `session/request_permission` arrives.
    if (isApprovalMode(command.accessMode)) host.setAccessMode(command.accessMode);

    switch (type) {
      case 'prompt': {
        const message = String(command.message ?? '');
        // Name the chat here, and only here: this is the ONE place every ACP
        // prompt goes through (a new chat's first send, a live send, a queue
        // delivery), and the writer fills an EMPTY title only — so a steering
        // message or a follow-up cannot rename the chat to its own text.
        // Kabmo's goal kickoff/continuation is synthetic: naming the chat after
        // that boilerplate is worse than leaving the objective's own title.
        if (command.synthetic !== true) await notePromptTitle(host.sessionId, message);
        return host.startTurn(message, command.images);
      }

      case 'set_access_mode': {
        const mode = command.mode;
        if (!isApprovalMode(mode)) throw new Error(`Unknown access mode: ${String(mode)}`);
        host.setAccessMode(mode);
        return { mode };
      }

      case 'steer': {
        const blocks = promptBlocks(String(command.message ?? ''), command.images);
        if (host.capabilities.steerMode !== 'steer') {
          throw new Error(`This harness has no mid-turn steering (${host.harness})`);
        }
        return host.steer(blocks, 'steering');
      }

      case 'follow_up': {
        const blocks = promptBlocks(String(command.message ?? ''), command.images);
        if (!host.capabilities.steerMode) throw new Error(`This harness cannot queue a follow-up (${host.harness})`);
        return host.steer(blocks, 'followUp');
      }

      case 'abort':
        // `cancelTurn` stops the agent AND closes the turn locally: the cancel
        // is a notification, so an agent that never answers it would otherwise
        // leave `isStreaming` up and refuse the next prompt as "already
        // processing" (reported: Stop cleared the spinner but the next send was
        // rejected). The terminal `agent_end` comes from that close, not from a
        // frame emitted here — two terminal frames finalized the assistant
        // message twice.
        host.cancelTurn();
        return null;

      case 'force_reset':
        await host.destroyAndWait();
        return null;

      case 'set_model': {
        const provider = String(command.provider ?? '');
        const modelId = String(command.modelId ?? '');
        const model = configOption(host.configOptions, 'model');
        if (!model) throw new Error(`This harness exposes no model selector (${host.harness})`);
        const wanted = `${provider}/${modelId}`;
        const values = acpOptionValues(model);
        const match = values.find((value) => value === wanted) ?? values.find((value) => value === modelId);
        if (!match) throw new Error(`Model not offered by this harness: ${wanted}`);
        // The agent's own selector ID, never the category name: ACP lets an
        // agent publish `{id:"model", category:"model"}` or any other pair, and
        // `session/set_config_option` keys on the ID.
        const result = await host.setConfig(model.id, match);
        return { id: modelId, provider, data: result };
      }

      case 'set_thinking_level': {
        const level = String(command.level ?? '');
        const thinking = configOption(host.configOptions, 'thought_level');
        if (!thinking) throw new Error(`This harness exposes no thinking selector (${host.harness})`);
        return host.setConfig(thinking.id, level);
      }

      case 'set_mode': {
        const mode = String(command.mode ?? '');
        const selector = configOption(host.configOptions, 'mode');
        if (!selector) {
          // The older Session Modes API. An agent that publishes `modes` and no
          // `mode` selector can still move; inventing a selector write would
          // call a method it did not advertise.
          if (host.modes?.availableModes.some((entry) => entry.id === mode) && host.setMode) {
            return host.setMode(mode);
          }
          throw new Error(`This harness exposes no mode selector (${host.harness})`);
        }
        return host.setConfig(selector.id, mode);
      }

      case 'get_state':
        return host.webState();

      case 'get_commands':
        // The agent's own list, not an empty one: the composer's `/` pool asks
        // the live session for it, and a transport that answered `[]` forced
        // every ACP chat onto omp's utility catalog instead.
        return { commands: host.agentCommands };

      case 'extension_ui_response': {
        // The approval dialog's answer, in the shape the shared gate sends. The
        // session owns the picking (which option means "allow"), because it is
        // also the side that rendered the options.
        const id = typeof command.id === 'string' ? command.id : '';
        const confirmed = command.confirmed === true || command.value === 'allow';
        return host.resolvePermission(id, confirmed);
      }

      default:
        throw new Error(`Command not supported by the ACP transport: ${type}`);
    }
}
