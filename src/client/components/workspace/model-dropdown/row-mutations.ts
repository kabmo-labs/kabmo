/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three things a model ROW can do besides being picked: star it, cycle its
 * thinking level, mark it as the command agent.
 *
 * Extracted from the dropdown so that component stays a shell (state + layout)
 * and these rules live in one place. Each one is a read-modify-write against the
 * PREFERENCE STORE rather than against the row, because the star and the level
 * are derived state: patching a row alone is undone by the next
 * `applyModelPreferences`, which re-stamps every row from the store.
 */

import type { TargetedMouseEvent } from 'preact';
import type { AIModelOption, ModelPreferences } from '@/shared/types';
import type { ModelCatalogState } from '@/client/components/workspace/model-dropdown/use-catalog';
import { readModelPreferences, toggleFavoriteKey } from '@/shared/lib/models/preferences';
import { modelKey } from '@/shared/lib/models/identity';

export interface RowMutationDeps {
  preferences: ModelPreferences;
  applyPreferences: ModelCatalogState['applyPreferences'];
  setModels: ModelCatalogState['setModels'];
  selectedModel: AIModelOption | null;
  setSelectedModel: (model: AIModelOption) => void;
  selectedModelKey: string;
  onSelectModel?: (model: AIModelOption) => void;
  onThinkingLevelChange?: (level: string) => void;
}

export interface RowMutations {
  toggleFavorite: (model: AIModelOption, event: TargetedMouseEvent<HTMLElement>) => void;
  cycleThinking: (model: AIModelOption) => void;
  toggleAgentCmd: (model: AIModelOption) => void;
}

export function useRowMutations(deps: RowMutationDeps): RowMutations {
  const {
    preferences, applyPreferences, setModels, selectedModel, setSelectedModel,
    selectedModelKey, onSelectModel, onThinkingLevelChange,
  } = deps;

  /**
   * Flip one row's star. The optimistic stamp and the rollback BOTH go through
   * the preference pair, and the server's answer is the authority: it also drops
   * keys the registry no longer serves.
   */
  const toggleFavorite = (model: AIModelOption, event: TargetedMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    const key = modelKey(model);
    const previous = preferences;
    applyPreferences({ ...previous, favorites: toggleFavoriteKey(previous.favorites, key) });
    void (async () => {
      try {
        const response = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionType: 'toggleFavorite', provider: model.provider, modelId: model.id }),
        });
        if (!response.ok) throw new Error(`toggleFavorite failed: ${response.status}`);
        const data = await response.json() as { modelPreferences?: unknown };
        // An absent/malformed payload keeps the optimistic list rather than
        // blanking the rail.
        if (data.modelPreferences) applyPreferences(readModelPreferences(data.modelPreferences));
      } catch {
        // A failed write must not leave the star lit: the next reload would show
        // it unlit anyway, so the rollback keeps the panel honest now.
        applyPreferences(previous);
      }
    })();
  };

  const cycleThinking = (model: AIModelOption) => {
    const ladder = model.thinkingLevels ?? [];
    if (ladder.length === 0) return;
    const current = model.thinkingLevel ?? ladder[0];
    const next = ladder[(ladder.indexOf(current) + 1) % ladder.length];
    const key = modelKey(model);
    setModels((prev) => prev.map((entry) => (modelKey(entry) === key ? { ...entry, thinkingLevel: next } : entry)));
    // Only the ACTIVE model's preset may reach the live session: cycling another
    // provider's row must not push its level onto this chat.
    if (selectedModelKey === key && selectedModel) {
      const nextSelected = { ...selectedModel, thinkingLevel: next };
      setSelectedModel(nextSelected);
      onSelectModel?.(nextSelected);
      onThinkingLevelChange?.(next);
    }
  };

  const toggleAgentCmd = (model: AIModelOption) => {
    const next = !model.isCmdAgent;
    const key = modelKey(model);
    setModels((prev) => prev.map((entry) => (modelKey(entry) === key ? { ...entry, isCmdAgent: next } : entry)));
    if (selectedModelKey === key && selectedModel) setSelectedModel({ ...selectedModel, isCmdAgent: next });
    void fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: 'toggleCmd', provider: model.provider, modelId: model.id }),
    }).catch(() => {});
  };

  return { toggleFavorite, cycleThinking, toggleAgentCmd };
}
