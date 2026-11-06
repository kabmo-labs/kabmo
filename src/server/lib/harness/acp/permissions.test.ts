/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The access-tier mapping for ACP permission requests.
 *
 * ACP has no spawn flag for approval: the client answers
 * `session/request_permission`, and before this mapping existed Kabmo always
 * parked a dialog — measured on a live omp-acp chat with "Full bypass"
 * selected, a bash call still asked for confirmation. The tiers below are
 * omp's own contract (`always-ask` auto-runs read-tier tools and prompts for
 * write+exec, `write` auto-runs read+write and prompts for exec, `yolo` runs
 * everything), so one label means the same thing on both transports.
 */

import { describe, expect, test } from 'bun:test';
import { allowOption, autoApproval } from '@/server/lib/harness/acp/permissions';

describe('autoApproval', () => {
  test('yolo answers every tier', () => {
    for (const kind of ['read', 'edit', 'delete', 'move', 'execute', 'other', undefined]) {
      expect(autoApproval('yolo', kind === undefined ? undefined : { kind })).toBe(true);
    }
  });

  test('always-ask allows read-tier and asks for the rest', () => {
    for (const kind of ['read', 'search', 'fetch', 'think', 'switch_mode']) {
      expect(autoApproval('always-ask', { kind })).toBe(true);
    }
    for (const kind of ['edit', 'delete', 'move', 'execute', 'other']) {
      expect(autoApproval('always-ask', { kind })).toBe(false);
    }
  });

  test('write allows read and write tiers, and asks for exec', () => {
    for (const kind of ['read', 'think', 'edit', 'delete', 'move']) {
      expect(autoApproval('write', { kind })).toBe(true);
    }
    for (const kind of ['execute', 'other']) {
      expect(autoApproval('write', { kind })).toBe(false);
    }
  });

  test('a tool call with no kind is treated as the exec tier', () => {
    expect(autoApproval('always-ask', undefined)).toBe(false);
    expect(autoApproval('write', {})).toBe(false);
    expect(autoApproval('yolo', undefined)).toBe(true);
  });
});

describe('allowOption', () => {
  test('prefers the once-only allow, then any allow, then nothing', () => {
    expect(
      allowOption([
        { optionId: 'deny', kind: 'reject_once' },
        { optionId: 'always', kind: 'allow_always' },
        { optionId: 'once', kind: 'allow_once' },
      ]),
    ).toBe('once');
    expect(allowOption([{ optionId: 'always', kind: 'allow_always' }])).toBe('always');
    expect(allowOption([{ optionId: 'deny', kind: 'reject_once' }])).toBeNull();
    expect(allowOption([])).toBeNull();
  });
});
