import Foundation
import KabmoShell

/// The server list's rules, and the two wires built from it.
///
/// The failures that matter here are all silent: an address lost on upgrade, a
/// duplicate row that can never disagree with itself, an active row that
/// disappears with the row the user just removed, and a `servers_state` that
/// offers a phone a "Start a local server" it cannot honour.
enum ServerListTests {
  static func run() {
    Harness.group("ServerList — migration")

    let migrated = ServerList.migrated(legacyURL: "http://192.168.1.10:3000")
    Harness.equal("one row from the old key", migrated.entries.count, 1)
    Harness.equal("active is the migrated address", migrated.activeURL, "http://192.168.1.10:3000")
    Harness.equal("the label is derived", migrated.entries[0].label, "192.168.1.10:3000")

    Harness.equal("a first run has no rows", ServerList.migrated(legacyURL: nil).entries.count, 0)
    Harness.equal("a blank legacy address is nothing", ServerList.migrated(legacyURL: "   ").entries.count, 0)
    Harness.equal("an unreadable wire is empty, never a crash", ServerList.parse("{").entries.count, 0)

    Harness.group("ServerList — remembering")

    let two = ServerList.migrated(legacyURL: "http://a:3000")
      .withRemembered(url: "https://office.example:8443", label: "Office")
    Harness.equal("the second server is added", two.entries.count, 2)
    Harness.equal("and becomes active", two.activeURL, "https://office.example:8443")

    let duplicate = ServerList().withRemembered(url: "http://a:3000").withRemembered(url: "http://a:3000", label: "Living room")
    Harness.equal("the same origin is one row", duplicate.entries.count, 1)
    Harness.equal("with the newer label", duplicate.entries[0].label, "Living room")

    let removed = ServerList().withRemembered(url: "http://a:3000").withRemembered(url: "http://b:3000").without(url: "http://b:3000")
    Harness.equal("removing the active row leaves one", removed.entries.count, 1)
    Harness.equal("and falls back to the first", removed.activeURL, "http://a:3000")

    let untouched = ServerList().withRemembered(url: "http://a:3000")
    Harness.equal("activating an unknown address changes nothing", untouched.withActive(url: "http://elsewhere:3000"), untouched)

    Harness.group("ServerList — storage")

    let stored = ServerList(
      entries: [
        StoredServer(label: "Home \"NAS\"", url: "http://a:3000"),
        StoredServer(label: "Office", url: "https://b:8443"),
      ],
      activeURL: "https://b:8443"
    )
    let restored = ServerList.parse(stored.wire)
    Harness.equal("the rows survive the wire", restored.entries, stored.entries)
    Harness.equal("and so does which one is active", restored.activeURL, stored.activeURL)

    Harness.group("ServerWire — what a phone answers")

    let empty = ServerWire.state(entries: [], activeURL: nil)
    Harness.check("an empty state says it cannot start servers", empty.contains("\"startable\":false"))
    Harness.check("and found nothing local", empty.contains("\"detected\":[]"))

    let one = ServerWire.state(
      entries: [
        ServerWire.Entry(
          label: "Home NAS", url: "http://192.168.1.10:3000", running: true,
          version: "0.5.3", mode: "prod", pid: 4211, startedAt: "2026-01-01T00:00:00.000Z"
        )
      ],
      activeURL: "http://192.168.1.10:3000"
    )
    Harness.check("a row carries its probe", one.contains("\"running\":true"))
    Harness.check("with the version", one.contains("\"version\":\"0.5.3\""))
    Harness.check("and never as owned", one.contains("\"owned\":false"))
    Harness.check("active id is the origin", one.contains("\"activeId\":\"http://192.168.1.10:3000\""))

    let stopped = ServerWire.state(
      entries: [ServerWire.Entry(label: "Office", url: "https://office:3000", running: false)],
      activeURL: "https://office:3000"
    )
    // A failed probe must not draw "vnull" over the row.
    Harness.check("a stopped row carries no invented version", !stopped.contains("version"))

    Harness.group("ServerWire — reply scripts")

    Harness.equal(
      "a refusal is evaluated with the shell's own sentence",
      ServerWire.replyScript(id: 7, ok: false, payload: ServerWire.jsString("Use the origin only.")),
      "window.__kabmoReply && window.__kabmoReply(7, false, \"Use the origin only.\");"
    )
    Harness.equal(
      "a quote in the sentence cannot break the script",
      ServerWire.jsString("He said \"hi\""),
      "\"He said \\\"hi\\\"\""
    )
  }
}
