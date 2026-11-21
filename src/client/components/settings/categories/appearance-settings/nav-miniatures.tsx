/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two MINIATURES a navigation choice is drawn as, one per style.
 *
 * Extracted from `PanelNavSection` when the phone got its second drawer and the
 * section would have crossed the 350-line ceiling. They are drawings only —
 * tokens (`bg-ink/10`, `text-ink/40`) so they follow the palette — and each is
 * the shape of a real column rather than an icon: "rail" and "tabs" are words
 * the user has to translate into a picture they have seen.
 */

/** A rail of marks beside a list — the desktop left column, and a phone drawer's chips. */
export function RailMiniature() {
  return (
    <span className="flex h-full gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex w-[9px] flex-col items-center gap-1 border-r border-ink/10 pr-1">
        <span className="h-[5px] w-[5px] rounded-sm bg-ink/70" />
        <span className="h-[5px] w-[5px] rounded-sm bg-ink/25" />
        <span className="h-[5px] w-[5px] rounded-sm bg-ink/25" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="h-[3px] w-[46%] rounded-full bg-ink/45" />
        <span className="h-[3px] w-[62%] rounded-full bg-ink/25" />
        <span className="h-[3px] w-[54%] rounded-full bg-ink/25" />
        <span className="h-[3px] w-[40%] rounded-full bg-ink/20" />
      </span>
    </span>
  );
}

/** A strip of chips over a card grid — the browser-style column. */
export function TabsMiniature() {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex items-center gap-1 border-b border-ink/10 pb-1">
        <span className="h-[6px] w-[6px] rounded-sm border border-ink/20" />
        <span className="h-[6px] w-[28%] rounded-sm bg-ink/70" />
        <span className="h-[6px] w-[24%] rounded-sm border border-ink/20" />
      </span>
      <span className="flex gap-1">
        <span className="h-[16px] w-[22%] rounded border border-ink/15" />
        <span className="h-[16px] w-[22%] rounded border border-ink/15" />
        <span className="h-[16px] w-[22%] rounded border border-ink/15" />
      </span>
    </span>
  );
}

/** A drawer of chips over a long list — a phone drawer's classic chrome. */
export function ClassicDrawerMiniature() {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex h-[7px] items-center gap-1 border-b border-ink/10 pb-1">
        <span className="h-[6px] w-[16%] rounded-sm bg-ink/70" />
        <span className="h-[6px] w-[16%] rounded-sm border border-ink/20" />
        <span className="h-[6px] w-[16%] rounded-sm border border-ink/20" />
        <span className="h-[6px] w-[16%] rounded-sm border border-ink/20" />
      </span>
      <span className="h-[3px] w-[62%] rounded-full bg-ink/25" />
      <span className="h-[3px] w-[54%] rounded-full bg-ink/25" />
      <span className="h-[3px] w-[40%] rounded-full bg-ink/20" />
    </span>
  );
}

/**
 * A short strip over a card grid — a drawer with a home page.
 *
 * `pinned` draws the extra chip a column with an undeletable view leads with
 * (the left drawer's session list), so the two phone cards differ in the fact
 * that actually differs.
 */
export function TabsDrawerMiniature({ pinned = false }: { pinned?: boolean }) {
  return (
    <span className="flex h-full flex-col gap-1 rounded-md border border-ink/10 bg-paper p-1" aria-hidden="true">
      <span className="flex h-[7px] items-center gap-1 border-b border-ink/10 pb-1">
        <span className="h-[6px] w-[6px] rounded-sm border border-ink/20" />
        {pinned ? <span className="h-[6px] w-[20%] rounded-sm bg-ink/70" /> : null}
        <span className={`h-[6px] rounded-sm ${pinned ? 'w-[18%]' : 'w-[24%]'} bg-ink/70`} />
        <span className="h-[6px] w-[20%] rounded-sm border border-ink/20" />
      </span>
      <span className="flex gap-1">
        <span className="h-[16px] w-[24%] rounded border border-ink/15" />
        <span className="h-[16px] w-[24%] rounded border border-ink/15" />
        <span className="h-[16px] w-[24%] rounded border border-ink/15" />
      </span>
    </span>
  );
}
