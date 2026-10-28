/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Extracts human-readable activity from the eval script the agent runs against
 * its built-in browser. The script itself is the intent: `browser.open({url})`,
 * `.goto(url)`, `wait(ms)`, `.screenshot()`, … are parsed in source order so
 * the panel can show what the agent is about to do. Interaction-level events
 * (click/type/press) are deliberately NOT parsed here — the live CDP observer
 * reports those as they actually happen (see observer.ts).
 */

import type { BrowserActionKind } from '@/shared/types';

/** A toast-ready action before the transport adds id/source/timestamp. */
export interface BrowserActionDraft {
  kind: BrowserActionKind;
  label: string;
}

const MAX_ACTIONS_PER_SCRIPT = 8;

/** Host + trimmed path for toast copy, without the scheme. */
export function shortUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`.slice(0, 64);
  } catch {
    return value.slice(0, 64);
  }
}

function formatWait(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `Menunggu ${Math.round(seconds / 60)} menit` : `Menunggu ${seconds} detik`;
}

interface FoundAction {
  index: number;
  action: BrowserActionDraft;
}

/** Parse one eval script into an ordered, deduped, capped action list. */
export function extractEvalActions(args: { code?: unknown; title?: unknown }): BrowserActionDraft[] {
  const code = typeof args.code === 'string' ? args.code : '';
  if (!code) return [];

  const found: FoundAction[] = [];
  const add = (index: number, kind: BrowserActionKind, label: string): void => {
    found.push({ index, action: { kind, label } });
  };

  const openPattern = /browser\s*\.\s*open\s*\(\s*\{([^}]*)\}/g;
  for (const match of code.matchAll(openPattern)) {
    const body = match[1] ?? '';
    const urlMatch = body.match(/url\s*:\s*(['"`])([^'"`]+)\1/);
    if (urlMatch?.[2]) add(match.index ?? 0, 'open', `Membuka halaman ${shortUrl(urlMatch[2])}`);
  }

  const openCallPattern = /browser\s*\.\s*open\s*\(([^)]*)\)/g;
  for (const match of code.matchAll(openCallPattern)) {
    const body = match[1] ?? '';
    if (body.includes('{')) continue;
    const keywordMatch = body.match(/url\s*=\s*(['"])([^'"]+)\1/);
    const positionalMatch = body.match(/^\s*(['"])([^'"]+)\1/);
    const url = keywordMatch?.[2] ?? positionalMatch?.[2];
    if (url) add(match.index ?? 0, 'open', `Membuka halaman ${shortUrl(url)}`);
  }

  const gotoPattern = /\.goto\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  for (const match of code.matchAll(gotoPattern)) {
    add(match.index ?? 0, 'navigate', `Navigasi ke ${shortUrl(match[2] ?? '')}`);
  }

  const waitPattern = /\bwait\s*\(\s*([\d_]+)\s*\)/g;
  for (const match of code.matchAll(waitPattern)) {
    const ms = Number.parseInt((match[1] ?? '').replace(/_/g, ''), 10);
    if (Number.isFinite(ms) && ms >= 1000) add(match.index ?? 0, 'wait', formatWait(ms));
  }

  const screenshotPattern = /\.screenshot\s*\(/g;
  for (const match of code.matchAll(screenshotPattern)) {
    add(match.index ?? 0, 'screenshot', 'Mengambil screenshot');
  }

  const uploadPattern = /\.upload(?:File)?\s*\(/g;
  for (const match of code.matchAll(uploadPattern)) {
    add(match.index ?? 0, 'upload', 'Mengunggah file');
  }

  const scrollPattern = /\.scroll(?:IntoView)?\s*\(/g;
  for (const match of code.matchAll(scrollPattern)) {
    add(match.index ?? 0, 'scroll', 'Menggulir halaman');
  }

  const closePattern = /(?:browser|tab)\s*\.\s*close\s*\(/g;
  for (const match of code.matchAll(closePattern)) {
    add(match.index ?? 0, 'close', 'Menutup tab');
  }

  found.sort((a, b) => a.index - b.index);
  const result: BrowserActionDraft[] = [];
  for (const { action } of found) {
    const previous = result[result.length - 1];
    if (previous && previous.kind === action.kind && previous.label === action.label) continue;
    result.push(action);
    if (result.length >= MAX_ACTIONS_PER_SCRIPT) break;
  }
  return result;
}
