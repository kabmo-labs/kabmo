import { useEffect, useState } from 'preact/hooks';
import { Bot } from 'lucide-preact';
import { providerLabel } from '@/shared/lib/models/provider/label';

interface GeneratingIndicatorProps {
  modelName?: string;
  generatingVerb?: string;
  provider?: string;
  providerNames?: Record<string, string>;
  /**
   * DOM id for the docked row. Two indicators can be mounted at once — the chat
   * run and a side question both streaming — so a second caller must pass its
   * own id rather than duplicating the default one.
   */
  id?: string;
}

const COOL_VERBS = [
  'Synthesizing solution',
  'Evaluating context',
  'Reading workspace',
  'Planning next step',
  'Executing diagnostics',
  'Compiling edge routes'
];

/**
 * The trailing ellipsis every state shares.
 *
 * `shrink-0` is load-bearing: the dots are the indicator's only sign of life,
 * so they must never be the thing a long activity phrase squeezes out. They sit
 * BESIDE the truncated verb, never inside it — a sibling of a `truncate`
 * element is the only way they survive.
 */
function Dots() {
  return (
    <span className="inline-flex shrink-0 tracking-wider text-ink/80 ml-0.5">
      <span className="dot-anim-1 inline-block">.</span>
      <span className="dot-anim-2 inline-block">.</span>
      <span className="dot-anim-3 inline-block">.</span>
    </span>
  );
}

export function GeneratingIndicator({ modelName, generatingVerb, provider, providerNames, id = 'generating-docked-indicator' }: GeneratingIndicatorProps) {
  const [activeVerbIndex, setActiveVerbIndex] = useState(0);

  // Rotate action verb every 2.8s
  useEffect(() => {
    if (generatingVerb) return;
    const interval = setInterval(() => {
      setActiveVerbIndex((prev) => (prev + 1) % COOL_VERBS.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [generatingVerb]);

  const displayVerb = generatingVerb 
    ? (generatingVerb.charAt(0).toUpperCase() + generatingVerb.slice(1))
    : COOL_VERBS[activeVerbIndex];

  const providerText = provider ? providerLabel(provider, providerNames) : '';
  // The identity half is genuinely unknown for the first seconds of a fresh
  // spawn: a pending `new-…` session has no sidebar row yet, and the resolved
  // model only arrives with the spawn response (`seedSession`). An empty slot
  // rendered as `• Thinking…` — a bullet with nothing in front of it. Name the
  // wait instead of painting a blank identity.
  const modelText = modelName?.trim() ?? '';
  // One half is enough to name the run — a provider-only identity still says
  // which account is answering. Only "neither" is the unknown state.
  const identityKnown = Boolean(providerText || modelText);

  return (
    <div 
      id={id}
      className="w-full flex items-center px-1 py-1 bg-transparent border-0 border-none text-[11px] font-mono select-none animate-in fade-in duration-200"
    >
      <style>{`
        @keyframes bounce-dot {
          0%, 100% { opacity: 0.2; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-15%); }
        }
        .dot-anim-1 { animation: bounce-dot 1.2s infinite both; }
        .dot-anim-2 { animation: bounce-dot 1.2s infinite both 0.2s; }
        .dot-anim-3 { animation: bounce-dot 1.2s infinite both 0.4s; }
      `}</style>

      {/* Left info: Animated Rainbow Spinner Ring + Bot Badge + Model Name + Dynamic Action Verb */}
      <div className="flex items-center space-x-2 min-w-0 flex-1">
        
        {/* Bot Icon with Animated Colorful Gradient Spinner */}
        <div className="relative w-4 h-4 rounded flex items-center justify-center shrink-0">
          {/* Multi-color conic gradient spinner ring */}
          <div 
            className="absolute -inset-[1.5px] rounded-[5px] animate-spin"
            style={{
              background: 'conic-gradient(from 0deg, #ff453a, #ff9f0a, #ffd60a, #30d158, #64d2ff, #0a84ff, #bf5af2, #ff375f, #ff453a)',
              animationDuration: '1.2s'
            }}
          />
          {/* Center Dark Bot Badge */}
          <div className="relative w-full h-full rounded-[3px] bg-ink flex items-center justify-center text-canvas z-10 shadow-2xs">
            <Bot size={10} className="text-canvas" />
          </div>
        </div>

        {/* Provider & model name with dynamic verb + dots. When neither half is
            known yet (a spawn still in flight) the slot names the WAIT rather
            than drawing a bullet with an empty identity in front of it.

            Shrink priority is the whole layout contract here. The activity
            phrase is the ONLY shrinkable member (it is `flex-1` with a 0%
            basis and `min-w-0`), so a long command — a `bash` line, a grep
            pattern, a file path — gives up its width first and ends in an
            ellipsis. The identity spans keep their natural width and only
            ellipsize when the row cannot fit them at all, and the dots are a
            `shrink-0` SIBLING of the truncated phrase rather than part of it:
            when the phrase was one non-shrinking span, a long command pushed
            the provider, the model and the dots out of the row entirely —
            which is the reported "provider and model and the loading dots are
            not visible". */}
        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
          {identityKnown ? (
            <>
              {providerText && (
                <span className="text-ink/55 truncate shrink min-w-0">{providerText}</span>
              )}
              {modelText && (
                <span className="font-semibold text-ink truncate shrink min-w-0">
                  {modelText}
                </span>
              )}
              {/* The separator belongs to the PAIR: a provider-only identity has
                  nothing for it to separate. */}
              {providerText && modelText && <span className="text-ink/40 shrink-0">•</span>}
              {/* `min-w-[4rem]` is the floor that keeps the phrase READABLE: a
                  row too narrow for even that gives the identity its room back
                  (both identity spans are `min-w-0`), so the verb can never be
                  squeezed to nothing while a truncated phrase is the point. */}
              <span className="text-ink/75 flex items-center space-x-1 min-w-[4rem] flex-1 font-medium">
                <span className="truncate min-w-0 transition-all duration-300" title={displayVerb}>
                  {displayVerb}
                </span>
                <Dots />
              </span>
            </>
          ) : (
            <span className="text-ink/55 flex items-center space-x-1 shrink-0">
              <span>Loading</span>
              <Dots />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
