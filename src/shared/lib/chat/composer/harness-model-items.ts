/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Model rows for the `@harness:<id>:` completion.
 *
 * The token is the value the delegation parser hands to
 * `kabmo session spawn --model`: `<provider>/<id>` for a harness that publishes
 * providers (omp's registry), or the bare id an ACP agent lists. It is NOT
 * `@harness:<id>:<model>` — the trigger already scopes the replacement to the
 * text after the second colon, so inserting the whole mention would duplicate
 * the namespace the user typed.
 */

import type { AIModelOption, ComposerPickItem } from '@/shared/types';

/** The exact `--model` value for one row. */
export function harnessModelValue(model: AIModelOption): string {
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

/** Map one harness's model list into popup rows. */
export function harnessModelPickItems(
  models: readonly AIModelOption[],
  harness: string,
): ComposerPickItem[] {
  return models.map((model) => {
    const value = harnessModelValue(model);
    const context = model.contextWindow ? ` · ${model.contextWindow}` : '';
    return {
      id: `harness-model-${harness}-${value}`,
      name: model.name || model.id,
      description: `${value}${context}`,
      kind: 'model',
      source: 'model',
      token: value,
    };
  });
}
