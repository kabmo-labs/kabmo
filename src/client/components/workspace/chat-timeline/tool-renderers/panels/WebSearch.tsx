import { ExternalLink } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

interface SearchResult {
  title?: unknown;
  url?: unknown;
  link?: unknown;
  snippet?: unknown;
  description?: unknown;
  publishedDate?: unknown;
}

function resultUrl(r: SearchResult): string {
  return typeof r.url === 'string' ? r.url : typeof r.link === 'string' ? r.link : '';
}

function resultTitle(r: SearchResult): string {
  return typeof r.title === 'string' && r.title ? r.title : resultUrl(r) || 'Result';
}

function resultSnippet(r: SearchResult): string {
  if (typeof r.snippet === 'string' && r.snippet) return r.snippet;
  return typeof r.description === 'string' ? r.description : '';
}

function parseWebSearchResults(output: string): SearchResult[] {
  if (!output) return [];
  try {
    const data = JSON.parse(output);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.results)) return data.results;
      if (Array.isArray(data.sources)) return data.sources;
      if (Array.isArray(data.organic)) return data.organic;
      if (Array.isArray(data.items)) return data.items;
      if (data.response && Array.isArray(data.response.sources)) return data.response.sources;
    }
  } catch {}
  return [];
}

/** Hasil pencarian untuk tool `web_search` — details.results[] / details.response.sources[] atau output. */
export function WebSearch({ tool }: { tool: ToolCallData }) {
  const details = (tool.details ?? {}) as Record<string, any>;
  const provider =
    typeof details.response?.provider === 'string'
      ? details.response.provider
      : typeof details.provider === 'string'
        ? details.provider
        : undefined;

  const rawItems: SearchResult[] = Array.isArray(details.results)
    ? details.results
    : Array.isArray(details.sources)
      ? details.sources
      : Array.isArray(details.response?.sources)
        ? details.response.sources
        : parseWebSearchResults(tool.output ?? '');

  const items = rawItems;

  if (items.length === 0) {
    if (!tool.output) return null;
    return <FallbackOutput text={tool.output} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8 bg-canvas/40">
      {provider && (
        <div className="flex items-center justify-between border-b border-ink/6 bg-paper px-2.5 py-1 text-[10px]">
          <span className="font-semibold uppercase tracking-wider text-ink/40">Sources</span>
          <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-ink/50 uppercase">
            {provider}
          </span>
        </div>
      )}
      <ol className="divide-y divide-ink/6">
        {items.map((r, index) => {
          const url = resultUrl(r);
          const pubDate = typeof r.publishedDate === 'string' ? r.publishedDate : undefined;
          return (
            <li key={index} className="px-2.5 py-2 text-[11.5px]">
              <div className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-ink/5 font-mono text-[10px] text-ink/45">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{resultTitle(r)}</span>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center rounded-md p-0.5 text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink"
                    title={url}
                  >
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 pl-[22px] font-mono text-[10px] text-ink/40">
                {url && <span className="truncate">{url}</span>}
                {pubDate && (
                  <span className="shrink-0 rounded bg-ink/5 px-1 py-0.2 text-[8.5px] text-ink/50">
                    {pubDate}
                  </span>
                )}
              </div>
              {resultSnippet(r) && (
                <div className="mt-0.5 pl-[22px] leading-snug text-ink/65">{resultSnippet(r)}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
