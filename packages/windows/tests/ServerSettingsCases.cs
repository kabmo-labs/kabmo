/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The splash's "Server settings", pinned without a window.
 *
 * Two failures this covers, neither of which throws in the app: the dialog
 * prefilled with an address nobody typed (submitting the wrong server), and
 * Connect accepting an address the store would then refuse. Ported from the
 * macOS suite's `ServerSettingsForm` cases, because the two shells must answer
 * the same question the same way.
 */

using KabmoDesktop;

namespace KabmoDesktopTests;

static class ServerSettingsCases
{
    public static void Run(Action<string, bool> check, Action<string> group)
    {
        group("ServerSettingsForm");

        var state = new ServersState
        {
            Entries = new[]
            {
                new ServerEntry
                {
                    Id = "remote:http://nas:8443", Label = "NAS", Url = "http://nas:8443",
                    Kind = ServerKind.Remote, Running = false, Source = "stored",
                },
                new ServerEntry
                {
                    Id = "local:3001", Label = "Local :3001", Url = "http://127.0.0.1:3001",
                    Kind = ServerKind.Managed, Port = 3001, Running = true, Owned = true, Source = "stored",
                },
            },
            Detected = new[]
            {
                new ServerEntry
                {
                    Id = "local:7920", Label = "Found :7920", Url = "http://127.0.0.1:7920",
                    Kind = ServerKind.Managed, Port = 7920, Running = true, Source = "record",
                },
            },
            ActiveId = "local:3001",
            ActiveUrl = "http://127.0.0.1:3001",
        };

        var form = new ServerSettingsForm(state, null);
        check(
            "the field starts on the window's own server",
            form.Address == "http://127.0.0.1:3001");
        check(
            "the picker offers the stored list, then the detected ones",
            form.Rows.Select(row => row.Id).SequenceEqual(
                new[] { "remote:http://nas:8443", "local:3001", "local:7920" }));
        check(
            "a row's title says whether that server answers",
            form.TitleOf(form.Rows[0]) == "NAS · stopped");

        check(
            "picking a row puts its address in the field",
            form.Selecting(form.Rows[0]).Address == "http://nas:8443");

        // The typed address wins over everything: the dialog is re-presented after
        // a refusal with what the user typed, and a prefill from the list would
        // erase it.
        check(
            "a typed address survives a prefill",
            new ServerSettingsForm(state, "https://other:9000").Address == "https://other:9000");
        check(
            "with no server at all the field is empty, never a made-up default",
            new ServerSettingsForm(new ServersState(), null).Address.Length == 0);

        check(
            "a host and port is normalised to the address that will be stored",
            form.Validated() == "http://nas:8443");

        var refused = false;
        try
        {
            _ = new ServerSettingsForm(state, "https://host/kabmo/").Validated();
        }
        catch (ServerException)
        {
            refused = true;
        }
        check("a base path is refused before Connect reaches the store", refused);
    }
}
