# @kabmo-labs/plugin-sdk

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.3](https://github.com/rajebdev/ompchamber/compare/plugin-sdk/v2.1.2...plugin-sdk/v2.1.3) — 2026-10-18

### Fixed

* **plugins:** apply bundled plugin fixes on the boot that installs them ([ccf45ea](https://github.com/rajebdev/ompchamber/commit/ccf45eac8deaf4d9220071be60636cafe4201ce7))

## [2.1.2](https://github.com/rajebdev/ompchamber/compare/plugin-sdk/v2.1.1...plugin-sdk/v2.1.2) — 2026-10-16

### Fixed

* **plugins:** stop the chamber's own env reaching a project command ([fe54637](https://github.com/rajebdev/ompchamber/commit/fe54637c605040264bc01d27b0fc450de7e15b86))

## [2.1.1](https://github.com/rajebdev/ompchamber/compare/plugin-sdk/v2.1.0...plugin-sdk/v2.1.1) — 2026-10-12

### Fixed

* **panels:** scope a plugin's stylesheet to its own DOM ([bfd7f98](https://github.com/rajebdev/ompchamber/commit/bfd7f983956c3cedd932f56728df5ac8cd957578)), closes [session-info#1](https://github.com/rajebdev/session-info/issues/1)

## [2.1.0](https://github.com/rajebdev/ompchamber/compare/plugin-sdk/v2.0.0...plugin-sdk/v2.1.0) — 2026-10-11

### Added

* **plugins:** add a plugin platform — server half, list slots, harness, CLI ([8ea446f](https://github.com/rajebdev/ompchamber/commit/8ea446f4d589a291e668555e709cc19ae26ad6c9))
* **plugins:** let a plugin act on the conversation, not only draw beside it ([751a304](https://github.com/rajebdev/ompchamber/commit/751a30411495317831a2b54b8d855d6665f1db77))
* **plugins:** let a plugin read the sidebar and act on a session ([6171a37](https://github.com/rajebdev/ompchamber/commit/6171a37160bb65017086da8d10d4161b4a9add6b))
* **plugins:** mark the unstable surfaces experimental_ ([5f8d300](https://github.com/rajebdev/ompchamber/commit/5f8d30092a59641a730854d195c8b16d8606d7f0))

## [2.0.0](https://github.com/rajebdev/ompchamber/compare/plugin-sdk/v1.0.0...plugin-sdk/v2.0.0) — 2026-10-05

### BREAKING CHANGES

* **panels:** panel plugins must be rewritten. A plugin is now a package with
an `app` bundle exporting `definePluginApp`, not a directory of HTML documents;
the `panels` and `capabilities` manifest fields are gone, and `editorPanel` is
replaced by `panel`. Sandboxed panels are no longer supported.

### Added

* **panels:** run plugins in-process as Preact components, not sandboxed frames ([5018640](https://github.com/rajebdev/ompchamber/commit/50186400e5728192b6d977fdcc1b58e160f466de))
