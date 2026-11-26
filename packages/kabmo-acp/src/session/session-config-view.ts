/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The config-selector view `setAcpConfig`/`setAcpMode` write through.
 *
 * `session-config.ts` owns the RULES (adopt the agent's answer, announce the new
 * identity, route a synthesized selector to the verb that answers it), and it
 * needs a mutable view of the session to apply them. Building that view here
 * keeps `session.ts` from growing four near-identical delegates, and the getters
 * matter: a snapshot would write the new model into a copy and leave the session
 * naming the old one.
 */

import type { AcpConfigOption, AcpSessionModeState, AcpSessionModels } from '@kabmo-labs/kabmo-acp/protocol/protocol';
import type { AcpConfigWriter } from '@kabmo-labs/kabmo-acp/session-config/session-config';
import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';

/** What the view reads and moves on the session. */
export interface AcpConfigState {
  readonly harness: HarnessId;
  readonly sessionId: string;
  configOptions: AcpConfigOption[];
  runModel: { provider: string; modelId: string } | null;
  modes: AcpSessionModeState | null;
  models: AcpSessionModels | null;
  readonly isStreaming: boolean;
  emit(event: Record<string, unknown> & { type: string }): void;
}

/** The process verbs the view calls. */
export interface AcpConfigProcess {
  setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<unknown>;
  setMode(sessionId: string, modeId: string): Promise<unknown>;
  setModel(sessionId: string, modelId: string): Promise<unknown>;
}

/** The `AcpConfigWriter` a session exposes, bound to ITS own fields. */
export function acpConfigView(state: AcpConfigState, proc: AcpConfigProcess): AcpConfigWriter {
  return {
    get harness() {
      return state.harness;
    },
    get sessionId() {
      return state.sessionId;
    },
    get configOptions() {
      return state.configOptions;
    },
    set configOptions(options: AcpConfigOption[]) {
      state.configOptions = options;
    },
    get runModel() {
      return state.runModel;
    },
    set runModel(model: { provider: string; modelId: string } | null) {
      state.runModel = model;
    },
    get modes() {
      return state.modes;
    },
    set modes(modes: AcpSessionModeState | null) {
      state.modes = modes;
    },
    get models() {
      return state.models;
    },
    set models(models: AcpSessionModels | null) {
      state.models = models;
    },
    get isStreaming() {
      return state.isStreaming;
    },
    emit: (event) => state.emit(event),
    writeConfigOption: (configId, value) => proc.setConfigOption(state.sessionId, configId, value),
    writeMode: (modeId) => proc.setMode(state.sessionId, modeId),
    writeModel: (modelId) => proc.setModel(state.sessionId, modelId),
  };
}
