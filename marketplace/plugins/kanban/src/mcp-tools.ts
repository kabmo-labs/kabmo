/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tool table: what an agent can do to a board, in its own vocabulary.
 *
 * Split from the protocol handler so each file reads as one thing — the table is
 * the CONTRACT (names, schemas, and the operation behind each), while `mcp.ts`
 * owns framing and refusals.
 *
 * Every tool calls the same `store/ops` function the panel's RPC calls, so the
 * two writers cannot drift: an agent's move and a drag both go through
 * `moveCard`, with the same lock, the same validation and the same answer.
 */

import { CARD_ID, STAGE_ID, type AgentSpec, type BoardSnapshot } from './protocol';
import { KanbanError } from './store/fs';
import {
  addCard,
  cardDetail,
  claimCard,
  linkSession,
  moveCard,
  nextCard,
  removeCard,
  saveDefaults,
  saveStages,
  snapshot,
  updateCard,
} from './store/ops';
import { resolveAgent } from './store/resolve';

/** One tool as `tools/list` describes it. */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (dataDir: string, args: Record<string, unknown>) => Promise<unknown>;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = stringArg(args, key);
  if (!value) throw new KanbanError('invalid', `"${key}" is required.`);
  return value;
}

/** A workspace argument: a path, or `null` for the global bucket, or absent. */
function workspaceArg(args: Record<string, unknown>): string | null | undefined {
  if (!('workspace' in args)) return undefined;
  const value = args.workspace;
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/** The slim row a list answer carries. */
function row(card: BoardSnapshot['cards'][number]): Record<string, unknown> {
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    workspace: card.workspace,
    sessionId: card.sessionId,
    updatedAt: card.updatedAt,
  };
}

/**
 * Every tool, and each one is the same operation the panel performs.
 *
 * `kanban_move` is the reason the tools exist: an agent that finished the work
 * moves its own card, and the answer tells it whether the stage needs a session
 * (`next: "start_work_required"`) — it never spawns one, because a spawn nobody
 * asked for is worse than one click in the panel.
 */
export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'kanban_list',
    description: 'List board cards as slim rows. Optional workspace and status filters.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: ['string', 'null'], description: 'Absolute workspace path, or null for unfiled cards.' },
        status: { type: 'string', description: 'A stage id from board.json.' },
        limit: { type: 'number', description: 'At most this many rows (default 50).' },
      },
    },
    async run(dataDir, args) {
      const board = await snapshot(dataDir);
      const workspace = workspaceArg(args);
      const status = stringArg(args, 'status');
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 500) : 50;
      const cards = board.cards
        .filter((card) => (workspace === undefined ? true : card.workspace === workspace))
        .filter((card) => (status ? card.status === status : true))
        .slice(0, limit);
      return { cards: cards.map(row), stages: board.board.stages.map((stage) => ({ id: stage.id, label: stage.label })) };
    },
  },
  {
    name: 'kanban_next',
    description: 'The highest-priority card that is not done, with the stage prompt that applies to it.',
    inputSchema: {
      type: 'object',
      properties: { workspace: { type: ['string', 'null'], description: 'Restrict to one workspace.' } },
    },
    async run(dataDir, args) {
      const card = await nextCard(dataDir, workspaceArg(args));
      if (!card) return { card: null };
      const { board } = await cardDetail(dataDir, card.id);
      const stage = board.stages.find((entry) => entry.id === card.status);
      const resolved = resolveAgent(card, stage, board);
      return {
        card: { ...row({ ...card, hasPrompt: card.task.prompt.length > 0, imageCount: card.task.images.length }), prompt: card.task.prompt },
        agent: { harness: resolved.harness, model: resolved.model, thinking: resolved.thinking, prompt: resolved.prompt },
      };
    },
  },
  {
    name: 'kanban_get',
    description: 'One card, its stage, and the resolved agent settings.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run(dataDir, args) {
      const id = requireString(args, 'id');
      const { card, board } = await cardDetail(dataDir, id);
      const stage = board.stages.find((entry) => entry.id === card.status);
      return { card, stage: stage ?? null, agent: resolveAgent(card, stage, board), defaults: board.defaults };
    },
  },
  {
    name: 'kanban_create',
    description: 'Create a card. `workspace` defaults to the caller\'s cwd when one is given.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        prompt: { type: 'string' },
        workspace: { type: ['string', 'null'] },
        status: { type: 'string' },
        priority: { type: 'number', description: '0 (urgent) .. 4 (backlog)' },
      },
      required: ['title'],
    },
    async run(dataDir, args) {
      const card = await addCard(dataDir, {
        title: requireString(args, 'title'),
        status: stringArg(args, 'status'),
        workspace: workspaceArg(args) ?? null,
        priority: typeof args.priority === 'number' ? args.priority : undefined,
        task: { prompt: stringArg(args, 'prompt') ?? '' },
      });
      return { card };
    },
  },
  {
    name: 'kanban_move',
    description: 'Move a card to another stage. Answers next="start_work_required" when that stage runs a session and none is linked.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, status: { type: 'string' }, baseUpdatedAt: { type: 'string' } },
      required: ['id', 'status'],
    },
    async run(dataDir, args) {
      const status = requireString(args, 'status');
      if (!STAGE_ID.test(status)) throw new KanbanError('invalid', `"${status}" is not a stage id.`);
      const moved = await moveCard(dataDir, requireString(args, 'id'), status, stringArg(args, 'baseUpdatedAt'));
      return { card: moved.card, ...(moved.next ? { next: moved.next } : {}) };
    },
  },
  {
    name: 'kanban_claim',
    description: 'Claim a card for a session: record the session and move it to the working stage.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, session_id: { type: 'string' } },
      required: ['id'],
    },
    async run(dataDir, args) {
      return { card: await claimCard(dataDir, requireString(args, 'id'), stringArg(args, 'session_id')) };
    },
  },
  {
    name: 'kanban_update',
    description: 'Change a card\'s control fields: title, priority, workspace, or the task prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        priority: { type: 'number' },
        workspace: { type: ['string', 'null'] },
        prompt: { type: 'string' },
        baseUpdatedAt: { type: 'string' },
      },
      required: ['id'],
    },
    async run(dataDir, args) {
      const id = requireString(args, 'id');
      const prompt = stringArg(args, 'prompt');
      return {
        card: await updateCard(
          dataDir,
          id,
          {
            title: stringArg(args, 'title'),
            priority: typeof args.priority === 'number' ? args.priority : undefined,
            workspace: workspaceArg(args),
            ...(prompt !== undefined ? { task: { prompt } } : {}),
          },
          stringArg(args, 'baseUpdatedAt'),
        ),
      };
    },
  },
  {
    name: 'kanban_link_session',
    description: 'Link (or unlink, with session_id=null) a chat session to a card.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, session_id: { type: ['string', 'null'] } },
      required: ['id', 'session_id'],
    },
    async run(dataDir, args) {
      const session = args.session_id;
      if (session !== null && typeof session !== 'string') throw new KanbanError('invalid', 'session_id must be a string or null.');
      return { card: await linkSession(dataDir, requireString(args, 'id'), session) };
    },
  },
  {
    name: 'kanban_delete',
    description: 'Delete a card file.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run(dataDir, args) {
      const id = requireString(args, 'id');
      if (!CARD_ID.test(id)) throw new KanbanError('invalid', `"${id}" is not a card id.`);
      await removeCard(dataDir, id);
      return { deleted: id };
    },
  },
  {
    name: 'kanban_stages',
    description: 'Read or replace the stage list. Replacing takes the WHOLE list, so read it first.',
    inputSchema: {
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          description: 'The complete list. Omit to read.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              hidden: { type: 'boolean' },
              session: { type: 'boolean' },
            },
            required: ['id', 'label'],
          },
        },
        defaults: { type: 'object', description: 'Board defaults: harness, model, thinking, access, prompt, skills.' },
      },
    },
    async run(dataDir, args) {
      if (Array.isArray(args.stages)) {
        const stages = args.stages.map((entry) => {
          const record = entry as Record<string, unknown>;
          return {
            id: String(record.id ?? ''),
            label: String(record.label ?? ''),
            hidden: record.hidden === true,
            session: record.session === true,
          };
        });
        return { board: (await saveStages(dataDir, stages)).board };
      }
      if (args.defaults && typeof args.defaults === 'object') {
        return { board: (await saveDefaults(dataDir, args.defaults as AgentSpec)).board };
      }
      const board = await snapshot(dataDir);
      return { stages: board.board.stages, defaults: board.board.defaults };
    },
  },
];


/** The tool by name, or undefined. */
export function toolNamed(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
