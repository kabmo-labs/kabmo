/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP prompt/approval payload helpers.
 *
 * Split out of `session.ts` so the driver holds only the session state machine.
 * Both functions here encode a wire decision that is easy to get wrong:
 *
 *  - a prompt is `ContentBlock[]`, images FIRST so the text is the final block
 *    the model reads (a trailing image is what some agents truncate);
 *  - the approval dialog's text prefers the tool's own `rawInput.command`, since
 *    a shell approval whose body is only a title gives the reader nothing to
 *    approve.
 */

import { acpOptionValues, type AcpConfigOption } from '@/server/lib/harness/acp/protocol';

/** The selector in a `configOptions` list for one ACP category. */
export function configOption(options: AcpConfigOption[], category: string): AcpConfigOption | undefined {
  return options.find((option) => option.category === category);
}

/** A prompt in ACP content-block form. */
export function promptBlocks(message: string, images: unknown): unknown[] {
  const blocks: unknown[] = [];
  if (Array.isArray(images)) {
    for (const image of images) {
      if (!image || typeof image !== 'object') continue;
      if (!('data' in image) || typeof image.data !== 'string') continue;
      const mimeType = 'mimeType' in image && typeof image.mimeType === 'string' ? image.mimeType : 'image/png';
      blocks.push({ type: 'image', data: image.data, mimeType });
    }
  }
  blocks.push({ type: 'text', text: message });
  return blocks;
}

/** What the approval dialog says, from the tool call the agent reported. */
export function permissionText(toolCall: Record<string, unknown> | undefined): string {
  const rawInput = toolCall?.rawInput;
  if (rawInput && typeof rawInput === 'object' && 'command' in rawInput && typeof rawInput.command === 'string') {
    return `$ ${rawInput.command}`;
  }
  const title = toolCall?.title;
  return typeof title === 'string' ? title : 'This action needs your approval';
}

/** What a session may write into the agent's config selectors. */
export interface ConfigSelections {
  model: { provider: string; modelId: string } | null;
  thinking: string | null;
  mode: string | null;
}

/** The subset of a session the selection writes need. */
export interface ConfigSelectionHost {
  configOptions: AcpConfigOption[];
  runModel: { provider: string; modelId: string } | null;
  setConfig(configId: string, value: string | boolean): Promise<unknown>;
}

/**
 * Apply the model/thinking/mode picks with one config write each.
 *
 * A selector the agent does not publish is SKIPPED, never guessed: an agent with
 * no thinking ladder must not have a level invented for it, and a model the
 * agent does not list is not written. Every write is best-effort — a spawn that
 * fails because an optional knob was rejected would be worse than the default.
 */
export async function applySelections(host: ConfigSelectionHost, wanted: ConfigSelections): Promise<void> {
  const model = configOption(host.configOptions, 'model');
  if (model && wanted.model) {
    const exact = `${wanted.model.provider}/${wanted.model.modelId}`;
    const values = acpOptionValues(model);
    const match = values.find((value) => value === exact) ?? values.find((value) => value === wanted.model?.modelId);
    if (match) await host.setConfig('model', match).catch(() => {});
  }
  const thinking = configOption(host.configOptions, 'thought_level');
  if (thinking && wanted.thinking && acpOptionValues(thinking).includes(wanted.thinking)) {
    await host.setConfig('thinking', wanted.thinking).catch(() => {});
  }
  const mode = configOption(host.configOptions, 'mode');
  if (mode && wanted.mode && acpOptionValues(mode).includes(wanted.mode)) {
    await host.setConfig('mode', wanted.mode).catch(() => {});
  }
}
