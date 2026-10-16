# @ompchamber/ui

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0](https://github.com/rajebdev/ompchamber/compare/ui/v2.2.1...ui/v2.3.0) — 2026-10-16

### Added

* **marketplace:** add the command-runner plugin with 14 toolchains and custom commands ([665b8fc](https://github.com/rajebdev/ompchamber/commit/665b8fcdc10d015f84006f3869472d3393ec743b))

### Changed

* **scrollbars:** fade every bar from one listener, unify size and colour ([79c4a51](https://github.com/rajebdev/ompchamber/commit/79c4a51e56a24e328382b93936bd0607b9e7edc6)), closes [#141310](https://github.com/rajebdev/ompchamber/issues/141310) [#EDECEE](https://github.com/rajebdev/ompchamber/issues/EDECEE)

## [2.2.1](https://github.com/rajebdev/ompchamber/compare/ui/v2.2.0...ui/v2.2.1) — 2026-10-12

### Fixed

* **panels:** scope a plugin's stylesheet to its own DOM ([bfd7f98](https://github.com/rajebdev/ompchamber/commit/bfd7f983956c3cedd932f56728df5ac8cd957578)), closes [session-info#1](https://github.com/rajebdev/session-info/issues/1)

## [2.2.0](https://github.com/rajebdev/ompchamber/compare/ui/v2.1.1...ui/v2.2.0) — 2026-10-11

### Added

* **plugins:** let a plugin act on the conversation, not only draw beside it ([751a304](https://github.com/rajebdev/ompchamber/commit/751a30411495317831a2b54b8d855d6665f1db77))
* **plugins:** let a plugin read the sidebar and act on a session ([6171a37](https://github.com/rajebdev/ompchamber/commit/6171a37160bb65017086da8d10d4161b4a9add6b))

## [2.1.1](https://github.com/rajebdev/ompchamber/compare/ui/v2.1.0...ui/v2.1.1) — 2026-10-07

### Changed

* correct the polling claims the realtime cutover left behind ([ac5afa0](https://github.com/rajebdev/ompchamber/commit/ac5afa0d9fd93e608ba0c24783e1dbd2c3a8e7bb))

### Fixed

* **search:** virtualize results, cap the run, and stop scroll from re-rendering ([e63f130](https://github.com/rajebdev/ompchamber/commit/e63f130a782a051b6b6524cf669fae35f28efafa))

## [2.1.0](https://github.com/rajebdev/ompchamber/compare/ui/v2.0.1...ui/v2.1.0) — 2026-10-06

### Added

* **ui:** give panels a fetch reader, a host scope and a markdown passthrough ([6e59def](https://github.com/rajebdev/ompchamber/commit/6e59defa3f6d976d86849e810243cecdfa27adc8))

## [2.0.1](https://github.com/rajebdev/ompchamber/compare/ui/v2.0.0...ui/v2.0.1) — 2026-10-05

### Fixed

* **ui:** let useSessionValue follow writes from other components ([de33442](https://github.com/rajebdev/ompchamber/commit/de33442f357bd6381c97af4b0758b647d5a0410a))

## [2.0.0](https://github.com/rajebdev/ompchamber/compare/ui/v1.0.0...ui/v2.0.0) — 2026-10-05

### BREAKING CHANGES

* **panels:** panel plugins must be rewritten. A plugin is now a package with
an `app` bundle exporting `definePluginApp`, not a directory of HTML documents;
the `panels` and `capabilities` manifest fields are gone, and `editorPanel` is
replaced by `panel`. Sandboxed panels are no longer supported.

### Added

* **panels:** run plugins in-process as Preact components, not sandboxed frames ([5018640](https://github.com/rajebdev/ompchamber/commit/50186400e5728192b6d977fdcc1b58e160f466de))
