/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP surface an agent actually uses.
 *
 * Two properties are what make this worth a test rather than a smoke check:
 *
 * - **A refusal is a RESULT.** The agent has to read "stage \"nope\" does not
 *   exist" and retry with a real one; a JSON-RPC error frame would look like a
 *   broken server and most clients stop calling.
 * - **A move into a session stage does NOT spawn anything.** It answers
 *   `next: "start_work_required"`, which is the contract the panel relies on to
 *   offer the button instead of a chat appearing from nowhere.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { handleRpcFrame, type JsonRpcReply } from './mcp';
import { TOOLS } from './mcp-tools';
import { addCard, createBoard, linkSession } from './store/ops';

let dataDir = '';

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-'));
  await createBoard(dataDir);
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** The text a tool result carries, validated rather than cast. */
function resultText(reply: JsonRpcReply | null, name: string): { text: string; isError: boolean } {
  const result = reply?.result;
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error(`no result for ${name}: ${JSON.stringify(reply)}`);
  }
  const { content, isError } = result as { content?: unknown; isError?: unknown };
  if (!Array.isArray(content) || content.length === 0) throw new Error(`no content for ${name}`);
  const first: unknown = content[0];
  if (!first || typeof first !== 'object' || !('text' in first) || typeof first.text !== 'string') {
    throw new Error(`no text for ${name}`);
  }
  return { text: first.text, isError: isError === true };
}

/** Call one tool the way a client does, and parse the JSON the result carries. */
async function call<T>(name: string, args: Record<string, unknown>): Promise<{ value: T; isError: boolean }> {
  const reply = await handleRpcFrame(dataDir, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const { text, isError } = resultText(reply, name);
  return { value: JSON.parse(text) as T, isError };
}

describe('protocol', () => {
  test('initialize names the server and its tool capability', async () => {
    const reply = await handleRpcFrame(dataDir, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    const result = reply?.result as { serverInfo: { name: string }; capabilities: { tools: unknown } };
    expect(result.serverInfo.name).toBe('kanban');
    expect(result.capabilities.tools).toBeDefined();
  });

  test('tools/list describes every tool with an input schema', async () => {
    const reply = await handleRpcFrame(dataDir, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (reply?.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    for (const tool of tools) expect(tool.inputSchema).toBeDefined();
  });

  test('a notification gets no reply, and an unknown method is refused', async () => {
    expect(await handleRpcFrame(dataDir, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const reply = await handleRpcFrame(dataDir, { jsonrpc: '2.0', id: 3, method: 'nope' });
    expect(reply?.error?.code).toBe(-32601);
  });

  test('an unknown tool is a protocol error naming it', async () => {
    const reply = await handleRpcFrame(dataDir, {
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} },
    });
    expect(reply?.error?.message).toContain('nope');
  });
});

describe('the tools', () => {
  test('create then list round-trips through the same files the panel reads', async () => {
    const created = await call('kanban_create', { title: 'From the agent', prompt: 'do it', workspace: '/w' });
    const card = (created.value as { card: { id: string; status: string } }).card;
    expect(card.id).toMatch(/^k-/);
    expect(card.status).toBe('open');

    const listed = await call('kanban_list', {});
    const rows = (listed.value as { cards: { id: string; title: string }[] }).cards;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(card.id);
    // The row is SLIM: a board of 500 cards must not carry 500 prompts.
    expect(rows[0]).not.toHaveProperty('task');
  });

  test('move into a working stage asks for Start work and spawns nothing', async () => {
    const created = await call('kanban_create', { title: 'Work' });
    const id = (created.value as { card: { id: string } }).card.id;
    const moved = await call('kanban_move', { id, status: 'in_progress' });
    expect(moved.isError).toBe(false);
    expect((moved.value as { next?: string }).next).toBe('start_work_required');
  });

  test('a linked card moves without asking', async () => {
    const created = await call('kanban_create', { title: 'Linked' });
    const id = (created.value as { card: { id: string } }).card.id;
    await linkSession(dataDir, id, 'sess-1');
    const moved = await call('kanban_move', { id, status: 'review' });
    expect((moved.value as { next?: string }).next).toBeUndefined();
  });

  test('claim records the session and lands in the working stage', async () => {
    const created = await call('kanban_create', { title: 'Claim' });
    const id = (created.value as { card: { id: string } }).card.id;
    const claimed = await call('kanban_claim', { id, session_id: 'sess-7' });
    const card = (claimed.value as { card: { status: string; sessionId: string } }).card;
    expect(card.sessionId).toBe('sess-7');
    expect(card.status).toBe('in_progress');
  });

  test('next offers the highest priority card with its stage prompt', async () => {
    const low = await call('kanban_create', { title: 'Low', priority: 4 });
    const urgent = await call('kanban_create', { title: 'Urgent', priority: 0 });
    const next = await call('kanban_next', {});
    const value = next.value as { card: { id: string }; agent: { harness: string } };
    expect(value.card.id).toBe((urgent.value as { card: { id: string } }).card.id);
    expect(value.card.id).not.toBe((low.value as { card: { id: string } }).card.id);
    expect(value.agent.harness).toBe('omp-rpc');
  });

  test('an unknown stage is a readable refusal, not a broken server', async () => {
    const created = await call('kanban_create', { title: 'x' });
    const id = (created.value as { card: { id: string } }).card.id;
    const moved = await call('kanban_move', { id, status: 'nope' });
    expect(moved.isError).toBe(true);
    expect((moved.value as { code: string; message: string }).code).toBe('invalid');
    expect((moved.value as { message: string }).message).toContain('nope');
  });

  test('a bad id never reaches the filesystem', async () => {
    const moved = await call('kanban_move', { id: '../../etc/passwd', status: 'open' });
    expect(moved.isError).toBe(true);
    const read = await call('kanban_get', { id: '../../etc/passwd' });
    expect(read.isError).toBe(true);
  });

  test('get carries the resolved agent and the stage it came from', async () => {
    const created = await call('kanban_create', { title: 'Detail' });
    const id = (created.value as { card: { id: string } }).card.id;
    const detail = await call('kanban_get', { id });
    const value = detail.value as { stage: { id: string } | null; agent: { harness: string; origin: { harness: string } } };
    expect(value.stage?.id).toBe('open');
    expect(value.agent.origin.harness).toBe('host');
  });

  test('update touches only the fields named', async () => {
    const created = await call('kanban_create', { title: 'Edit me', prompt: 'first' });
    const id = (created.value as { card: { id: string } }).card.id;
    await call('kanban_update', { id, priority: 1 });
    const detail = await call('kanban_get', { id });
    const card = (detail.value as { card: { priority: number; task: { prompt: string }; title: string } }).card;
    expect(card.priority).toBe(1);
    expect(card.task.prompt).toBe('first');
    expect(card.title).toBe('Edit me');
  });

  test('stages can be read and replaced, and a bad id is refused', async () => {
    const read = await call('kanban_stages', {});
    const stages = (read.value as { stages: { id: string; label: string }[] }).stages;
    expect(stages.length).toBe(6);

    const replaced = await call('kanban_stages', { stages: [...stages, { id: 'ship', label: 'Ship' }] });
    expect((replaced.value as { board: { stages: { id: string }[] } }).board.stages.map((stage) => stage.id)).toContain('ship');

    const refused = await call('kanban_stages', { stages: [{ id: 'Bad Id', label: 'X' }] });
    expect(refused.isError).toBe(true);
  });

  test('delete removes the file', async () => {
    const card = await addCard(dataDir, { title: 'Bye' });
    const removed = await call('kanban_delete', { id: card.id });
    expect((removed.value as { deleted: string }).deleted).toBe(card.id);
    expect(fs.existsSync(path.join(dataDir, 'kanban', 'cards', `${card.id}.json`))).toBe(false);
  });
});
