/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The values behind the splash's "Server settings" dialog, and every rule about
 * them.
 *
 * Ported from `packages/macos/Sources/KabmoDesktop/ServerSettingsForm.swift`, and
 * for the same reason: the console's own server control is a PAGE, and the one
 * moment a user needs to change the address is the one moment the page cannot
 * load. A failure splash with only Retry leaves a wrong port unfixable without
 * editing `servers.json` by hand.
 *
 * No WPF here: what the field is prefilled with, which rows the picker offers,
 * what a pick does and what an address is refused with are rules, and the runner
 * asserts them on any machine.
 */

namespace KabmoDesktop;

/// <summary>One remembered-or-detected server the picker offers.</summary>
public sealed record ServerSettingsRow(string Id, string Label, string Url, bool Running);

public sealed class ServerSettingsForm
{
    /// <summary>The stored list first, then the instances found on this machine.</summary>
    public IReadOnlyList<ServerSettingsRow> Rows { get; }

    /// <summary>
    /// What the field holds. Editing the field and picking a row both change THIS,
    /// so the two controls cannot disagree about the address being submitted.
    /// </summary>
    public string Address { get; }

    /// <summary>
    /// <paramref name="address"/> wins when it has anything in it — the dialog is
    /// re-presented after a refusal with what the user typed, and replacing that
    /// with the stored address would erase the correction they are making.
    /// Otherwise the window's own active URL, then the first row, then empty:
    /// never a made-up default, because `http://127.0.0.1:3000` prefilled with
    /// nothing behind it is an address the user will submit without reading.
    /// </summary>
    public ServerSettingsForm(ServersState state, string? address)
    {
        Rows = RowsFor(state);
        var trimmed = (address ?? "").Trim();
        if (trimmed.Length > 0) Address = trimmed;
        else if (!string.IsNullOrEmpty(state.ActiveUrl)) Address = state.ActiveUrl!;
        else Address = Rows.Count > 0 ? Rows[0].Url : "";
    }

    private ServerSettingsForm(IReadOnlyList<ServerSettingsRow> rows, string address)
    {
        Rows = rows;
        Address = address;
    }

    /// <summary>The picker's rows: everything stored, then everything detected.</summary>
    public static IReadOnlyList<ServerSettingsRow> RowsFor(ServersState state)
    {
        ServerSettingsRow Row(ServerEntry entry) =>
            new(entry.Id, entry.Label, entry.Url, entry.Running);
        return state.Entries.Select(Row).Concat(state.Detected.Select(Row)).ToList();
    }

    /// <summary>
    /// What the picker prints for a row: the label and whether it answers, which
    /// is the difference between "choose my NAS" and "choose the NAS that is down".
    /// </summary>
    public string TitleOf(ServerSettingsRow row) =>
        $"{row.Label} · {(row.Running ? "running" : "stopped")}";

    /// <summary>
    /// Choose a remembered server: the field carries its address, and Connect
    /// submits that — not the row's id. A row is a shortcut, never a second value.
    /// </summary>
    public ServerSettingsForm Selecting(ServerSettingsRow row) => WithAddress(row.Url);

    public ServerSettingsForm WithAddress(string next) => new(Rows, next);

    /// <summary>
    /// The address to connect to, or the sentence that refuses it.
    ///
    /// The same <see cref="ServerAddress.Normalise"/> the store uses, so the
    /// dialog cannot accept an address the store would then reject — and the
    /// refusal is a sentence a reader can act on, never "invalid input".
    /// </summary>
    public string Validated() => ServerAddress.Normalise(Address);
}
