/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The anchor a per-message Fork carries. Only a transcript Kabmo can read can
 * be cut at a message; an agent that keeps its own history forks the chat whole
 * — except the adapters that read the AIR fork point, which fork at an
 * assistant message.
 */

import { describe, expect, test } from 'bun:test';
import { canForkAt, forkAnchorFor } from '@/shared/lib/chat/timeline/fork-anchor';

describe('canForkAt', () => {
  test('omp forks at either row', () => {
    expect(canForkAt('omp-rpc', 'user')).toBe(true);
    expect(canForkAt('omp-acp', 'assistant')).toBe(true);
  });

  test('an AIR adapter forks at an assistant row only', () => {
    expect(canForkAt('claude', 'assistant')).toBe(true);
    expect(canForkAt('codex', 'assistant')).toBe(true);
    expect(canForkAt('claude', 'user')).toBe(false);
    expect(canForkAt('codex', 'user')).toBe(false);
  });

  test('a whole-chat-only harness forks at neither row', () => {
    expect(canForkAt('zcode', 'assistant')).toBe(false);
    expect(canForkAt('opencode', 'user')).toBe(false);
  });

  test('an unresolved harness keeps the historical allow', () => {
    expect(canForkAt(undefined, 'user')).toBe(true);
  });
});

describe('forkAnchorFor', () => {
  test('an omp chat forks at the clicked message, user or assistant', () => {
    expect(forkAnchorFor('omp-rpc', 'u2', 'user')).toBe('u2');
    expect(forkAnchorFor('omp-acp', 'a2', 'assistant')).toBe('a2');
  });

  test('claude and codex fork at an assistant message through the AIR extension', () => {
    expect(forkAnchorFor('claude', 'a2', 'assistant')).toBe('a2');
    expect(forkAnchorFor('codex', 'a2', 'assistant')).toBe('a2');
  });

  test('an AIR adapter has no fork point on a user row', () => {
    expect(forkAnchorFor('claude', 'u2', 'user')).toBeNull();
    expect(forkAnchorFor('codex', 'u2', 'user')).toBeNull();
  });

  test('a harness with its own store and no fork point forks the whole chat', () => {
    expect(forkAnchorFor('zcode', 'a2', 'assistant')).toBeNull();
    expect(forkAnchorFor('opencode', 'u2', 'user')).toBeNull();
  });

  test('an unresolved harness keeps the anchor', () => {
    expect(forkAnchorFor(undefined, 'u2', 'user')).toBe('u2');
  });
});
