/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { skillsharePackage } from '@/shared/lib/omp/skill-source';

describe('skillsharePackage', () => {
  test('strips the installed version from a registry source', () => {
    expect(skillsharePackage('skillshare:@acme/pdf@1.2.3')).toBe('@acme/pdf');
    expect(skillsharePackage('skillshare:@acme/pdf@1.2.3-beta.1')).toBe('@acme/pdf');
  });

  test('keeps a spec that carries no version', () => {
    expect(skillsharePackage('skillshare:@acme/pdf')).toBe('@acme/pdf');
  });

  test('answers null for every other provider', () => {
    expect(skillsharePackage('native:user')).toBeNull();
    expect(skillsharePackage('claude-plugins:user')).toBeNull();
    expect(skillsharePackage(undefined)).toBeNull();
  });
});
