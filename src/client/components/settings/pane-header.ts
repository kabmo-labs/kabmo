/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one height of a settings pane's identity band.
 *
 * Every band in the sheet — the drawer's search field, a list's count and
 * actions, the detail's title — is the same 4rem row, so the rule under them is
 * one continuous line across the modal. They used to be drawn independently:
 * the search row measured 55px against the detail header's 64px, and the
 * master/detail lists answered 37–44px, so the seam stepped wherever the panes
 * met.
 *
 * The modal's own bars are the sheet's top edge on a phone, which is why
 * `SETTINGS_BAND_HEIGHT_INSET` adds the notch there. The drawer and the inner
 * panes sit below another bar and stay at the plain height.
 */
export const SETTINGS_BAND_HEIGHT = '4rem';

export const SETTINGS_BAND_HEIGHT_INSET = `calc(${SETTINGS_BAND_HEIGHT} + env(safe-area-inset-top, 0px))`;

/** A band's shared shape. The caller adds the padding and its own alignment. */
export const SETTINGS_BAND = 'flex items-center flex-shrink-0 border-b border-ink/10';
