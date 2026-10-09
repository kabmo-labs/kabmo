/**
 * Tiny dependency-free semantic-version helpers for the update checker.
 * Deliberately lenient: it compares numeric dotted segments only and ignores
 * any pre-release suffix, which is all the GitHub/omp version strings need.
 */

/** Strip a leading `v`/`V` and surrounding whitespace. */
export function normalizeVersion(v: string): string {
  return v.trim().replace(/^[vV]/, '');
}

function toSegments(v: string): number[] {
  const core = normalizeVersion(v).split('-')[0] ?? '';
  return core.split('.').map((segment) => (/^\d+$/.test(segment) ? Number.parseInt(segment, 10) : 0));
}

/** Compare two versions: -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a: string, b: string): number {
  const left = toSegments(a);
  const right = toSegments(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** True when `latest` is strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/**
 * A plugin's declared host requirement, as a version range.
 *
 * The grammar is deliberately the subset a plugin manifest needs and nothing
 * more — `^`, `~`, the four comparisons, `=`, a bare exact version, and
 * space-separated conjunctions. It is parsed HERE, against the same segment
 * arithmetic the update check uses, rather than by a range library: two
 * implementations would eventually disagree about `1.2` vs `1.2.0`, and the
 * disagreement would show up as a plugin refused (or admitted) for the wrong
 * reason. A range that does not parse is not a pass — `satisfiesRange` answers
 * false, and `isValidRange` is what lets the caller report it as malformed
 * instead of as a mismatch.
 */
interface RangeToken {
  operator: '^' | '~' | '>=' | '<=' | '>' | '<' | '=';
  version: string;
}

const RANGE_TOKEN_RE = /^(\^|~|>=|<=|>|<|=)?(\d+(?:\.\d+)*)$/;

/** Parse a range into its comparisons, `[]` for "any", or null when malformed. */
function parseRange(range: string): RangeToken[] | null {
  const text = range.trim();
  if (!text || text === '*') return [];
  const tokens: RangeToken[] = [];
  for (const part of text.split(/\s+/)) {
    const match = RANGE_TOKEN_RE.exec(part);
    if (!match) return null;
    tokens.push({ operator: (match[1] as RangeToken['operator'] | undefined) ?? '=', version: match[2] as string });
  }
  return tokens;
}

/** True when the range is one of the supported forms; a malformed range is not a pass. */
export function isValidRange(range: string): boolean {
  return parseRange(range) !== null;
}

function matchesToken(version: string, token: RangeToken): boolean {
  const order = compareVersions(version, token.version);
  switch (token.operator) {
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '=':
      return order === 0;
    case '~': {
      // Same major.minor, at or above the range's version.
      const v = toSegments(version);
      const t = toSegments(token.version);
      return order >= 0 && v[0] === t[0] && v[1] === t[1];
    }
    case '^': {
      // Compatible-with: the same major for a 1.x+ range, the same minor for a
      // 0.x one (a 0.x minor is the breaking unit).
      const v = toSegments(version);
      const t = toSegments(token.version);
      if ((t[0] ?? 0) > 0) return order >= 0 && v[0] === t[0];
      return order >= 0 && v[0] === t[0] && v[1] === t[1];
    }
  }
}

/** True when `version` satisfies `range`; a malformed range answers false. */
export function satisfiesRange(version: string, range: string): boolean {
  const tokens = parseRange(range);
  if (!tokens) return false;
  return tokens.every((token) => matchesToken(version, token));
}
