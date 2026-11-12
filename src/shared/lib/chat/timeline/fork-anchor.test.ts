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
import { canForkChat, forkCapability } from '@/shared/lib/harness/fork';

describe('forkCapability', () => {
  test('omp and the AIR adapters fork at a message', () => {
    expect(forkCapability('omp-rpc')).toBe('message');
    expect(forkCapability('omp-acp')).toBe('message');
    expect(forkCapability('claude')).toBe('message');
    expect(forkCapability('codex')).toBe('message');
  });

  test('a whole-chat-only harness is tip', () => {
    expect(forkCapability('opencode')).toBe('tip');
    expect(forkCapability('minimax')).toBe('tip');
    expect(forkCapability('zcode')).toBe('tip');
  });

  test('a harness with no session/fork is none', () => {
    expect(forkCapability('qwen')).toBe('none');
    expect(forkCapability('dsh')).toBe('none');
    expect(forkCapability('antigravity')).toBe('none');
    expect(forkCapability('jcode')).toBe('none');
    expect(forkCapability('grok')).toBe('none');
  });
});

describe('canForkChat', () => {
  test('the probe is authoritative when it has an answer', () => {
    expect(canForkChat('qwen', true)).toBe(true);
    expect(canForkChat('claude', false)).toBe(false);
  });

  test('without a probe the expected capability decides', () => {
    expect(canForkChat('zcode')).toBe(true);
    expect(canForkChat('qwen')).toBe(false);
  });
});

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
