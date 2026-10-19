/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hoist every nested at-rule out of the style rule that contains it.
 *
 * Bun's CSS minifier keeps the nesting it is handed, and for a target that is
 * not the browser (`target: 'bun'`, which this build needs because its
 * entrypoint is the SERVER) it re-nests a rule's nested at-rule into
 * `@supports (…) { & { … } }`. Chrome does not apply a nested rule whose parent
 * selector names a pseudo-element, so `&` under `::placeholder` or
 * `::-webkit-scrollbar-thumb` is dropped and the rule's earlier fallback
 * declaration wins instead — measured on the built bundle: the composer
 * placeholder painted at full ink rather than 40%, every scrollbar thumb opaque
 * rather than 20%.
 *
 * Tailwind v4 emits its colour fallbacks in exactly that shape (`color:
 * var(--x); @supports (color: color-mix(…)) { color: color-mix(…) }`), so one
 * minifier decision reached 16 rules: every placeholder utility in the app and
 * every scrollbar rule, base and xterm included. The rsbuild pipeline this
 * replaced compiled for browsers and flattened the nesting itself.
 *
 * Flattening here is what makes the bundle immune: the emitted CSS is
 * `@supports (…) { .sel::placeholder { … } }` at the top level, which no
 * minifier has anything left to re-nest and every browser applies. Declaration
 * order is preserved exactly — a rule's declarations stay in the segments they
 * were written in, and each at-rule is hoisted to the position it occupied — so
 * the cascade is unchanged.
 */

import postcss from 'postcss';
import type { AtRule, ChildNode, Container, Plugin, Rule } from 'postcss';

/** Resolve a nested selector against the rule it was written inside. */
function resolveSelector(parentSelector: string, nestedSelector: string): string {
  if (nestedSelector.includes('&')) return nestedSelector.replaceAll('&', parentSelector);
  return `${parentSelector} ${nestedSelector}`;
}

/**
 * Resolve `&` in the rules directly inside `container`, descending through
 * at-rules only: `&` still refers to the nearest enclosing STYLE rule, and an
 * intermediate one is hoisted on a later pass.
 *
 * Runs BEFORE `wrapBareDeclarations` — the rule that wraps bare declarations
 * already carries the parent's resolved selector, and resolving it again would
 * turn `::placeholder` into `::placeholder ::placeholder`.
 */
function resolveAmpersands(container: Container, parentSelector: string): void {
  for (const node of container.nodes ?? []) {
    if (node.type === 'rule') node.selector = resolveSelector(parentSelector, node.selector);
    else if (node.type === 'atrule') resolveAmpersands(node, parentSelector);
  }
}

/** Wrap an at-rule's bare declarations in `parentSelector`, keeping them in place. */
function wrapBareDeclarations(atRule: AtRule, parentSelector: string): void {
  const nodes = [...(atRule.nodes ?? [])];
  if (!nodes.some((node) => node.type === 'decl')) return;
  const rebuilt: ChildNode[] = [];
  let declarations: ChildNode[] = [];
  const flush = () => {
    if (declarations.length === 0) return;
    const rule = postcss.rule({ selector: parentSelector });
    rule.append(declarations);
    rebuilt.push(rule);
    declarations = [];
  };
  for (const node of nodes) {
    if (node.type === 'decl') declarations.push(node);
    else {
      flush();
      rebuilt.push(node);
    }
  }
  flush();
  atRule.removeAll();
  atRule.append(rebuilt);
}

/** Hoist `rule`'s nested at-rules into its own container. Reports whether it moved any. */
function hoistNestedAtRules(rule: Rule): boolean {
  const container = rule.parent;
  // Snapshot: reparenting the declarations empties `rule.nodes` mid-iteration.
  const nodes = [...(rule.nodes ?? [])];
  if (!container || !nodes.some((node) => node.type === 'atrule')) return false;

  const replacement: ChildNode[] = [];
  let declarations: ChildNode[] = [];
  const flush = () => {
    if (declarations.length === 0) return;
    const segment = postcss.rule({ selector: rule.selector, raws: { ...rule.raws } });
    segment.append(declarations);
    replacement.push(segment);
    declarations = [];
  };

  for (const node of nodes) {
    if (node.type !== 'atrule') {
      declarations.push(node);
      continue;
    }
    flush();
    const hoisted = node.clone();
    resolveAmpersands(hoisted, rule.selector);
    wrapBareDeclarations(hoisted, rule.selector);
    replacement.push(hoisted);
  }
  flush();

  container.insertBefore(rule, replacement);
  rule.remove();
  return true;
}

/**
 * PostCSS plugin: hoist nested at-rules out of the rules containing them.
 *
 * `OnceExit` rather than `Once` so Tailwind's own pass has already expanded
 * `@theme` and every utility before there is a rule to flatten; register it
 * LAST for the same reason.
 */
export function flattenNestedAtRules(): Plugin {
  return {
    postcssPlugin: 'kabmo-flatten-nested-at-rules',
    OnceExit(root) {
      // A hoist can expose another nested at-rule in the segment that received
      // it, so repeat until a full pass moves nothing.
      let hoisted = true;
      while (hoisted) {
        hoisted = false;
        const rules: Rule[] = [];
        root.walkRules((rule) => {
          rules.push(rule);
        });
        // Reverse document order: a nested rule is walked after its parent, so
        // the inner one is flattened first and its parent is then still intact.
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          if (hoistNestedAtRules(rules[index])) hoisted = true;
        }
      }
    },
  };
}
