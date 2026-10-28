/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's model selection: which model and thinking level it is set to,
 * and the three sources that can move it.
 *
 * Extracted from the composer component because the precedence between those
 * sources is the whole rule, and it is easier to state — and to test — on its
 * own than inline among a component's other effects:
 *
 * 1. **A pending pick wins over everything.** `deferredComposerPickRef` holds a
 *    selection the user made for the NEXT prompt; every branch below would
 *    replace it with a session or catalog default.
 * 2. **The active session's last-used model is authoritative**, even when the
 *    catalog does not list it — replacing a model a session actually ran with
 *    the registry default is a silent change of behaviour.
 * 3. **The user's persisted pick** survives a new session.
 * 4. **The registry default** is the last resort.
 *
 * The refs mirror the session values so the async sync does not clobber a value
 * that arrived while it was in flight.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AIModelOption, ModelEntry } from '@/shared/types';
import { fetchModelsData, subscribeModelsUpdated } from '@/shared/lib/models/client';
import { selectableThinkingLevels } from '@/shared/lib/models/thinking-levels';
import { resolveThinkingLevel, selectionFor } from '@/client/components/workspace/chat-timeline/chat-input/selection';


/** Pick the catalog entry that matches `modelId` + `provider`, or undefined. */
function matchModel(list: readonly ModelEntry[], provider: string, id: string): ModelEntry | undefined {
  return list.find((entry) => entry.id === id && entry.provider === provider);
}

/**
 * Merge a catalog entry with the thinking level in force, keeping the previous
 * selection's identity when nothing moved — so a re-sync does not re-render
 * every consumer of the model.
 */
export interface ModelSelectionOptions {
  /**
   * Live mirror of the current pick, for the send path's queue snapshot.
   *
   * The composer does not read state when it sends — it reads this ref — so the
   * mirror is written here, where the selection lives.
   */
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  sessionModel: { provider: string; modelId: string } | null | undefined;
  sessionThinkingLevel: string | null | undefined;
  /** A selection the user made for the NEXT prompt; it outranks every default. */
  deferredComposerPickRef: { current: { provider?: string; modelId?: string; thinkingLevel?: string } | null };
  onThinkingLevelChange?: (level: string) => void;
}

export interface ModelSelection {
  selectedModel: AIModelOption | null;
  /**
   * Replace the selection. Takes a VALUE or an updater, mirroring the state
   * setter it wraps: the toolbar sets a value, while the sync effects resolve
   * against the previous selection.
   */
  setSelectedModel: (next: AIModelOption | null | ((prev: AIModelOption | null) => AIModelOption | null)) => void;
  thinkingLevels: string[];
  currentThinking: string;
  selectThinking: (level: string) => void;
}

export function useModelSelection({
  composerModelRef,
  sessionModel,
  sessionThinkingLevel,
  deferredComposerPickRef,
  onThinkingLevelChange,
}: ModelSelectionOptions): ModelSelection {
  // Starts null and is filled from `/api/models`. Seeding a demo catalog entry
  // here showed a fabricated provider in the composer before the real list
  // arrived.
  const [selectedModel, setSelectedModel] = useState<AIModelOption | null>(null);
  const [currentThinking, setCurrentThinking] = useState('auto');

  // Live mirror for the send path's queue snapshot (see composerModelRef).
  useEffect(() => {
    if (!selectedModel?.id) return;
    composerModelRef.current = {
      provider: selectedModel.provider,
      modelId: selectedModel.id,
      thinkingLevel: selectedModel.thinkingLevel ?? 'auto',
    };
  }, [selectedModel?.provider, selectedModel?.id, selectedModel?.thinkingLevel, composerModelRef]);

  // Live mirrors, so an async sync reads the value in force when it lands.
  const sessionThinkingLevelRef = useRef<string | null>(null);
  sessionThinkingLevelRef.current = sessionThinkingLevel ?? null;
  const sessionModelRef = useRef<{ provider: string; modelId: string } | null>(sessionModel ?? null);
  sessionModelRef.current = sessionModel ?? null;

  // Adopt the active session's model. A pending pick wins over adoption.
  useEffect(() => {
    if (!sessionModel?.provider || !sessionModel.modelId) return;
    if (deferredComposerPickRef.current) return;
    let active = true;
    fetchModelsData()
      .then((data) => {
        if (!active || !sessionModel) return;
        if (deferredComposerPickRef.current) return;
        const match = matchModel(data.modelList || [], sessionModel.provider, sessionModel.modelId);
        if (match) setSelectedModel((prev) => selectionFor(match, sessionThinkingLevelRef.current, prev));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sessionModel?.provider, sessionModel?.modelId, deferredComposerPickRef]);

  // Adopt the session's thinking level; a pending pick wins.
  useEffect(() => {
    if (!sessionThinkingLevel) return;
    if (deferredComposerPickRef.current?.thinkingLevel) return;
    setSelectedModel((prev) => {
      if (!prev) return prev;
      const level = resolveThinkingLevel(prev.thinkingLevels, sessionThinkingLevel, prev.thinkingLevel);
      return level === prev.thinkingLevel ? prev : { ...prev, thinkingLevel: level };
    });
  }, [sessionThinkingLevel, deferredComposerPickRef]);

  // The catalog, re-read on every models-changed announcement.
  useEffect(() => {
    let active = true;
    const syncModel = async () => {
      try {
        const data = await fetchModelsData();
        if (!active) return;
        // A pick waiting for the next prompt owns the composer's selection.
        if (deferredComposerPickRef.current) return;
        if (Array.isArray(data.modelList) && data.modelList.length > 0) {
          const fromSession = sessionModelRef.current;
          if (fromSession?.provider && fromSession.modelId) {
            const match = matchModel(data.modelList, fromSession.provider, fromSession.modelId);
            if (match) setSelectedModel((prev) => selectionFor(match, sessionThinkingLevelRef.current, prev));
            return;
          }
          const persisted = data.selectedModel;
          if (persisted?.provider && persisted.id) {
            const match = matchModel(data.modelList, persisted.provider, persisted.id);
            if (match) {
              setSelectedModel((prev) => selectionFor(match, sessionThinkingLevelRef.current, prev));
              return;
            }
          }
          const fallback = data.defaultModel;
          if (fallback) {
            const match = matchModel(data.modelList, fallback.provider, fallback.modelId);
            if (match) setSelectedModel((prev) => selectionFor(match, sessionThinkingLevelRef.current, prev));
          }
        } else if (data.selectedModel) {
          const selected = data.selectedModel;
          setSelectedModel((prev) => ({
            ...selected,
            thinkingLevel: resolveThinkingLevel(
              selected.thinkingLevels,
              sessionThinkingLevelRef.current,
              prev?.thinkingLevel ?? selected.thinkingLevel,
            ),
          }));
        }
      } catch {
        // A failed read leaves the previous selection in place.
      }
    };

    syncModel();
    const unsubscribe = subscribeModelsUpdated(syncModel);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [deferredComposerPickRef]);

  const thinkingLevels = useMemo(() => selectableThinkingLevels(selectedModel?.thinkingLevels), [selectedModel]);

  const selectThinking = (level: string) => {
    setCurrentThinking(level);
    setSelectedModel((prev) => (prev ? { ...prev, thinkingLevel: level } : prev));
    onThinkingLevelChange?.(level);
  };

  // Re-sync the dropdown label when the model picker's own pill moves the level.
  useEffect(() => {
    if (selectedModel?.thinkingLevel) setCurrentThinking(selectedModel.thinkingLevel);
  }, [selectedModel?.thinkingLevel]);

  return { selectedModel, setSelectedModel, thinkingLevels: [...thinkingLevels], currentThinking, selectThinking };
}
