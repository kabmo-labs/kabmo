# Kabmo notification chimes

Two files, and they are the ONLY copies:

- `kabmo_notification.wav` — a run finished, or failed.
- `kabmo_attention.wav` — the agent is blocked on you (a question or an approval).

A **native** notification plays them; the browser/PWA keeps synthesizing both
with Web Audio, because a tab cannot hand a sound to the OS (and would double it
if it did).

One name everywhere: Android resource names allow only `[a-z0-9_]`, and the other
bundles take the name as-is, so everything references those two strings.

## Why the Apple bundles version the file name

`UNNotificationSound(named:)` caches a **failed** lookup by name: a name that was
ever missing stays missing even after the file is added, and the platform plays
its own tone instead. The macOS and iOS bundle scripts therefore copy the files
as `kabmo_notification-<version>.wav` / `kabmo_attention-<version>.wav`, and the
runtime builds the same string from `CFBundleShortVersionString`. Every release
is a fresh lookup, and the two sides cannot drift because the version is the one
the bundle already declares. Android and Linux keep the fixed names: their sound
is bound to a channel or a path, not to a cached lookup.

## Why the files exist instead of being generated per platform

|Platform|API|What it takes|
|---|---|---|
|Android|`NotificationChannel.setSound`|a `res/raw` resource URI (one channel per sound)|
|iOS / macOS|`UNNotificationSound(named:)`|a file in the app bundle|
|Linux|`notify-send --hint=string:sound-file:` (or a local player when `GetCapabilities` has no `sound`)|a path the daemon can read|
|Windows|`Shell_NotifyIcon` with `NIIF_NOSOUND`, then `PlaySound`|an embedded WAV written to `%TEMP%`|

`generate.mjs` renders both envelopes from the same numbers as
`src/client/hooks/ui/notification-sound.ts`
(`bun assets/notification-sound/generate.mjs`). Each render is normalized once
to -2.5 dBFS: the raw Web Audio envelopes peak at -17 and -14 dBFS, which is
right for a cue mixed against nothing and inaudible as a system banner.

Nothing copies these files into a source tree — the Android Gradle build, the
iOS/macOS bundle scripts, the Linux binary (`include_bytes!`) and the Windows
build all read this directory.
