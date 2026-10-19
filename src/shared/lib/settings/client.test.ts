import { test, expect, afterAll, beforeEach } from 'bun:test';
import {
  primeKabmoSettings,
  readKabmoSetting,
  mergeKabmoSettings,
  writeSetting,
  writeKabmoSettings,
} from '@/shared/lib/settings/client';

const bootstrap = {
  omp_sidebar_sort: 'A-Z',
  desktopLayoutSizes: { sidebar: 268 },
  omp_chamber_settings: { theme: 'paper', editorFont: 'Menlo' },
};

beforeEach(() => {
  primeKabmoSettings(bootstrap);
});

test('reads expose top-level keys and blob keys flat', () => {
  expect(readKabmoSetting<string>('omp_sidebar_sort')).toBe('A-Z');
  expect(readKabmoSetting<string>('theme')).toBe('paper');
  expect(readKabmoSetting<string>('editorFont')).toBe('Menlo');
  expect(readKabmoSetting('absent')).toBeUndefined();
});

test('the raw blob key is not exposed as a flat key', () => {
  expect(readKabmoSetting('omp_chamber_settings')).toBeUndefined();
});

test('readKabmoSetting accepts candidate key lists in priority order', () => {
  expect(readKabmoSetting<string>(['missing', 'theme'])).toBe('paper');
  expect(readKabmoSetting<string>(['theme', 'missing'])).toBe('paper');
  expect(readKabmoSetting(['missing', 'alsoMissing'])).toBeUndefined();
});

test('mergeKabmoSettings layers only the blob, never top-level keys', () => {
  const merged = mergeKabmoSettings({ theme: 'fallback', fontSize: 14 });
  expect(merged.theme).toBe('paper');
  expect(merged.fontSize).toBe(14);
  expect((merged as Record<string, unknown>).omp_sidebar_sort).toBeUndefined();
  expect((merged as Record<string, unknown>).desktopLayoutSizes).toBeUndefined();
});

test('writeSetting updates the snapshot so the next read sees it', () => {
  writeSetting('omp_sidebar_sort', 'Z-A');
  expect(readKabmoSetting<string>('omp_sidebar_sort')).toBe('Z-A');
});

test('writeKabmoSettings updates flat keys and keeps sibling blob keys', () => {
  writeKabmoSettings({ theme: 'noir' });
  expect(readKabmoSetting<string>('theme')).toBe('noir');
  expect(readKabmoSetting<string>('editorFont')).toBe('Menlo');
  expect(readKabmoSetting('omp_chamber_settings')).toBeUndefined();
});

test('a later write does not clobber previously written flat keys', () => {
  writeSetting('showRightPanel', false);
  writeKabmoSettings({ theme: 'noir' });
  expect(readKabmoSetting<boolean>('showRightPanel')).toBe(false);
  expect(readKabmoSetting<string>('theme')).toBe('noir');
});

/**
 * The snapshot is module state shared by every suite in one `bun test`
 * process; the last case here leaves it holding this file's fixtures. Restore
 * the pristine (unprimed) snapshot so a later file that reads a Kabmo
 * setting sees the default rather than the fixture.
 */
afterAll(() => {
  primeKabmoSettings({});
});
