import { AlertCircle, Bell, Boxes } from 'lucide-preact';
import { isReminderTag, type XmlEnvelope } from '@/shared/lib/chat/xml-envelope';
import { toTitleCase } from '@/shared/lib/chat/title-case';

/** Badge tone per wrapper family: a system reminder is advisory (warning), an
 *  error envelope is a failure, anything else is informational. */
function envelopeTone(tag: string) {
  if (isReminderTag(tag)) {
    return { icon: <Bell size={12} />, badge: 'bg-warning/10 text-warning' };
  }
  if (tag === 'error' || tag === 'failure') {
    return { icon: <AlertCircle size={12} />, badge: 'bg-error/10 text-error' };
  }
  return { icon: <Boxes size={12} />, badge: 'bg-info/10 text-info' };
}

/** Identity row for one peeled XML envelope: which wrapper carried the output
 *  and the attributes it declared — for a system reminder those are the rule
 *  that fired and the file behind it, which is the reason the wrapper existed. */
function EnvelopeRow({ envelope }: { envelope: XmlEnvelope }) {
  const tone = envelopeTone(envelope.tag);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${tone.badge}`}>
        {tone.icon}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/60">
        {toTitleCase(envelope.tag)}
      </span>
      {Object.entries(envelope.attributes).map(([key, value]) => (
        <span
          key={key}
          title={`${key}=${value}`}
          className="max-w-[240px] truncate rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] text-ink/60"
        >
          {value ? `${key}=${value}` : key}
        </span>
      ))}
    </div>
  );
}

interface EnvelopeHeaderProps {
  /** Every wrapper the output was peeled out of, in order. omp emits one
   *  reminder per matched rule, so a single tool result can open with several. */
  envelopes: XmlEnvelope[];
}

/** One identity row per peeled wrapper. */
export function EnvelopeHeader({ envelopes }: EnvelopeHeaderProps) {
  return (
    <>
      {envelopes.map((envelope, index) => (
        <EnvelopeRow key={index} envelope={envelope} />
      ))}
    </>
  );
}
