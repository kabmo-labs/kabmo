import { RefreshCw } from 'lucide-preact';

interface ReloadPageButtonProps {
  /** Icon size in px: the desktop navbar draws 16, the phone's header 18. */
  size?: number;
  /** The surface's own hit area and colours. Both layouts size controls differently. */
  className: string;
}

/**
 * Reload the page the user is looking at.
 *
 * ONE component for both layouts, because the two headers must agree on what
 * the control is called: the label is the accessible name a spec and a screen
 * reader address it by, and a per-layout copy is how one of them ends up as
 * "Refresh" while the other says "Reload".
 */
export function ReloadPageButton({ size = 16, className }: ReloadPageButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={className}
      title="Reload page"
      aria-label="Reload page"
    >
      <RefreshCw size={size} />
    </button>
  );
}
