/**
 * One install line in About — `Kabmo v0.17.0` — with the "circle i" control
 * that opens that product's release notes.
 *
 * The version text and the control are one row because they describe one
 * subject: the version that is running. A separate pair of buttons above the
 * list read as an action on the update, which is the other question the updates
 * row already answers.
 */

import { Info } from 'lucide-preact';

export interface VersionLineProps {
  /** The version text exactly as it is shown, e.g. `Kabmo v0.17.0`. */
  label: string;
  /** Accessible name of the notes control; it names the product. */
  notesLabel: string;
  onNotes: () => void;
}

export function VersionLine({ label, notesLabel, onNotes }: VersionLineProps) {
  return (
    <p className="flex items-center justify-center gap-1.5">
      <span>{label}</span>
      <button
        type="button"
        onClick={onNotes}
        aria-label={notesLabel}
        title={notesLabel}
        className="rounded-full p-0.5 text-ink/40 transition-colors hover:text-ink focus-visible:text-ink"
      >
        <Info size={13} aria-hidden="true" />
      </button>
    </p>
  );
}