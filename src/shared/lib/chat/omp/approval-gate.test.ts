/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The approval gate, as omp actually sends it.
 *
 * Over RPC the gate is a `select` frame, not a `confirm`: omp's RPC UI context
 * has no `approve` member, so `requestApproval` falls back to its `select`
 * branch. The title carries omp's WHOLE prompt, newline-separated, and the
 * options are the approval choices. Both shapes are measured against omp
 * 18.13.1 — the frames below are the ones it produces, verbatim.
 */

import { describe, expect, test } from 'bun:test';

import { isApprovalGateFrame, parseApprovalPrompt } from '@/shared/lib/chat/omp/approval-gate';

/** omp's gate for a restricted-folder read, as `requestApproval` builds it. */
const RESTRICTED_READ = [
  'Allow tool: read',
  'Reason: Restricted folder: /tmp/livetest/secret',
  'Path: /tmp/livetest/secret/creds.txt',
].join('\n');

/** omp's gate for a bash call under `always-ask`. */
const BASH_GATE = ['Allow tool: bash', 'Command: ls -la /tmp/livetest'].join('\n');

describe('isApprovalGateFrame', () => {
  test('an approval prompt is a gate', () => {
    expect(isApprovalGateFrame({ title: RESTRICTED_READ, options: ['Approve', 'Deny'] })).toBe(true);
    expect(isApprovalGateFrame({ title: BASH_GATE, options: ['Approve', 'Deny'] })).toBe(true);
  });

  test('an ask question is not a gate', () => {
    // The question's own title, which is what a card claims a dialog by.
    expect(isApprovalGateFrame({ title: 'Which language?', options: ['Python', 'Other (type your own)'] })).toBe(false);
    // omp's grouped ask frame carries NO title at all.
    expect(isApprovalGateFrame({ title: '', options: [] })).toBe(false);
    expect(isApprovalGateFrame({ title: undefined })).toBe(false);
    expect(isApprovalGateFrame({ title: null })).toBe(false);
  });

  test('the match is on omp\'s own prefix, not on a substring', () => {
    // A question that merely CONTAINS the words is not a gate.
    expect(isApprovalGateFrame({ title: 'Should I allow tool: write here?', options: ['Approve', 'Deny'] })).toBe(false);
    // The prefix must lead, after trimming and case folding.
    expect(isApprovalGateFrame({ title: '  allow tool: read\nPath: /tmp/x', options: ['Approve', 'Deny'] })).toBe(true);
    expect(isApprovalGateFrame({ title: 'ALLOW TOOL: read', options: ['Approve', 'Deny'] })).toBe(true);
  });

  test('the CHOICES must be omp\'s approval choices', () => {
    // A model-authored question can carry the same title; it is still a
    // question, and it is answered through its own card with its own options.
    expect(isApprovalGateFrame({ title: RESTRICTED_READ, options: ['Yes', 'No'] })).toBe(false);
    // A gate always carries its choices.
    expect(isApprovalGateFrame({ title: RESTRICTED_READ, options: [] })).toBe(false);
    expect(isApprovalGateFrame({ title: RESTRICTED_READ })).toBe(false);
  });
});

describe('parseApprovalPrompt', () => {
  test('splits the tool, the reason and the details', () => {
    const prompt = parseApprovalPrompt(RESTRICTED_READ);
    expect(prompt).not.toBeNull();
    expect(prompt?.tool).toBe('read');
    expect(prompt?.reason).toBe('Restricted folder: /tmp/livetest/secret');
    expect(prompt?.details).toEqual(['Path: /tmp/livetest/secret/creds.txt']);
  });

  test('a gate with no reason keeps its details', () => {
    const prompt = parseApprovalPrompt(BASH_GATE);
    expect(prompt?.tool).toBe('bash');
    expect(prompt?.reason).toBeUndefined();
    expect(prompt?.details).toEqual(['Command: ls -la /tmp/livetest']);
  });

  test('a title that is not an approval prompt is not one', () => {
    expect(parseApprovalPrompt('Which language?')).toBeNull();
    expect(parseApprovalPrompt('')).toBeNull();
    expect(parseApprovalPrompt(undefined)).toBeNull();
    expect(parseApprovalPrompt(null)).toBeNull();
  });

  test('the reason is not repeated among the details', () => {
    // The reason is omp's own line; leaving it in the details too would
    // print it twice.
    const prompt = parseApprovalPrompt(RESTRICTED_READ);
    expect(prompt?.details.some((detail) => detail.startsWith('Reason:'))).toBe(false);
  });

  test('every detail line survives the split', () => {
    const prompt = parseApprovalPrompt(
      ['Allow tool: write', 'Reason: Restricted folder: /tmp/x', 'Path: /tmp/x/a.txt', 'Content: 3 lines'].join('\n'),
    );
    expect(prompt?.details).toEqual(['Path: /tmp/x/a.txt', 'Content: 3 lines']);
  });
});
