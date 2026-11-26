/**
 * @license
 * SPDX-License-Identifier: MIT
 */

namespace KabmoDesktop;

/// <summary>
/// The chime a notification kind plays.
///
/// `ask` is the agent blocked on you and must not sound like a finished run;
/// everything else — finish, error, or an older console that sends no kind — is
/// the completion cue. The names are the resources the Windows shell embeds from
/// `assets/notification-sound/`.
/// </summary>
public static class NotificationChime
{
    public const string Completion = "kabmo_notification.wav";
    public const string Attention = "kabmo_attention.wav";

    public static string FileNameFor(string? kind) =>
        kind == "ask" ? Attention : Completion;
}
