import { useEffect, useState } from 'preact/hooks';
import { AlertTriangle, BookOpen, Loader2 } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';

interface PluginReadmeModalProps {
  pluginId: string;
  name: string;
  /** The registry's content-addressed README URL. */
  readmeUrl: string;
  onClose: () => void;
}

/**
 * A plugin's README, read before installing.
 *
 * The whole point of the button is that a user can judge a plugin WITHOUT
 * committing to it, so this modal installs nothing and touches nothing: it
 * fetches the markdown and renders it through Kabmo's own pipeline, which
 * is what gives a plugin's README the same sanitizing, Shiki highlighting,
 * KaTeX and mermaid hydration the chat timeline has. Raw HTML in the file is
 * sanitized, not trusted — a README is third-party content.
 *
 * A failed read says so. A modal that shows an empty body for a 404 is
 * indistinguishable from a plugin whose README is blank, and the two mean
 * opposite things.
 */
export function PluginReadmeModal({ pluginId, name, readmeUrl, onClose }: PluginReadmeModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(readmeUrl, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Could not read the README (${response.status})`);
        }
        return response.text();
      })
      .then(
        (text) => {
          if (!cancelled) setContent(text);
        },
        (cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [readmeUrl]);

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      header={
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={15} className="text-ink/50 flex-shrink-0" />
          <span className="text-sm font-medium text-ink truncate">{name}</span>
          <span className="text-[11px] text-ink/45 font-mono truncate">{pluginId}</span>
        </div>
      }
    >
      <div className="px-5 py-4">
        {error ? (
          <div className="flex items-start gap-2 text-error">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <p className="text-xs">{error}</p>
          </div>
        ) : content === null ? (
          <div className="flex items-center gap-2 text-ink/50">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Reading README…</span>
          </div>
        ) : (
          // `document` mode: the source IS the document, so its own markup and
          // relative links are what they look like, rather than the wiki's
          // reference rewriting.
          <MarkdownRenderer content={content} document className="text-xs" />
        )}
      </div>
    </Modal>
  );
}
