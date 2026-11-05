/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two things every shell states before its own layout: the document's one
 * `h1`, and whether this instance is running on demo data.
 *
 * Shared by the desktop and the phone because both are the SAME product: a phone
 * that omitted them would leave a page with no heading and a demo instance that
 * looks real on the device most likely to be handed to someone else. Stated in
 * one component so a new layout cannot ship with only one of them.
 */

import { DemoDataBadge } from '@/client/components/common/DemoDataBadge';

export function ShellNotice({ isMock }: { isMock: boolean }) {
  return (
    <>
      {/* The page's one h1. Every panel below heads its own section with an h2 or
          h3, and a document with no h1 gives a screen reader no entry point.
          Visually hidden because the wordmark IS the product's name on screen
          (`BrandWordmark`), and two visible names are one name twice. */}
      <h1 className="sr-only">Kabmo</h1>
      {/* Demo data is stated at the SHELL, not left to a panel deep in Settings:
          measured in `MOCK=true`, the drawer and the transcript were
          indistinguishable from a real install, and only two panels in Settings
          said the word "Mock". */}
      {isMock && <DemoDataBadge variant="strip" />}
    </>
  );
}
