/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `local` engine's dispatch: pick the installed model, then hand it to the
 * ONNX adapter.
 *
 * The model id travels in the settings blob, but the directory is a server fact
 * that can disappear (a removed model, a wiped data directory). So this resolves
 * it every request and refuses with the list of what IS installed — never by
 * quietly falling back to another model, which would read the answer in a voice
 * the user did not choose.
 */

import { listInstalledModels, readInstalledModel } from '@/server/lib/tts/model-manifest.server';
import { synthesizeWithLocal } from '@/server/lib/tts/engines/sherpa';
import { TtsEngineError, type TtsAudio } from '@/server/lib/tts/engines/adapter';

export async function synthesizeLocally(input: {
  modelId: string;
  text: string;
  voice: string;
  language: string;
  speed: number;
}): Promise<TtsAudio> {
  const wanted = input.modelId.trim();
  const model = wanted ? await readInstalledModel(wanted) : (await listInstalledModels())[0] ?? null;

  if (!model) {
    const installed = await listInstalledModels();
    if (installed.length === 0) {
      throw new TtsEngineError(
        'No local speech model is installed yet. Settings → Voice → Speech → Local models, then download one.',
        false,
      );
    }
    throw new TtsEngineError(
      `"${wanted}" is not installed. Installed: ${installed.map((entry) => entry.id).join(', ')}.`,
      false,
    );
  }

  return synthesizeWithLocal({
    model,
    dir: model.dir,
    text: input.text,
    voice: input.voice,
    language: input.language,
    speed: input.speed,
  });
}
