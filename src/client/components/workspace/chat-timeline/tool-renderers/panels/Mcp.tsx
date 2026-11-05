import { useMemo } from 'preact/hooks';
import { Boxes, Braces } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { tryParseJson } from '@/shared/lib/code/syntax-highlight';
import { isRecord } from '@/shared/lib/util/guards';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';

/** Cap daftar agar payload besar (hasil MCP panjang) tetap renderable. */
const MAX_LIST_ITEMS = 50;
/** String di atas panjang ini (atau multiline) dirender sebagai markdown penuh. */
const MD_BLOCK_MIN_LENGTH = 120;

/** Node nilai rekursif: array → list, object → per-key, string → markdown,
 *  primitif lain → teks mono. Dipakai untuk argumen dan hasil MCP. */
function ValueNode({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <ListNode items={value} />;
  if (isRecord(value)) return <ObjectNode data={value} />;

  if (typeof value === 'string') {
    if (value.length > MD_BLOCK_MIN_LENGTH || value.includes('\n')) {
      return (
        <div className="prose-content max-h-60 overflow-auto rounded-lg border border-ink/8 bg-paper px-3 py-2.5 text-[12px] leading-relaxed text-ink/85 select-text">
          <MarkdownRenderer content={value} />
        </div>
      );
    }
    return <span className="break-words text-[12px] leading-relaxed text-ink/85">{value}</span>;
  }

  return <span className="font-mono text-[12px] text-ink/85">{JSON.stringify(value) ?? ''}</span>;
}

/** JSON list → ordered list bernomor (gaya chip index seperti WebSearch). */
function ListNode({ items }: { items: unknown[] }) {
  const shown = items.slice(0, MAX_LIST_ITEMS);
  return (
    <div className="space-y-1">
      <ol className="divide-y divide-ink/6 overflow-hidden rounded-lg border border-ink/8 bg-canvas/40">
        {shown.map((item, index) => (
          <li key={index} className="flex items-start gap-2 px-2.5 py-1.5">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-ink/5 font-mono text-[10px] text-ink/45">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <ValueNode value={item} />
            </div>
          </li>
        ))}
      </ol>
      {items.length > shown.length && (
        <div className="font-mono text-[10px] text-ink/45">… {items.length - shown.length} more items</div>
      )}
    </div>
  );
}

/** JSON object → satu baris per key: label mono + badge tipe + nilai. */
function ObjectNode({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div className="rounded-lg border border-ink/8 bg-canvas/40 px-2.5 py-2 text-[11px] text-ink/45">Empty object</div>;
  }
  return (
    <div className="divide-y divide-ink/6 overflow-hidden rounded-lg border border-ink/8 bg-canvas/40">
      {entries.map(([key, value]) => {
        const badge = Array.isArray(value)
          ? `list · ${value.length}`
          : isRecord(value)
            ? 'json'
            : typeof value === 'string'
              ? 'markdown'
              : typeof value;
        return (
          <div key={key} className="px-2.5 py-2">
            <div className="mb-1 flex items-center gap-1.5">
              <Braces size={10.5} className="shrink-0 text-ink/45" />
              <span className="truncate font-mono text-[10.5px] font-semibold text-ink" title={key}>
                {key}
              </span>
              <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[8.5px] uppercase tracking-wider text-ink/50">
                {badge}
              </span>
            </div>
            <ValueNode value={value} />
          </div>
        );
      })}
    </div>
  );
}

/** Panel untuk tool MCP — dipanggil agent sebagai `write xd://mcp__<tool>`
 *  (argumen JSON di `input.content`) atau langsung bernama `mcp__<tool>`.
 *  Argumen JSON dirender per key; value non-JSON sebagai markdown;
 *  JSON list sebagai list. Output fallback ke FallbackOutput, atau per-key
 *  bila hasilnya juga JSON object/list. */
export function Mcp({ tool }: { tool: ToolCallData }) {
  const inputObj =
    typeof tool.input === 'object' && tool.input !== null ? (tool.input as Record<string, unknown>) : undefined;

  const path = typeof inputObj?.path === 'string' ? inputObj.path : tool.target || '';
  const name = typeof tool.name === 'string' ? tool.name : '';
  const device = (path ? path.replace(/^xd:\/\//, '') : name).replace(/^mcp__/, '');
  const content = typeof inputObj?.content === 'string' ? inputObj.content : '';

  const parsedArgs = useMemo(() => (content ? tryParseJson(content) : { isValid: false }), [content]);
  const argsData = parsedArgs.isValid ? parsedArgs.data : undefined;
  const argsStructured = isRecord(argsData) || Array.isArray(argsData);

  const parsedOutput = useMemo(() => (tool.output ? tryParseJson(tool.output) : { isValid: false }), [tool.output]);
  const outputData = parsedOutput.isValid ? parsedOutput.data : undefined;
  const outputStructured = isRecord(outputData) || Array.isArray(outputData);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-ink/8 bg-paper px-2.5 py-1.5">
        <Boxes size={12} className="shrink-0 text-ink/60" />
        <span className="truncate font-mono text-[10.5px] font-semibold text-ink">{device || 'MCP Tool'}</span>
        <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[8.5px] uppercase tracking-wider text-ink/50">
          MCP
        </span>
      </div>

      {content && argsStructured ? (
        <ValueNode value={argsData} />
      ) : content ? (
        <div className="prose-content max-h-72 overflow-auto rounded-lg border border-ink/8 bg-paper px-3 py-2.5 text-[12px] leading-relaxed text-ink/85 select-text">
          <MarkdownRenderer content={content} />
        </div>
      ) : null}

      {tool.output && outputStructured ? (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">Result</div>
          <ValueNode value={outputData} />
        </div>
      ) : tool.output ? (
        <FallbackOutput text={tool.output} />
      ) : null}
    </div>
  );
}
