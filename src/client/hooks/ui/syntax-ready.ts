/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'preact/hooks';

import { isSyntaxReady, onLanguageReady, onSyntaxReady } from '@/shared/lib/code/highlighter';

/**
 * Re-renders when the Shiki highlighter finishes booting **and** whenever a
 * grammar lands. Grammars are fetched on demand — a language nobody renders is
 * never downloaded — so a component may see a `true` value here while the
 * grammar for its own code is still in flight; the second subscription is what
 * swaps the plain-text fallback for tokenized markup once the chunk arrives.
 */
export function useSyntaxReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => isSyntaxReady());

  useEffect(() => {
    const offBoot = onSyntaxReady(() => setReady(true));
    const offLang = onLanguageReady(() => setReady(true));
    return () => {
      offBoot();
      offLang();
    };
  }, []);

  return ready;
}
