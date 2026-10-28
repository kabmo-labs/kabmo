import { Check, Cpu, Eye, Minus, SlidersHorizontal, Terminal } from 'lucide-preact';
import type { ProviderModel } from '@/shared/types';
import { Modal } from '@/client/components/common/Modal';
import { MODEL_KIND_LABELS, modelKindOf } from '@/shared/lib/models/provider/dialect';

interface ModelCapabilitiesModalProps {
  isOpen: boolean;
  model: ProviderModel | null;
  onClose: () => void;
}

/**
 * One declared fact. `value` is `undefined` when the row states something
 * rather than answering yes/no (the model's kind), and `reported` marks a
 * boolean omp does not report at all — which is NOT the same answer as "no".
 */
interface CapabilityFact {
  title: string;
  desc: string;
  value: boolean | undefined;
  reported?: boolean;
  icon: typeof Check;
  detail?: string;
  /** `false` for a row that STATES a fact (the kind) rather than answering. */
  badge?: boolean;
}

/**
 * What omp reports about ONE model — nothing more.
 *
 * The previous version listed five capabilities and hardcoded two of them as
 * "Supported" for every model on earth ("Structured Output", "Streaming"),
 * which is a claim the panel cannot make and omp does not report. A row here is
 * a field from the model's own record (`input`, `thinking`, `kind`), so the
 * dialog can only ever say what the agent itself would say.
 *
 * An unreported field reads `—` rather than "Not supported": absence in the
 * catalog is not a denial, and the two are different answers.
 */
export function ModelCapabilitiesModal({ isOpen, model, onClose }: ModelCapabilitiesModalProps) {
  if (!isOpen || !model) return null;

  const kind = modelKindOf(model.kind);
  const efforts = model.thinkingEfforts ?? [];
  const facts: CapabilityFact[] = [
    {
      title: 'Tool & function calling',
      desc: 'The model can emit tool calls the agent executes (file edits, shell, search).',
      value: model.hasTools,
      icon: Terminal,
    },
    {
      title: 'Image input',
      desc: 'Accepts screenshots, diagrams and image attachments on the wire.',
      value: model.hasVision,
      icon: Eye,
    },
    {
      title: 'Reasoning',
      desc: 'Produces thinking blocks before its answer.',
      value: model.hasReasoning,
      reported: model.hasReasoning === undefined,
      icon: Cpu,
      ...(efforts.length > 0
        ? { detail: `Levels: ${efforts.join(' · ')}${model.thinkingMode ? ` (${model.thinkingMode})` : ''}` }
        : {}),
    },
    {
      title: 'Catalog kind',
      desc: 'Which role omp resolves this model for.',
      value: undefined,
      badge: false,
      icon: SlidersHorizontal,
      detail: `${MODEL_KIND_LABELS[kind]} (${kind})`,
    },
  ];

  return (
    <Modal
      onClose={onClose}
      header={
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-ink/70" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Model capabilities</h3>
            <p className="text-[11px] text-ink/50 font-mono truncate max-w-[280px]">{model.id}</p>
          </div>
        </div>
      }
      footer={
        <div className="px-5 py-3 border-t border-ink/10 flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink/45">
            Read from omp’s own model record — “not reported” means the catalog says nothing,
            which is not the same as “no”.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-3">
        {facts.map((fact) => {
          const Icon = fact.icon;
          return (
            <div
              key={fact.title}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-ink/5 border border-ink/10"
            >
              <div className="p-1.5 rounded bg-ink/10 text-ink mt-0.5">
                <Icon size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{fact.title}</span>
                  {fact.value === undefined ? (
                    fact.badge === false ? null : fact.reported ? (
                      <span
                        className="text-[10px] text-ink/35 font-medium uppercase tracking-wider"
                        title="omp’s catalog reports nothing for this field"
                      >
                        not reported
                      </span>
                    ) : null
                  ) : fact.value ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-semibold uppercase tracking-wider">
                      <Check size={11} strokeWidth={2.5} />
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-ink/40 font-medium uppercase tracking-wider">
                      <Minus size={11} strokeWidth={2.5} />
                      No
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink/60 mt-0.5 leading-relaxed">{fact.desc}</p>
                {fact.detail && (
                  <p className="text-[10px] font-mono text-ink/50 mt-1 select-text">{fact.detail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
