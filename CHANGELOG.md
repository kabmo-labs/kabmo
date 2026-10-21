# Changelog

All notable changes to Kabmo.

Kabmo starts at `0.0.1`. The pre-rename history (OMPChamber 0.x-4.x) is kept in [CHANGELOG-legacy.md](./CHANGELOG-legacy.md).

## [0.5.0](https://github.com/kabmo-labs/kabmo/compare/v0.4.0...v0.5.0) — 2026-10-21

### Added

* **mobile:** give the phone a left dock with a chip strip ([7dfd658](https://github.com/kabmo-labs/kabmo/commit/7dfd6589d2711ac72610f9f0999113911a72774b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **release:** give the Android shell its own release channel ([2bc7b11](https://github.com/kabmo-labs/kabmo/commit/2bc7b110a451389bd2aeae6ce28cb5697bf09c87)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **android:** sign every release with one keystore and install updates in-app ([88e01d1](https://github.com/kabmo-labs/kabmo/commit/88e01d1090cea12b6e324ee9ff44374e9872ce5b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ci:** grant the APK build the ceiling its body declares ([4fecbf4](https://github.com/kabmo-labs/kabmo/commit/4fecbf4c86eb719c51f3df4fc19a0531d92feb5d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** let the model label use the room it has ([3028778](https://github.com/kabmo-labs/kabmo/commit/3028778b5e40b8ade7cb2bd00f6a7222e94ee5e6)) (thanks [@rajebdev](https://github.com/rajebdev))
* **layout:** reserve the PWA window controls on the correct edge ([c0de76b](https://github.com/kabmo-labs/kabmo/commit/c0de76b8e80a7aa9c494ce13bb3af9aef019dd95)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** name the run spinner so the wait picker can be gated ([cb542d5](https://github.com/kabmo-labs/kabmo/commit/cb542d5958c849a7dde1fa1ae2afa19faa6b3604)) (thanks [@rajebdev](https://github.com/rajebdev))

### Removed

* drop the Android shell's separate release channel ([11a1185](https://github.com/kabmo-labs/kabmo/commit/11a11856c2a786d21031271e105ecee5076c930a)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.4.0](https://github.com/kabmo-labs/kabmo/compare/v0.3.1...v0.4.0) — 2026-10-21

### Added

* **android:** draw the README wordmark on the launch overlay ([3eaed86](https://github.com/kabmo-labs/kabmo/commit/3eaed86d6437f0e461dbd75ec9736bf958b444bf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** hold a new chat's prompt until another session finishes ([5e7922e](https://github.com/kabmo-labs/kabmo/commit/5e7922e4a7e3dd64c6d566fca78c0201d9968587)) (thanks [@rajebdev](https://github.com/rajebdev))
* **panels:** make the left column a dock with an optional plugin rail ([eb9348b](https://github.com/kabmo-labs/kabmo/commit/eb9348b8404dd4f06f15566d999aee2fb157d10c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **panels:** reach the editor slot, and place each panel instance ([32862cf](https://github.com/kabmo-labs/kabmo/commit/32862cf315b24bb3654c7aa93b15db80ddf52368)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **server:** compress the production bundle, the shell and the font sheet ([d1fb9fe](https://github.com/kabmo-labs/kabmo/commit/d1fb9fe219b342197beb291ac8c4e304c7677e66)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **android:** show the launch overlay when the console reloads itself ([1460a4a](https://github.com/kabmo-labs/kabmo/commit/1460a4a35b689c1da33ff40c354b103279a896bf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ci:** repair the three failures on the main pipeline ([916f9cc](https://github.com/kabmo-labs/kabmo/commit/916f9cccc6c39048eba8d9dad85a67164000d297)) (thanks [@rajebdev](https://github.com/rajebdev))
* **db:** close a handle whose open was retired mid-flight ([4ce4e33](https://github.com/kabmo-labs/kabmo/commit/4ce4e337030d5cea9903825e6beae49412fe9007)) (thanks [@rajebdev](https://github.com/rajebdev))
* **mobile:** align drawer columns, transcript gutter and compact composer ([64cda9f](https://github.com/kabmo-labs/kabmo/commit/64cda9f3f9b2d627f9df9d5f57b22e7388806d96)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.3.1](https://github.com/kabmo-labs/kabmo/compare/v0.3.0...v0.3.1) — 2026-10-21

### Fixed

* **android:** read the shell version through the tested reader, not a broken sed ([0f4c70e](https://github.com/kabmo-labs/kabmo/commit/0f4c70e561c865c0cc63118ca27d2199e585c130)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.3.0](https://github.com/kabmo-labs/kabmo/compare/v0.2.0...v0.3.0) — 2026-10-21

### Added

* **android:** show a progress overlay from launch until the console paints ([a8fa459](https://github.com/kabmo-labs/kabmo/commit/a8fa45903e62126503a4c0bace74b9b305be581d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **android:** version the shell from its own file, bumped by the release ([6d64752](https://github.com/kabmo-labs/kabmo/commit/6d64752e537e99e4542aa900c75f3257938a6393)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** offer the APK to an Android browser, not only to the app ([0da4700](https://github.com/kabmo-labs/kabmo/commit/0da4700ad4474dbbaf8adc421bb5da2bf282c7c5)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* record the shell version bump and the two APK offers ([251692c](https://github.com/kabmo-labs/kabmo/commit/251692c337c3c8c68f85227ca5044dd717efc1b0)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **android:** keep the session across a zoom change and a restart ([8810628](https://github.com/kabmo-labs/kabmo/commit/88106283303a0bdd060a1746e549f40663c306bf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **android:** make the page-zoom slider scale the page it names ([5e14428](https://github.com/kabmo-labs/kabmo/commit/5e14428fd6376ba920395f522b5d3cb52ed0204d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **updates:** find the APK by scanning releases, not by asking for the latest ([602229b](https://github.com/kabmo-labs/kabmo/commit/602229bdbbc3d8cd99cf44d752138bcdb4975021)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.2.0](https://github.com/kabmo-labs/kabmo/compare/v0.1.0...v0.2.0) — 2026-10-20

### Added

* **android:** add the Kotlin WebView shell and its APK release job ([c2c355c](https://github.com/kabmo-labs/kabmo/commit/c2c355c8aa53d04cf7e807121aaadd1c5ddc6bf3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **android:** let the hardware back button close what the page owns ([43ebe4a](https://github.com/kabmo-labs/kabmo/commit/43ebe4a5e9eb5749fae93dc372ffe85a03624289)) (thanks [@rajebdev](https://github.com/rajebdev))
* **android:** offer the APK download in the sidebar when a newer one exists ([678058b](https://github.com/kabmo-labs/kabmo/commit/678058bec157d82e4e2fd1f785dec846740b4c03)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** frame the chat composer like a tool render card ([6e002b1](https://github.com/kabmo-labs/kabmo/commit/6e002b11ee8672860e6f41cb7e40d8680b81ba67)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** one surface for the composer, and shrink it while a phone reads ([a9fc6c8](https://github.com/kabmo-labs/kabmo/commit/a9fc6c803a9291db21c36de9aa3d861a551e3b39)) (thanks [@rajebdev](https://github.com/rajebdev))
* **mobile:** fold the phone header's rare controls by width, not by device ([54c8733](https://github.com/kabmo-labs/kabmo/commit/54c87335cf8023b057fdc477a33d506d98d521a7)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **android:** record the shell's contracts and their measured traps ([fc36444](https://github.com/kabmo-labs/kabmo/commit/fc3644464e19970bc9c0c9f91baffa505ff81bfb)) (thanks [@rajebdev](https://github.com/rajebdev))
* **packages:** document the plugin SDK and UI kit ([cf97e0e](https://github.com/kabmo-labs/kabmo/commit/cf97e0e6f481f4fb03d0b98db58151e0669fc1de)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** render a cardless ask inline instead of an empty modal ([92b6dbf](https://github.com/kabmo-labs/kabmo/commit/92b6dbf3caa798bb29baf676a96bdd121c722600)) (thanks [@rajebdev](https://github.com/rajebdev))
* **files:** list every directory entry instead of filtering by name ([5f24301](https://github.com/kabmo-labs/kabmo/commit/5f24301b5b1eaa54c94256c253ec1b44cb2095f8)) (thanks [@rajebdev](https://github.com/rajebdev))
* **fs:** spell listing paths POSIX, and isolate the batch-delete suite ([ac325dd](https://github.com/kabmo-labs/kabmo/commit/ac325dd6d9eb380304835f775d44660f814c3ed4)) (thanks [@rajebdev](https://github.com/rajebdev))
* **git:** reconcile a diverged branch on Sync instead of refusing ([47a70b5](https://github.com/kabmo-labs/kabmo/commit/47a70b59bbc90604621d410bf6415486022a15bf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **layout:** keep a new chat's opened right panels across its first send ([1106756](https://github.com/kabmo-labs/kabmo/commit/11067564688be45db31b293cee639466d8d91bee)) (thanks [@rajebdev](https://github.com/rajebdev))
* **mobile:** stop the session title colliding with the header controls ([b5ae61b](https://github.com/kabmo-labs/kabmo/commit/b5ae61be94814d13eee2075b62903c713edbd7fa)) (thanks [@rajebdev](https://github.com/rajebdev))
* **search:** keep an already-open file on screen and clear the search fields ([15a8326](https://github.com/kabmo-labs/kabmo/commit/15a8326bae4b9d4e6c533d9eefe472203a056e73)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** move the phone toolbar's overflow into a ⋯ menu ([f1e238d](https://github.com/kabmo-labs/kabmo/commit/f1e238d10c106bad257cbcaf3167cbcc7559bcc9)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.1.0](https://github.com/kabmo-labs/kabmo/compare/v0.0.1...v0.1.0) — 2026-10-20

### Added

* **auth:** add a password visibility toggle to the login form ([b62461a](https://github.com/kabmo-labs/kabmo/commit/b62461ab36b44eb67804476a97913d8f2c1e2924)) (thanks [@rajebdev](https://github.com/rajebdev))
* **auth:** make the wordmark the login screen's only header mark ([a4a1a62](https://github.com/kabmo-labs/kabmo/commit/a4a1a62dd573e10eed333aa1f685f244d70ee8ab)) (thanks [@rajebdev](https://github.com/rajebdev))
* **brand:** draw the wordmark's K from the app icon and ship a standalone SVG ([0fd99d9](https://github.com/kabmo-labs/kabmo/commit/0fd99d9d14314936f9054140c6d838c771410df5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** batch select and delete workspaces or sessions ([bbbd5fd](https://github.com/kabmo-labs/kabmo/commit/bbbd5fda6458021a1b52d7d8423b5f5608ae840f)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **readme:** regenerate every capture and make it reproducible ([403fb3c](https://github.com/kabmo-labs/kabmo/commit/403fb3c4bde1bc8f5def02e7ca4b2b6f42543e1b)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **updates:** restart the copy the update installed ([e58fc6d](https://github.com/kabmo-labs/kabmo/commit/e58fc6d257594c1dc58cecd3304a65adbb2d2c1e)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.0.1] — 2026-10-20

Renamed the product from OMPChamber to Kabmo — the package name, release tags,
CLI command, environment variables and settings key all follow the new name.
