/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The server list's actions: what the panel offers, and what it may stop.
 *
 * No windowing, no HTTP client, no process spawning — every side effect arrives
 * through `IServerDeps`, so the decisions are testable on their own. That split
 * is not tidiness: each rule below is a way the panel could LIE, and none of
 * them throws in the app. A row that offers Stop for a process the shell did not
 * start looks exactly like a row that offers it for one it did.
 *
 * Ported from `packages/macos/Sources/KabmoDesktop/Store.swift`; the wording of
 * each rule is the same because the behaviour is.
 */

namespace KabmoDesktop;

/**
 * The server list, its selection, and the actions the panel performs.
 *
 * Serialized through one gate, the way the Swift port is an `actor`: two panel
 * actions can overlap (a poll and a click), and the persisted state is read and
 * rewritten as a whole.
 */
public sealed class ServerStore
{
    private readonly IServerDeps _deps;
    private readonly Action<PersistedState> _save;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private PersistedState _state;

    public ServerStore(IServerDeps deps, Func<PersistedState?> load, Action<PersistedState> save)
    {
        _deps = deps;
        _save = save;
        _state = load() ?? new PersistedState();
    }

    private void Persist() => _save(_state);

    /// <summary>The ids this shell spawned, for the boot-time adoption pass.</summary>
    public IReadOnlyDictionary<string, int> SpawnedPids() => _state.Spawned;

    /// <summary>
    /// The palette the console last reported, or the shipped one.
    ///
    /// Read at launch, before any page exists — which is why it is persisted
    /// rather than asked for. A wire this build cannot parse is the shipped
    /// palette, never a partial one.
    /// </summary>
    public ShellPalette Palette() => ShellPalette.Parse(_state.Palette) ?? ShellPalette.Shipped;

    /// <summary>
    /// Remember the console's palette for the next launch.
    ///
    /// An unreadable wire is not written: keeping the previous palette is the only
    /// answer that cannot repaint the shell with a colour no theme chose.
    /// </summary>
    public async Task SetPaletteAsync(string? wire)
    {
        var next = ShellPalette.Parse(wire);
        if (next is null) return;
        await _gate.WaitAsync();
        try
        {
            if (_state.Palette == next.Wire) return;
            _state = _state with { Palette = next.Wire };
            Persist();
        }
        finally
        {
            _gate.Release();
        }
    }

    /**
     * Every answering server, the detected ones, and the selection.
     *
     * The state is COPIED under the gate and probed after it is released: a probe
     * is a socket with a 1.5s budget, and holding the gate across it would make a
     * list of five servers a 7.5s panel — and would block a click behind a poll.
     * The Swift port gets that for free from actor re-entrancy on `await`; here
     * it is stated.
     */
    public async Task<ServersState> SnapshotAsync()
    {
        PersistedState state;
        await _gate.WaitAsync();
        try
        {
            state = _state;
        }
        finally
        {
            _gate.Release();
        }

        var entries = new List<ServerEntry>();
        foreach (var stored in state.Entries)
        {
            var health = await _deps.ProbeAsync(stored.Url).ConfigureAwait(false);
            entries.Add(new ServerEntry
            {
                Id = stored.Id,
                Label = stored.Label,
                Url = stored.Url,
                Kind = stored.Kind,
                Port = stored.Port,
                Running = health is not null,
                Owned = state.Spawned.ContainsKey(stored.Id),
                Version = health?.Version,
                Mode = health?.Mode,
                Pid = health?.Pid,
                StartedAt = health?.StartedAt,
                Source = "stored",
            });
        }

        var storedIds = state.Entries.Select(entry => entry.Id).ToHashSet(StringComparer.Ordinal);
        var detected = (await _deps.DetectAsync().ConfigureAwait(false))
            .Where(found => !storedIds.Contains(found.Id))
            .ToList();

        var active = state.Entries.FirstOrDefault(entry => entry.Id == state.ActiveId);
        return new ServersState
        {
            Entries = entries,
            Detected = detected,
            ActiveId = state.ActiveId,
            ActiveUrl = active?.Url,
        };
    }

    public async Task AddRemoteAsync(string label, string url)
    {
        await _gate.WaitAsync();
        try
        {
            var normalised = ServerAddress.Normalise(url);
            if (_state.Entries.Any(entry => entry.Url == normalised))
            {
                throw new ServerException($"{normalised} is already in the list.");
            }

            var trimmed = (label ?? "").Trim();
            var entries = _state.Entries.ToList();
            entries.Add(new StoredServer
            {
                Id = ServerAddress.Id(ServerKind.Remote, normalised),
                Label = trimmed.Length > 0
                    ? trimmed
                    : normalised.Replace("https://", "").Replace("http://", ""),
                Url = normalised,
                Kind = ServerKind.Remote,
            });
            _state = _state with { Entries = entries };
            Persist();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RemoveAsync(string id)
    {
        await _gate.WaitAsync();
        try
        {
            var entries = _state.Entries.Where(entry => entry.Id != id).ToList();
            if (entries.Count == _state.Entries.Count)
            {
                throw new ServerException("That server is not in the list.");
            }

            var spawned = _state.Spawned
                .Where(pair => pair.Key != id)
                .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
            _state = _state with
            {
                Entries = entries,
                Spawned = spawned,
                ActiveId = _state.ActiveId == id ? null : _state.ActiveId,
            };
            Persist();
        }
        finally
        {
            _gate.Release();
        }
    }

    /**
     * The URL to load for `id`, refusing one that cannot answer.
     *
     * An id that is not in the stored list is looked up among the instances found
     * on this machine and ADOPTED into the list: it was never the shell's to
     * remember, but connecting to it is an explicit choice worth keeping.
     */
    public async Task<string> ActivateAsync(string id)
    {
        await _gate.WaitAsync();
        try
        {
            if (_state.Entries.All(entry => entry.Id != id))
            {
                var found = (await _deps.DetectAsync().ConfigureAwait(false)).FirstOrDefault(entry => entry.Id == id);
                if (found is null) throw new ServerException("That server is not in the list.");
                var entries = _state.Entries.ToList();
                entries.Add(new StoredServer
                {
                    Id = found.Id,
                    Label = found.Label,
                    Url = found.Url,
                    Kind = ServerKind.Managed,
                    Port = found.Port,
                });
                _state = _state with { Entries = entries };
            }

            var entry = _state.Entries.FirstOrDefault(stored => stored.Id == id)
                ?? throw new ServerException("That server is not in the list.");

            if (await _deps.ProbeAsync(entry.Url).ConfigureAwait(false) is not null)
            {
                _state = _state with { ActiveId = id };
                Persist();
                return entry.Url;
            }

            // "Switch to my local server" when it is down means start it. A REMOTE
            // server that is down is refused: there is nothing this shell could start.
            if (entry.Kind == ServerKind.Managed && entry.Port is int port)
            {
                var started = await StartLockedAsync(port, entry.Label).ConfigureAwait(false);
                return started.Url;
            }

            throw new ServerException($"{entry.Label} is not answering. Start it first.");
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Start a local server as this shell's child and select it.</summary>
    public async Task<StartResult> StartAsync(int port, string? label = null)
    {
        await _gate.WaitAsync();
        try
        {
            return await StartLockedAsync(port, label).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Caller holds the gate.</summary>
    private async Task<StartResult> StartLockedAsync(int port, string? label)
    {
        var started = await _deps.StartAsync(port).ConfigureAwait(false);
        var entries = _state.Entries.ToList();
        var index = entries.FindIndex(entry => entry.Id == started.Id);
        if (index >= 0)
        {
            entries[index] = entries[index] with { Url = started.Url, Port = port };
            if (label is not null) entries[index] = entries[index] with { Label = label };
        }
        else
        {
            entries.Add(new StoredServer
            {
                Id = started.Id,
                Label = label ?? $"Local :{port}",
                Url = started.Url,
                Kind = ServerKind.Managed,
                Port = port,
            });
        }

        // Only a pid this shell spawned is recorded, so a later launch adopts
        // exactly its own orphans and never a server the user started by hand.
        var spawned = new Dictionary<string, int>(_state.Spawned, StringComparer.Ordinal);
        if (started.Pid is int pid) spawned[started.Id] = pid;
        else spawned.Remove(started.Id);

        _state = _state with { Entries = entries, Spawned = spawned, ActiveId = started.Id };
        Persist();
        return started;
    }

    public async Task StopAsync(string id)
    {
        await _gate.WaitAsync();
        try
        {
            await _deps.StopAsync(id).ConfigureAwait(false);
            var spawned = _state.Spawned
                .Where(pair => pair.Key != id)
                .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
            _state = _state with { Spawned = spawned };
            Persist();
        }
        finally
        {
            _gate.Release();
        }
    }

    /**
     * Adopt the servers a PREVIOUS run of this shell spawned and left running.
     *
     * The force-quit case: the window died without stopping its children, so they
     * still answer. The pids come from this shell's own persisted list, never from
     * discovery — a hand-started server answers on a port and appears in the same
     * records, and taking it over would offer a Stop for a process somebody else
     * is watching.
     */
    public async Task<IReadOnlyDictionary<string, int>> OrphanedPidsAsync()
    {
        var detected = await _deps.DetectAsync().ConfigureAwait(false);
        var found = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (id, pid) in _state.Spawned)
        {
            if (detected.Any(entry => entry.Id == id)) found[id] = pid;
        }
        return found;
    }
}
