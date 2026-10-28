/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a tool card's header says: its title and the one line under it.
 *
 * This was a chain of `else if` inside the card, which made the header
 * inseparable from the markup and pushed the file past the repo's size ceiling.
 * It is a pure function of the tool call now, so the naming rules can be read
 * (and tested) without mounting anything.
 *
 * The title comes from the tool's own name; the subtitle is the most specific
 * identifier available — a device's action, an eval's own label, an MCP tool's
 * subject, the target path. A subtitle is never a raw `xd://` URL: the device
 * names the action, and the URL is transport.
 */

import type { ToolCallData } from '@/shared/types/chat';
import { toTitleCase } from '@/shared/lib/chat/title-case';
import { parseAskQuestions } from '@/shared/lib/chat/ask-questions';
import { procOpLabel, procPathOf, procViewOf } from '@/shared/lib/omp/session/proc';
import { waitViewOf } from '@/shared/lib/omp/session/wait';
import { isXdDocRead, xdDocPath } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';
import { resolveTargetFile } from '@/client/components/workspace/chat-timeline/tool-renderers';
import {
  evalInputTitle,
  mcpSubjectOf,
  mcpToolNameOf,
  xdevOf,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/card-helpers';

export interface ToolCardHeader {
  title: string;
  subtitle?: string;
}

/** One line under the title, capped so it never eats the header row. */
function clip(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function subtitleFromTitle(title: string): { title: string; subtitle?: string } | null {
  const parts = title.split(/\s+[—\-:]\s+/);
  if (parts.length < 2) return null;
  return { title: toTitleCase(parts[0].trim()), subtitle: parts.slice(1).join(' — ').trim() };
}

export function toolCardHeader(tool: ToolCallData, toolKey: string): ToolCardHeader {
  // ── proc:// calls: the URL names the process and the operation ────────────
  // The transport is `read`/`write`, so without this the card said "Write" for
  // a service stop and "Read" for a job status. The op comes from the result
  // when omp reports one (`stop`, `stdin`, `mode`, `cancel`) and from the path
  // otherwise.
  if (toolKey === 'proc' || procPathOf(tool)) {
    const view = procViewOf(tool);
    const id = view?.daemon?.name ?? view?.job?.id ?? view?.id ?? '';
    const op = procOpLabel(view?.op ?? '');
    return {
      title: 'Proc',
      subtitle: [op, id].filter(Boolean).join(' · ') || undefined,
    };
  }

  // ── read xd://<device>: the URL IS the identity ───────────────────────────
  // A device CALL's target is transport and is hidden (`toolCardSubtitle`), but
  // this is the documentation OF that device — `xd://lsp` is what was read, and
  // the card would otherwise be a bare "Read" with nothing naming it.
  if (isXdDocRead(tool)) {
    return { title: 'Read', subtitle: xdDocPath(tool) };
  }

  // ── device calls: the device's own action names it ────────────────────────
  if (toolKey === 'lsp' || toolKey === 'ast_edit') {
    const xdev = xdevOf(tool);
    const action = xdev?.args?.action;
    const file = xdev?.args?.file ?? xdev?.args?.paths?.[0];
    return {
      title: toolKey === 'lsp' ? 'LSP' : 'AST Edit',
      subtitle: [action, file].filter(Boolean).join(' · ') || undefined,
    };
  }
  if (toolKey === 'resolve' || toolKey === 'reject') {
    return { title: toolKey === 'resolve' ? 'Resolve Proposal' : 'Reject Proposal' };
  }

  // ── todo / ask ────────────────────────────────────────────────────────────
  // A todo's progress is a FACT, not a title line: `toolSummary` derives it from
  // `details.phases` — the same source the Todo panel reads — so it renders as a
  // chip. Naming it in the subtitle too would be the second reader of one
  // quantity, and the two disagreed: this used to parse the result's TEXT, which
  // a `todo` call does not always carry.
  if (toolKey === 'todo' || tool.name === 'todo' || tool.type === 'todo') {
    return { title: 'Todo' };
  }
  if (toolKey === 'ask') {
    const asked = parseAskQuestions(tool).length;
    return { title: 'Question', subtitle: asked > 0 ? `Asked ${asked} question${asked === 1 ? '' : 's'}` : undefined };
  }

  // ── eval: `input.title` is omp's own label for the cell ──────────────────
  const evalTitle = toolKey === 'eval' ? evalInputTitle(tool) : undefined;
  if (evalTitle) return { title: evalTitle, subtitle: undefined };

  // ── MCP: the tool names the action, never the transport ──────────────────
  const mcpName = mcpToolNameOf(tool);
  if (mcpName) {
    const subject = mcpSubjectOf(tool);
    return { title: toTitleCase(mcpName), subtitle: subject ? clip(subject) : undefined };
  }

  // ── wait: the card says WHAT it blocks on, not just "Wait" ────────────────
  // The generic path printed the tool name and nothing else, so a card that
  // blocked for two minutes was indistinguishable from a call that never ran.
  // The subtitle names the job (or the message) the wait was for; the clock is
  // a fact chip, not a title line.
  if (toolKey === 'wait') {
    const view = waitViewOf(tool);
    const job = view?.jobs[0];
    const subject = job?.label?.split('\n')[0]?.trim() || job?.id || view?.waited?.from;
    return { title: 'Wait', subtitle: subject ? clip(subject) : undefined };
  }

  // ── generic: a "name — subject" title splits, otherwise the name stands ──
  const fromTitle = tool.title ? subtitleFromTitle(tool.title) : null;
  if (fromTitle) return { title: fromTitle.title, subtitle: fromTitle.subtitle };

  // The `task` tool carries its subagent in `tasks[0]`, not in its title.
  if (toolKey === 'task' && tool.input && typeof tool.input === 'object') {
    const tasks = (tool.input as Record<string, unknown>).tasks;
    const first = Array.isArray(tasks) ? tasks[0] : undefined;
    if (first && typeof first === 'object') {
      const name = (first as Record<string, unknown>).name;
      const agent = (first as Record<string, unknown>).agent;
      if (typeof name === 'string' && name) {
        return { title: toTitleCase(tool.title || 'Task'), subtitle: `${name}${typeof agent === 'string' && agent ? ` · ${agent}` : ''}` };
      }
    }
  }

  if (tool.title) return { title: toTitleCase(tool.title) };
  return { title: toTitleCase(toolKey || tool.name || 'Tool Call') };
}

/**
 * The subtitle to render: the header's own, else the target file, else the raw
 * detail. A value that is only an `xd://` URL is never shown — the device
 * already named the action in the title, and the URL is transport. The target
 * file is filtered the same way, because `resolveTargetFile` reads `tool.target`
 * and a device call's target IS the URL.
 */
export function toolCardSubtitle(tool: ToolCallData, header: ToolCardHeader): string | undefined {
  if (header.subtitle && (!header.subtitle.startsWith('xd://') || isXdDocRead(tool))) return header.subtitle;
  const target = resolveTargetFile(tool);
  if (target && !target.startsWith('xd://')) return target;
  if (header.subtitle) return undefined;
  if (tool.detail && !tool.detail.startsWith('xd://')) return tool.detail;
  return undefined;
}
