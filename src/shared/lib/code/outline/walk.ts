/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The four walks a scan spec can ask for. Kept apart from the language table
 * (`scan.ts`) so each file stays readable: the table is data, these are the
 * depth counts that make it true.
 */

import { braceDelta, maskSource } from '@/shared/lib/code/outline/rules';
import type { ScanSpec } from '@/shared/lib/code/outline/spec';
import type { DeclarationRule, MemberRule } from '@/shared/lib/code/outline/rules';
import type { OutlineKind, OutlineSymbol } from '@/shared/lib/code/outline/types';

/**
 * A braced language: declarations at the document's top level, plus members one
 * level inside a scope this file itself declared.
 */
export function bracedOutline(lines: readonly string[], spec: ScanSpec): OutlineSymbol[] {
  const masked = maskSource(lines, spec.mask);
  const out: OutlineSymbol[] = [];
  let depth = 0;
  /** Open scope bodies, innermost last. */
  const openScopes: { depth: number; kind: OutlineKind }[] = [];

  for (let index = 0; index < masked.length; index += 1) {
    const trimmed = masked[index].trim();
    const scope = openScopes.length > 0 && depth === openScopes[openScopes.length - 1].depth
      ? openScopes[openScopes.length - 1]
      : null;

    if (trimmed && (depth === 0 || scope)) {
      // Masking preserves columns, so the indentation the trim removed is the
      // offset the rule's own match index has to be added to.
      const indent = masked[index].length - masked[index].trimStart().length;
      // A member position is asked FIRST: `val size = 0` is a field, and the
      // declaration rules would otherwise claim it as a top-level constant.
      const member = scope && spec.members ? matchMember(spec.memberRules ?? [], trimmed) : null;
      if (member) {
        out.push({
          name: member.name,
          kind: member.kind,
          line: index + 1,
          column: indent + member.column + 1,
          depth: 1,
        });
      } else {
        const insideTypeBody = scope !== null && TYPE_BODY.has(scope.kind);
        const declaration = matchRule(spec.rules, trimmed, insideTypeBody);
        if (declaration) {
          out.push({
            name: declaration.name,
            // A `fn`/`fun`/`def` inside a class body is a method, not a free
            // function; inside a namespace it stays a function.
            kind: insideTypeBody && declaration.kind === 'function' ? 'method' : declaration.kind,
            line: index + 1,
            column: indent + declaration.column + 1,
            depth: scope ? 1 : 0,
          });
          // Only a scope-opening kind nests, and only at the top level: a class
          // inside a class is a local type, not a member this list can show.
          // A class inside a namespace opens a member scope as well; a type
          // inside a type body never does (it is not reported at all).
          if (!insideTypeBody && (spec.scopes ?? []).includes(declaration.kind)) {
            openScopes.push({ depth: depth + 1, kind: declaration.kind });
          }
        }
      }
    }

    depth += braceDelta(masked[index]);
    if (depth <= 0) {
      depth = 0;
      openScopes.length = 0;
    } else {
      while (openScopes.length > 0 && depth < openScopes[openScopes.length - 1].depth) openScopes.pop();
    }
  }
  return out;
}

/** A scope whose body may not hold another TYPE (a class, an impl, a trait). */
const TYPE_BODY = new Set<OutlineKind>(['class', 'interface', 'struct', 'trait', 'impl', 'enum']);

function matchRule(
  rules: readonly DeclarationRule[],
  trimmed: string,
  insideTypeBody: boolean,
): { name: string; kind: OutlineKind; column: number } | null {
  for (const rule of rules) {
    if (insideTypeBody && NON_MEMBER_KINDS.has(rule.kind)) continue;
    const match = rule.re.exec(trimmed);
    const name = match?.[1]?.trim();
    if (!match || !name) continue;
    return { name, kind: rule.kind, column: match.indices?.[1]?.[0] ?? 0 };
  }
  return null;
}

/** A type declared at a member's depth is a local class/type, not a member. */
const NON_MEMBER_KINDS = new Set<OutlineKind>(['class', 'interface', 'enum', 'type', 'struct', 'trait', 'impl', 'module']);

function matchMember(
  rules: readonly MemberRule[],
  trimmed: string,
): { name: string; kind: OutlineKind; column: number } | null {
  for (const rule of rules) {
    const match = rule.re.exec(trimmed);
    const name = match?.[1]?.trim();
    if (!match || !name || NON_MEMBER.has(name)) continue;
    return { name, kind: rule.kind, column: match.indices?.[1]?.[0] ?? 0 };
  }
  return null;
}

const NON_MEMBER = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'typeof', 'await', 'yield',
  'super', 'this', 'delete', 'void', 'function', 'constructor', 'else', 'do', 'try', 'with',
]);

/** An indentation-nested language: a dedent closes the scope it was inside. */
export function indentOutline(lines: readonly string[], spec: ScanSpec): OutlineSymbol[] {
  const masked = maskSource(lines, spec.mask);
  const out: OutlineSymbol[] = [];
  /** Open declaration indents, innermost last. */
  const open: number[] = [];

  for (let index = 0; index < masked.length; index += 1) {
    const raw = masked[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const indent = raw.length - raw.trimStart().length;
    while (open.length > 0 && indent <= open[open.length - 1]) open.pop();
    const declaration = matchRule(spec.rules, trimmed, false);
    if (!declaration) continue;
    // A body nested two levels deep is a closure or a local class, not a row.
    if (open.length > 1) {
      open.push(indent);
      continue;
    }
    const insideScope = open.length === 1;
    out.push({
      name: declaration.name,
      kind: insideScope && declaration.kind === 'function' ? 'method' : declaration.kind,
      line: index + 1,
      column: indent + declaration.column + 1,
      depth: insideScope ? 1 : 0,
    });
    open.push(indent);
  }
  return out;
}

/** A flat language: no nesting is reported, so every match is a top-level row. */
export function flatOutline(lines: readonly string[], spec: ScanSpec): OutlineSymbol[] {
  const masked = maskSource(lines, spec.mask);
  const out: OutlineSymbol[] = [];
  for (let index = 0; index < masked.length; index += 1) {
    const raw = masked[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const declaration = matchRule(spec.rules, trimmed, false);
    if (!declaration) continue;
    const previous = out[out.length - 1];
    if (spec.dedupe && previous && previous.name === declaration.name && previous.kind === declaration.kind) continue;
    out.push({
      name: declaration.name,
      kind: declaration.kind,
      line: index + 1,
      column: raw.length - raw.trimStart().length + declaration.column + 1,
      depth: 0,
    });
  }
  return out;
}

/**
 * Markdown: headings, and nothing else. A fenced block is skipped by counting
 * the fences, because `# a comment` inside a shell example is not a heading.
 */
export function markdownOutline(lines: readonly string[]): OutlineSymbol[] {
  const out: OutlineSymbol[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    out.push({
      name: heading[2],
      kind: 'heading',
      line: index + 1,
      column: heading[1].length + 2,
      depth: Math.min(heading[1].length - 1, 2),
    });
  }
  return out;
}

/** JSON: the keys of the root object, at their own line. */
export function jsonOutline(lines: readonly string[]): OutlineSymbol[] {
  const masked = maskSource(lines, 'raw');
  const out: OutlineSymbol[] = [];
  let depth = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const trimmed = masked[index].trim();
    if (depth === 1) {
      const key = /^"([^"]+)"\s*:/.exec(trimmed);
      if (key) {
        out.push({
          name: key[1],
          kind: 'key',
          line: index + 1,
          column: masked[index].length - masked[index].trimStart().length + 1,
          depth: 0,
        });
      }
    }
    depth += braceDelta(masked[index]);
    if (depth < 0) depth = 0;
  }
  return out;
}
