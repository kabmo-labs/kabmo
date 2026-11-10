/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The heading a notification is posted with.
 *
 * Kept in the library, like `WireFormat`: an empty title rendered as an empty
 * banner looks like a working notification in the app, and the only clue is a
 * blank strip in the Action Center.
 */

namespace KabmoDesktop;

public static class NotificationText
{
    /// <summary>The banner's heading; the page leaves it empty for a generic cue.</summary>
    public static string Title(string? raw) =>
        string.IsNullOrWhiteSpace(raw) ? "Kabmo" : raw.Trim();
}
