/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How each harness is installed and updated — the facts an "update" button needs.
 *
 * Three different mechanisms, and conflating them is how a button breaks an
 * install:
 *
 * | Mechanism | Meaning | Harness |
 * |---|---|---|
 * | `npm` | Published on npm; the newest version is a registry read, and the install is that package at that version | most |
 * | `self` | The CLI updates itself (`opencode upgrade`, `cmd update`). Kabmo must not install a package behind its back — the vendor owns the launcher, the binary location and the verification | opencode, command-code |
 * | `own` | Installed by a vendor installer (curl script, app bundle). Kabmo can REPORT a version but has no business replacing it | antigravity, cursor |
 *
 * The `npm` entry is the ONLY one whose `latest` Kabmo resolves, because it is the
 * only one where "latest on npm" is the version that install would move to. A
 * probe-reported version is what the AGENT says it is; a registry version is what
 * `npm i -g` would install. They answer different questions and both are shown.
 */

import type { HarnessId } from '@/shared/lib/harness/catalog';

export type HarnessUpdateKind = 'npm' | 'self' | 'own';

export interface HarnessUpdateFacts {
  kind: HarnessUpdateKind;
  /**
   * The CLI whose `--version` is the number a user recognises, when the agent the
   * probe reports is an ADAPTER for it.
   *
   * `claude --version` answers `2.1.318 (Claude Code)` while the ACP adapter
   * answers `0.101.0`. Reporting only the adapter beside a real install reads as
   * "why is my 2.x showing 0.100?", so both are shown and the CLI's own number is
   * the one compared against its own package.
   */
  cli?: { bin: string; name: string };
  /** The npm package, for `npm`. */
  pkg?: string;
  /**
   * The command that updates it, for every kind.
   *
   * For `self` this is what Kabmo RUNS — the vendor's own updater, which is the
   * only correct path for a CLI that owns its launcher. For `own` it is shown and
   * refused, because a vendor installer is not Kabmo's to run.
   */
  command?: string;
  /** Where the command must run, when it is not the agent's own cwd. */
  note?: string;
}

export const HARNESS_UPDATE_FACTS: Readonly<Partial<Record<HarnessId, HarnessUpdateFacts>>> = {
  'omp-acp': {
    kind: 'self',
    // omp owns its install mechanics (binary download, launcher retirement,
    // verification), and Kabmo already drives them for `omp update`.
    command: 'omp update',
    note: 'Updated through the Oh-My-Pi entry above — omp owns its own installer.',
  },
  claude: {
    // The package the PROBE reports, and therefore the one the comparison is
    // against: `initialize` answers `@agentclientprotocol/claude-agent-acp` 0.100.0.
    // Pointing this at `@anthropic-ai/claude-code` (2.1.318) put two different
    // number lines side by side and reported an "update" from 0.100 to 2.1 — a
    // fabricated comparison, measured on a real probe.
    kind: 'npm',
    pkg: '@agentclientprotocol/claude-agent-acp',
    // The CLI underneath has its own updater (`claude update`), and the adapter
    // pins the CLI version it bridges — so the adapter install alone can leave a
    // stale CLI behind. Both lines are named.
    command: 'claude update',
    cli: { bin: 'claude', name: 'Claude Code' },
    note: 'The row reports the ADAPTER; `claude --version` is the CLI underneath.',
  },
  codex: {
    // Same rule as claude: the package the probe reports is the one the number
    // is compared against.
    kind: 'npm',
    pkg: '@agentclientprotocol/codex-acp',
    cli: { bin: 'codex', name: 'codex' },
    note: 'The row reports the ADAPTER; `codex --version` is the CLI underneath.',
  },
  opencode: {
    kind: 'self',
    command: 'opencode upgrade',
    note: 'The CLI updates itself; Kabmo runs its own subcommand rather than replacing the install.',
  },
  'command-code': {
    kind: 'self',
    command: 'cmd update',
    note: 'The CLI updates itself (`cmd update`), which Kabmo runs for you.',
  },
  antigravity: {
    kind: 'own',
    command: 'curl -fsSL https://antigravity.google/install.sh | bash',
    note: 'Installed by Google’s own script; Kabmo reports the version but does not replace the binary.',
  },
  pi: {
    kind: 'npm',
    pkg: 'pi-acp',
    cli: { bin: 'pi', name: 'pi' },
    // The ADAPTER is on npm; the agent it drives is not, so the note names both.
    note: 'The row reports the ADAPTER; the `pi` binary it drives versions separately.',
  },
  qwen: { kind: 'npm', pkg: '@qwen-code/qwen-code' },
  kimi: { kind: 'npm', pkg: '@moonshot-ai/kimi-code' },
  minimax: { kind: 'npm', pkg: '@minimax-ai/code' },
  dsh: { kind: 'npm', pkg: '@deepseek-ai/dsh' },
  cursor: { kind: 'own', command: 'cursor-agent update', note: 'Cursor moves through its own installer.' },
};

/** The facts for a harness, or "Kabmo knows nothing about updating it". */
export function harnessUpdateFacts(id: string | null | undefined): HarnessUpdateFacts | null {
  return id ? (HARNESS_UPDATE_FACTS as Record<string, HarnessUpdateFacts | undefined>)[id] ?? null : null;
}

/**
 * The package an npm-registry version read should ask about, or null.
 *
 * A `self` harness gets null: its latest version is the VENDOR's answer, not
 * npm's, and reporting a registry number beside a self-updating CLI would invent
 * a discrepancy that does not exist.
 */
export function latestSourceFor(id: string | null | undefined): string | null {
  const facts = harnessUpdateFacts(id);
  return facts?.kind === 'npm' ? facts.pkg ?? null : null;
}

/**
 * How a "latest version" was learned, so the UI can say what it knows instead of
 * presenting every number as the same kind of fact.
 */
export type LatestBasis = 'npm' | 'self' | 'unknown';

export function latestBasis(id: string | null | undefined): LatestBasis {
  const facts = harnessUpdateFacts(id);
  if (!facts) return 'unknown';
  return facts.kind === 'npm' ? 'npm' : 'self';
}
