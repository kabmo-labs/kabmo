/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When the shell rebuilds the notification daemon's app record.
 *
 * The rule is one heal per version: an update (self-update or a drag from the
 * DMG) must rebuild the record exactly once, and the ordinary launches on that
 * version must not kill the user's notification daemon again. An empty version
 * is `swift run`, which has no bundle for `usernoted` to resolve.
 */
import Foundation

import KabmoDesktop

func notificationRegistrationCases() {
  group("NotificationRegistration")

  check(
    "a new version heals",
    NotificationRegistration.shouldHeal(installedVersion: "0.12.5", lastHealed: "0.12.4")
  )
  check(
    "the same version does not heal twice",
    !NotificationRegistration.shouldHeal(installedVersion: "0.12.5", lastHealed: "0.12.5")
  )
  check(
    "a first launch heals",
    NotificationRegistration.shouldHeal(installedVersion: "0.12.5", lastHealed: nil)
  )
  check(
    "a process with no version never heals",
    !NotificationRegistration.shouldHeal(installedVersion: "", lastHealed: nil)
  )
  check(
    "whitespace is not a version",
    !NotificationRegistration.shouldHeal(installedVersion: "   ", lastHealed: nil)
  )
  check(
    "the version key is stable",
    NotificationRegistration.healedVersionKey == "kabmo.notificationRegistrationVersion"
  )
}
