import type { ComposerMatchItem, ComposerPickItem, ComposerSubcommand } from '@/shared/types';
import { SKILL_NAMESPACE, SKILL_NAMESPACE_TOKEN } from '@/shared/lib/chat/composer/trigger';

/**
 * Slash-command ranking, ported from oh-my-pi's `pi-tui/autocomplete.ts`
 * (`scoreCommandTextMatch`, `skillBareNameBreakoutTier`, `collapseSkillNamespace`,
 * `buildSlashCommandCompletions`, `buildArgumentCompletions`). Keeping the
 * formulas identical is the point: Kabmo's popup must order and match
 * `/`-tokens exactly like the CLI it drives.
 */

/** Subsequence match, oh-my-pi's `subsequenceMatch`. */
function subsequenceMatch(query: string, target: string): boolean {
  if (query.length === 0) return true;
  if (query.length > target.length) return false;

  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (query[qi] === target[ti]) qi++;
  }
  return qi === query.length;
}

/** Ranked-tier subsequence score (100/80/60/40−gaps·5); higher is better, 0 is no match. */
function subsequenceScore(query: string, target: string): number {
  if (query.length === 0) return 1;
  if (target === query) return 100;
  if (target.startsWith(query)) return 80;
  if (target.includes(query)) return 60;

  let qi = 0;
  let gaps = 0;
  let lastMatchIdx = -1;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (query[qi] === target[ti]) {
      if (lastMatchIdx >= 0 && ti - lastMatchIdx > 1) gaps++;
      lastMatchIdx = ti;
      qi++;
    }
  }
  if (qi !== query.length) return 0;

  return Math.max(1, 40 - gaps * 5);
}

/**
 * oh-my-pi's `scoreCommandTextMatch`. Prefix matches share one flat score so
 * same-prefix commands keep their list order; a length penalty here would rank
 * the shorter name first (e.g. `/set` → `setup` above `settings`).
 */
function scoreCommandTextMatch(lowerPrefix: string, lowerTarget: string): number {
  if (lowerPrefix.length === 0) return 1;
  if (lowerPrefix === lowerTarget) return 1000;
  if (lowerTarget.startsWith(lowerPrefix)) return 900;
  return subsequenceMatch(lowerPrefix, lowerTarget) ? subsequenceScore(lowerPrefix, lowerTarget) : 0;
}

/** Exact/leading-prefix tier for ordinary command names and aliases. */
function commandBreakoutTier(lowerPrefix: string, lowerTarget: string): number {
  if (lowerPrefix === lowerTarget) return 1000;
  if (lowerTarget.startsWith(lowerPrefix)) return 900;
  return 0;
}

/**
 * Match a bare skill name from the beginning of any hyphen-delimited segment
 * (oh-my-pi's `skillBareNameBreakoutTier`), so `/last` surfaces
 * `skill:research-last30days`.
 */
function skillBareNameBreakoutTier(lowerPrefix: string, lowerBareName: string): number {
  if (lowerPrefix.length === 0) return 0;
  if (lowerPrefix === lowerBareName) return 1000;
  if (lowerBareName.startsWith(lowerPrefix)) return 900;

  let segmentStart = 0;
  while (segmentStart < lowerBareName.length) {
    while (segmentStart < lowerBareName.length && lowerBareName.charCodeAt(segmentStart) !== 45) {
      segmentStart += 1;
    }
    segmentStart += 1;
    if (segmentStart >= lowerBareName.length) break;

    if (lowerBareName.startsWith(lowerPrefix, segmentStart)) {
      let segmentEnd = segmentStart;
      while (segmentEnd < lowerBareName.length && lowerBareName.charCodeAt(segmentEnd) !== 45) {
        segmentEnd += 1;
      }
      return lowerPrefix.length === segmentEnd - segmentStart ? 1000 : 900;
    }
  }

  return 0;
}

/**
 * Whether a mid-prompt slash token (`prose … /tok`) is skill-shaped enough to
 * surface `name` (oh-my-pi's `midPromptSkillTokenMatches`). Deliberately
 * stricter than submitted-command matching: a stray `/word` in running prose
 * must not keep the popup alive through fuzzy name/description hits.
 */
function midPromptSkillTokenMatches(lowerToken: string, name: string, description: string): boolean {
  if (SKILL_NAMESPACE.startsWith(lowerToken)) return true;
  const lowerName = name.toLowerCase();
  if (lowerToken.startsWith(SKILL_NAMESPACE)) {
    if (scoreCommandTextMatch(lowerToken, lowerName) > 0) return true;
    return description.length > 0 && scoreCommandTextMatch(lowerToken, description.toLowerCase()) > 0;
  }
  return (
    lowerName.startsWith(SKILL_NAMESPACE) &&
    skillBareNameBreakoutTier(lowerToken, lowerName.slice(SKILL_NAMESPACE.length)) > 0
  );
}

/** The collapsed `/skill:` group row: one entry standing in for every skill. */
function skillNamespaceRow(skillCount: number): ComposerPickItem {
  return {
    id: 'command-skill-namespace',
    name: SKILL_NAMESPACE,
    description: `${skillCount} skill${skillCount === 1 ? '' : 's'}`,
    kind: 'skill',
    source: 'skill',
    token: SKILL_NAMESPACE_TOKEN,
    // Accepted without a trailing space so the popup reopens on the individual
    // skills — oh-my-pi's namespace-row accept path.
    insertWithoutSpace: true,
  };
}

/**
 * Collapse `skill:*` entries into a single `/skill:` namespace row while the
 * typed prefix has not committed to the namespace (oh-my-pi's
 * `collapseSkillNamespace`). A skill breaks out of the group only when its bare
 * name matches the prefix at the beginning of the name or a hyphen-delimited
 * segment, at a strictly stronger tier than every non-skill command name and
 * alias; a tie keeps the popup command-only, and fuzzy-only skill hits never
 * surface.
 */
function collapseSkillNamespace(items: ComposerPickItem[], lowerPrefix: string): ComposerPickItem[] {
  if (lowerPrefix.startsWith(SKILL_NAMESPACE)) return items;
  const approachesNamespace = SKILL_NAMESPACE.startsWith(lowerPrefix);
  let commandTier = 0;
  if (!approachesNamespace) {
    for (const item of items) {
      const name = item.name.toLowerCase();
      if (name.startsWith(SKILL_NAMESPACE)) continue;
      commandTier = Math.max(commandTier, commandBreakoutTier(lowerPrefix, name));
      for (const alias of item.aliases ?? []) {
        commandTier = Math.max(commandTier, commandBreakoutTier(lowerPrefix, alias.toLowerCase()));
      }
      if (commandTier === 1000) break;
    }
  }

  let skillCount = 0;
  const rest = items.filter((item) => {
    const name = item.name.toLowerCase();
    if (!name.startsWith(SKILL_NAMESPACE)) return true;
    skillCount += 1;
    return (
      !approachesNamespace &&
      skillBareNameBreakoutTier(lowerPrefix, name.slice(SKILL_NAMESPACE.length)) > commandTier
    );
  });

  if (skillCount === 0) return items;
  if (!SKILL_NAMESPACE.startsWith(lowerPrefix)) return rest;
  rest.push(skillNamespaceRow(skillCount));
  return rest;
}

/** Prefix-match range for the rendered name, or null when nothing aligns. */
function prefixMatch(name: string, query: string): { start: number; end: number } | null {
  if (query.length === 0) return null;
  return name.toLowerCase().startsWith(query.toLowerCase()) ? { start: 0, end: query.length } : null;
}

/**
 * Score one command item the way oh-my-pi's `buildSlashCommandCompletions`
 * does: the stronger of the name score (skills also match on their bare name)
 * and half the description subsequence score. When an alias outscores the
 * primary name the alias becomes the surfaced token, so `/models` inserts
 * `/models`.
 */
function rankCommandItem(
  item: ComposerPickItem,
  lowerPrefix: string,
): { item: ComposerPickItem; score: number; match: { start: number; end: number } | null } | null {
  const name = item.name;
  const lowerName = name.toLowerCase();
  const isSkillCommand = lowerName.startsWith(SKILL_NAMESPACE);

  const nameScore =
    lowerPrefix.length === 0 && isSkillCommand
      ? 950
      : isSkillCommand
        ? Math.max(
            scoreCommandTextMatch(lowerPrefix, lowerName),
            skillBareNameBreakoutTier(lowerPrefix, lowerName.slice(SKILL_NAMESPACE.length)),
          )
        : scoreCommandTextMatch(lowerPrefix, lowerName);

  const lowerDesc = item.description.toLowerCase();
  const descScore =
    lowerDesc && subsequenceMatch(lowerPrefix, lowerDesc) ? subsequenceScore(lowerPrefix, lowerDesc) * 0.5 : 0;

  const primaryScore = Math.max(nameScore, descScore);
  let best = primaryScore > 0 ? { item, score: primaryScore, match: prefixMatch(name, lowerPrefix) } : undefined;

  if (lowerPrefix.length > 0) {
    for (const alias of item.aliases ?? []) {
      if (alias.toLowerCase() === lowerName) continue;
      const aliasScore = scoreCommandTextMatch(lowerPrefix, alias.toLowerCase());
      if (aliasScore === 0 || (best && aliasScore <= best.score)) continue;
      best = {
        item: { ...item, name: alias, token: `/${alias}` },
        score: aliasScore,
        match: prefixMatch(alias, lowerPrefix),
      };
    }
  }

  return best ?? null;
}

function rankCommands(items: ComposerPickItem[], lowerPrefix: string): ComposerMatchItem[] {
  const ranked: Array<{ item: ComposerPickItem; score: number; match: { start: number; end: number } | null }> = [];
  for (const item of items) {
    const hit = rankCommandItem(item, lowerPrefix);
    if (hit) ranked.push(hit);
  }
  // Equal scores keep list order — oh-my-pi falls back to usage, which the
  // Kabmo does not track, then to stable registry order.
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((entry) => ({ ...entry.item, match: entry.match }));
}

/**
 * Filter `/`-command items for the command-name phase. `midPrompt` restricts
 * the pool to skills (oh-my-pi's mid-prompt lookup); otherwise skills collapse
 * into the `/skill:` namespace row until the prefix commits to the namespace.
 */
export function filterCommandItems(items: ComposerPickItem[], query: string, midPrompt = false): ComposerMatchItem[] {
  const lowerPrefix = query.toLowerCase();

  if (midPrompt) {
    const skills = items.filter(
      (item) =>
        item.name.toLowerCase().startsWith(SKILL_NAMESPACE) &&
        midPromptSkillTokenMatches(lowerPrefix, item.name, item.description),
    );
    return rankCommands(skills, lowerPrefix);
  }

  return rankCommands(collapseSkillNamespace(items, lowerPrefix), lowerPrefix);
}

/**
 * Subcommand items for the `args` phase, mirroring oh-my-pi's declarative
 * `buildArgumentCompletions`: a case-insensitive prefix match on the
 * subcommand name, and nothing once the argument text itself contains a space.
 */
export function commandArgumentItems(
  items: ComposerPickItem[],
  command: string,
  query: string,
): ComposerMatchItem[] {
  if (query.includes(' ')) return [];

  const lower = query.toLowerCase();
  const lowerCommand = command.toLowerCase();
  const owner = items.find(
    (item) =>
      item.name.toLowerCase() === lowerCommand ||
      (item.aliases ?? []).some((alias) => alias.toLowerCase() === lowerCommand),
  );
  const subcommands: ComposerSubcommand[] = owner?.subcommands ?? [];
  if (subcommands.length === 0) return [];

  return subcommands
    .filter((sub) => sub.name.toLowerCase().startsWith(lower))
    .map((sub) => ({
      id: `${owner?.id ?? command}-sub-${sub.name}`,
      name: sub.name,
      description: sub.description ?? sub.usage ?? '',
      kind: 'command' as const,
      source: 'command' as const,
      token: sub.name,
      match: prefixMatch(sub.name, query),
    }));
}
