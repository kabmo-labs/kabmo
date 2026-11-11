/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which device class this client is, for the Notifications page's two delivery
 * switches.
 *
 * This is a DEVICE fact, not a layout one: `App.tsx` also treats a narrow
 * desktop window as mobile so the shell can reflow, but a 700px-wide desktop
 * browser is still a desktop and must honour the Desktop switch. The union is
 * deliberately the same as the touch-device rule (a phone/tablet reports a
 * coarse primary pointer, and iPadOS desktop-class Safari answers the
 * touch-points + `hover: none` pair) plus the phone user agent, which is what
 * the shells and mobile browsers identify themselves with.
 */

const MOBILE_UA =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

/** Whether this client is a phone or tablet — what the Mobile switch governs. */
export function isMobileNotificationClient(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (MOBILE_UA.test(navigator.userAgent ?? '')) return true;
  if (typeof window.matchMedia !== 'function') return false;
  if (window.matchMedia('(pointer: coarse)').matches) return true;
  return (
    (navigator.maxTouchPoints ?? 0) > 0 && window.matchMedia('(hover: none)').matches
  );
}

/** The delivery switch this client reads: `mobile` on a phone/tablet, else `desktop`. */
export function notificationPlatformForClient(): 'desktop' | 'mobile' {
  return isMobileNotificationClient() ? 'mobile' : 'desktop';
}
