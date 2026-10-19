# Session Info

The example panel plugin bundled with Kabmo, and the reference for the
plugin API.

## What it adds

| Slot | What you get |
|---|---|
| `rightPanel` | **Session Info** — the active workspace, the session id and a note kept per session. |
| `headerPanel` | **Session Stats** — a text readout in the navbar (`s3f2 · 120 ch`) that opens a dropdown. |
| `panel` | **Scratchpad** — a second text area, taking over the editor column. |

## What it reads

- `usePanelInfo()` — the session, the workspace and the live palette.
- `useSessionValue('note')` — a value stored per session, debounced on write.

## Notes

Nothing here leaves your machine. The note is written to the session's own state
in Kabmo's database, and the plugin's bundle is served from the plugin
directory it was installed into.
