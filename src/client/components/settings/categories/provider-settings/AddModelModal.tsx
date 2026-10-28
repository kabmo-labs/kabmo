import { useState } from 'preact/hooks';
import type { FormEvent } from 'preact/compat';
import { Check, Globe, Hash, Layers, Plus, Sparkles } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { addProviderModel, type ManualModelRequest } from '@/shared/lib/models/provider/models';
import {
  MODEL_KINDS,
  MODEL_KIND_LABELS,
  PROVIDER_THINKING_EFFORTS,
  type ProviderModelKind,
  type ProviderThinkingEffort,
} from '@/shared/lib/models/provider/dialect';
import { Modal } from '@/client/components/common/Modal';
import { EffortLadder } from '@/client/components/settings/categories/provider-settings/EffortLadder';
import { PriceFields } from '@/client/components/settings/categories/provider-settings/PriceFields';

interface AddModelModalProps {
  isOpen: boolean;
  provider: ProviderItem;
  onClose: () => void;
  /** Called after a successful write so the list and the chat picker refresh. */
  onAdded: (modelId: string) => void;
  /** Reports a refusal the dialog cannot fix itself (bad endpoint, bad key). */
  onError: (message: string) => void;
}

/**
 * Register ONE model by hand.
 *
 * The auto-fetch needs a listing endpoint, and plenty of real providers have
 * none worth using: an Azure deployment is a name the user chose, a gateway may
 * serve a model its `/models` route omits, and Bedrock/Vertex expose no
 * `/models` at all. This dialog writes the same models.yml entry the fetch
 * would, with the metadata the user actually knows.
 *
 * Only `id` is required. Every other field is metadata omp can work without —
 * a missing context window is estimated, a missing price is simply not
 * accounted — so requiring them would block the common case of "just add this
 * id I know exists".
 */
export function AddModelModal({
  isOpen,
  provider,
  onClose,
  onAdded,
  onError,
}: AddModelModalProps) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [costInput, setCostInput] = useState('');
  const [costOutput, setCostOutput] = useState('');
  const [costCacheRead, setCostCacheRead] = useState('');
  const [costCacheWrite, setCostCacheWrite] = useState('');
  const [kind, setKind] = useState<ProviderModelKind>('chat');
  const [reasoning, setReasoning] = useState(false);
  const [imageInput, setImageInput] = useState(false);
  const [efforts, setEfforts] = useState<ProviderThinkingEffort[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const trimmedId = id.trim();
  const duplicate = provider.models.some((model) => model.id === trimmedId);
  const idError = !trimmedId
    ? 'Enter the model id exactly as the provider expects it.'
    : duplicate
      ? `"${trimmedId}" is already registered under this provider.`
      : '';
  const numberError = (value: string, label: string): string =>
    value.trim() && !(Number(value) > 0) ? `${label} must be a positive number of tokens.` : '';
  const limitsError = numberError(contextWindow, 'Context window') || numberError(maxTokens, 'Max output');
  const costError = (value: string): string =>
    value.trim() && !(Number(value) >= 0) ? 'Prices must be zero or more USD per 1M tokens.' : '';
  const priceError = costError(costInput) || costError(costOutput)
    || costError(costCacheRead) || costError(costCacheWrite);
  // A price is written only when BOTH headline sides are known: omp's schema
  // requires all four cost fields together, so half a price is not a price. The
  // two cache rates may be left empty — they are written as 0, which is what
  // "no cached-token discount" means.
  const halfPrice = Boolean(costInput.trim()) !== Boolean(costOutput.trim())
    ? 'Enter both input and output price, or neither.'
    : (costCacheRead.trim() || costCacheWrite.trim()) && !costInput.trim()
      ? 'A cache rate needs the input and output price too.'
      : '';
  // The ladder is a capability of a reasoning model; ticking levels while
  // Reasoning is off would describe a model omp is not told can reason.
  const ladderError = !reasoning && efforts.length > 0
    ? 'Turn on Reasoning to declare its levels.'
    : '';
  const canSubmit = Boolean(trimmedId) && !idError && !limitsError && !priceError
    && !halfPrice && !ladderError && !isSubmitting;

  const numberOrUndefined = (value: string): number | undefined => {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
  };

  const toggleEffort = (effort: ProviderThinkingEffort) => {
    setEfforts((prev) => (
      prev.includes(effort)
        ? prev.filter((entry) => entry !== effort)
        // Kept in omp's own order so the written ladder reads lowest-first
        // regardless of the order the user ticked the boxes.
        : PROVIDER_THINKING_EFFORTS.filter((level) => level === effort || prev.includes(level))
    ));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const request: ManualModelRequest = {
        provider: provider.slug,
        id: trimmedId,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(numberOrUndefined(contextWindow) !== undefined
          ? { contextWindow: numberOrUndefined(contextWindow) }
          : {}),
        ...(numberOrUndefined(maxTokens) !== undefined ? { maxTokens: numberOrUndefined(maxTokens) } : {}),
        ...(kind !== 'chat' ? { kind } : {}),
        ...(reasoning ? { reasoning: true } : {}),
        ...(reasoning && efforts.length > 0 ? { efforts } : {}),
        ...(imageInput ? { imageInput: true } : {}),
        ...(costInput.trim() && costOutput.trim()
          ? {
            costInput: numberOrUndefined(costInput),
            costOutput: numberOrUndefined(costOutput),
            // Empty cache rates become 0 in the seed builder; sending them only
            // when typed keeps the request honest about what the user entered.
            ...(numberOrUndefined(costCacheRead) !== undefined
              ? { costCacheRead: numberOrUndefined(costCacheRead) }
              : {}),
            ...(numberOrUndefined(costCacheWrite) !== undefined
              ? { costCacheWrite: numberOrUndefined(costCacheWrite) }
              : {}),
          }
          : {}),
        // The endpoint and credential are only consulted for a provider with no
        // models.yml entry yet; the writer is add-only and keeps an existing
        // one. A keyless provider passes `auth: none` so omp accepts the entry
        // without a credential.
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        ...(provider.auth ? { auth: provider.auth } : {}),
      };
      const result = await addProviderModel(request);
      if (!result.success) {
        // The refusal is the actionable half (an endpoint override with no
        // credential, a provider not in models.yml) — surface it verbatim.
        onError(result.error || result.reason || `Could not register ${trimmedId}.`);
        return;
      }
      onAdded(trimmedId);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      header={
        <div className="flex items-center gap-2">
          <Plus size={16} className="text-ink/70" />
          <div>
            <h3 className="text-sm font-semibold text-ink">Add Model</h3>
            <p className="text-[11px] text-ink/50 font-mono truncate max-w-[280px]">{provider.slug}</p>
          </div>
        </div>
      }
      form={{ onSubmit: handleSubmit, className: 'p-5 space-y-4' }}
      footer={
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-ink/20 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3.5 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Layers size={14} className="animate-pulse" />
                <span>Registering...</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>Add Model</span>
              </>
            )}
          </button>
        </div>
      }
    >
      {/* Model id */}
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">Model ID</label>
        <div className="relative flex items-center">
          <Hash size={13} className="absolute left-2.5 text-ink/40 pointer-events-none" />
          <input
            type="text"
            required
            autoFocus
            value={id}
            onChange={(e) => setId(e.currentTarget.value)}
            placeholder="e.g. claude-sonnet-5 or my-deployment"
            className="w-full bg-paper border border-ink/20 rounded-md pl-8 pr-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60 font-mono"
          />
        </div>
        {idError && <p className="text-[11px] text-error mt-1">{idError}</p>}
        <p className="text-[10px] text-ink/40 mt-1">
          Sent to the provider verbatim — this is the id omp puts on the wire.
        </p>
      </div>

      {/* Display name */}
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">
          Display Name <span className="font-normal text-ink/40">— optional</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Shown in the chat model picker"
          className="w-full bg-paper border border-ink/20 rounded-md px-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60"
        />
      </div>

      {/* Kind: which role omp resolves this model for. A provider routinely
          serves an embedding, image or rerank model beside its chat models, and
          registering one as `chat` made it appear in the chat picker and behave
          oddly there. */}
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">Kind</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value as ProviderModelKind)}
          className="w-full text-xs py-2 px-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-ink transition-colors cursor-pointer"
        >
          {MODEL_KINDS.map((value) => (
            <option key={value} value={value}>{MODEL_KIND_LABELS[value]}</option>
          ))}
        </select>
        <p className="text-[10px] text-ink/40 mt-1">
          Chat is omp’s default. A non-chat kind keeps this model out of the chat picker.
        </p>
      </div>

      {/* Limits */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Context window <span className="font-normal text-ink/40">— tokens</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={contextWindow}
            onChange={(e) => setContextWindow(e.currentTarget.value)}
            placeholder="200000"
            className="w-full bg-paper border border-ink/20 rounded-md px-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Max output <span className="font-normal text-ink/40">— tokens</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.currentTarget.value)}
            placeholder="8192"
            className="w-full bg-paper border border-ink/20 rounded-md px-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60 font-mono"
          />
        </div>
      </div>
      {limitsError && <p className="text-[11px] text-error -mt-2">{limitsError}</p>}

      {/* Capabilities */}
      <div>
        <label className="block text-xs font-semibold text-ink mb-1.5">Capabilities</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setReasoning((prev) => !prev)}
            aria-pressed={reasoning}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-[11px] transition-colors cursor-pointer ${
              reasoning ? 'border-ink/50 bg-ink/5 font-semibold text-ink' : 'border-ink/15 hover:border-ink/30 text-ink/70'
            }`}
          >
            <Sparkles size={13} className="shrink-0" />
            <span className="truncate">Reasoning</span>
          </button>
          <button
            type="button"
            onClick={() => setImageInput((prev) => !prev)}
            aria-pressed={imageInput}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-[11px] transition-colors cursor-pointer ${
              imageInput ? 'border-ink/50 bg-ink/5 font-semibold text-ink' : 'border-ink/15 hover:border-ink/30 text-ink/70'
            }`}
          >
            <Globe size={13} className="shrink-0" />
            <span className="truncate">Vision</span>
          </button>
        </div>
        <p className="text-[10px] text-ink/40 mt-1">
          Leave both off when unsure — omp still serves the model; only its declared abilities change.
        </p>
      </div>

      {/* Reasoning levels — only meaningful for a reasoning model */}
      {reasoning && (
        <EffortLadder
          selected={efforts}
          onToggle={toggleEffort}
          onSelectAll={() => setEfforts([...PROVIDER_THINKING_EFFORTS])}
          onClear={() => setEfforts([])}
        />
      )}
      {ladderError && <p className="text-[11px] text-error -mt-2">{ladderError}</p>}

      <PriceFields
        costInput={costInput}
        costOutput={costOutput}
        costCacheRead={costCacheRead}
        costCacheWrite={costCacheWrite}
        onCostInputChange={setCostInput}
        onCostOutputChange={setCostOutput}
        onCostCacheReadChange={setCostCacheRead}
        onCostCacheWriteChange={setCostCacheWrite}
        error={priceError || halfPrice}
      />
    </Modal>
  );
}
