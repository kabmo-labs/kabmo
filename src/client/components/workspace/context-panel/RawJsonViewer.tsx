import { useCallback, useRef, useState } from 'preact/hooks';
import type { UIEvent } from 'preact/compat';
import type { TargetedMouseEvent } from 'preact';
import { Check, Copy } from 'lucide-preact';
import { highlightJson } from '@/shared/lib/code/syntax-highlight';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';

interface RawJsonViewerProps {
  data: Record<string, any>;
}

export function RawJsonViewer({ data }: RawJsonViewerProps) {
  useSyntaxReady();
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);

  const jsonString = JSON.stringify(data, null, 2);
  const highlightedHtml = highlightJson(jsonString);

  const syncOverlayScroll = useCallback((e: UIEvent<HTMLPreElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.scrollLeft = e.currentTarget.scrollLeft;
    overlay.scrollTop = e.currentTarget.scrollTop;
  }, []);

  const handleCopy = useCallback(async (e: TargetedMouseEvent<HTMLElement>) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(jsonString);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = jsonString;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [jsonString]);

  return (
    <div className="relative my-1.5 rounded-lg bg-paper/80 border border-ink/10 overflow-hidden">
      {/* Action Header Bar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-ink/[0.04] border-b border-ink/10">
        <span className="text-[10px] font-mono text-ink/50 select-none">
          {Object.keys(data).length} keys · {jsonString.length} chars
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center space-x-1 px-2 py-1 rounded bg-canvas hover:bg-paper text-ink/70 hover:text-ink border border-ink/10 text-[10px] transition-colors shadow-xs"
          title="Copy Pretty JSON"
        >
          {copied ? (
            <>
              <Check size={11} className="text-success" />
              <span className="text-success font-sans font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span className="font-sans">Copy JSON</span>
            </>
          )}
        </button>
      </div>

      {/* Code Block: inert highlight layer + real selectable text layer */}
      <div className="relative">
        {/* Highlight overlay — visuals only, non-interactive */}
        <pre
          ref={overlayRef}
          aria-hidden
          className="absolute inset-0 p-2.5 m-0 font-mono text-[11px] leading-5 overflow-x-auto overflow-y-auto whitespace-pre pointer-events-none"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />

        {/* Real selectable text — transparent ink, sits on top */}
        <pre
          ref={preRef}
          onScroll={syncOverlayScroll}
          className="relative p-2.5 m-0 font-mono text-[11px] leading-5 overflow-x-auto overflow-y-auto whitespace-pre select-text selection:bg-ink selection:text-canvas"
        >
          <code className="text-transparent">{jsonString}</code>
        </pre>
      </div>
    </div>
  );
}
