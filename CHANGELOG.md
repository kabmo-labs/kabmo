# Changelog

All notable changes to OMPChamber are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.10.0](https://github.com/rajebdev/ompchamber/compare/v4.9.1...v4.10.0) — 2026-10-11

### Added

* **plugins:** add a plugin platform — server half, list slots, harness, CLI ([8ea446f](https://github.com/rajebdev/ompchamber/commit/8ea446f4d589a291e668555e709cc19ae26ad6c9))
* **plugins:** let a plugin act on the conversation, not only draw beside it ([751a304](https://github.com/rajebdev/ompchamber/commit/751a30411495317831a2b54b8d855d6665f1db77))
* **plugins:** let a plugin answer the agent's own questions ([c83e963](https://github.com/rajebdev/ompchamber/commit/c83e9636add788c75d88e048efb172108ec8c75c))
* **plugins:** let a plugin claim a fenced block in a message ([f0db376](https://github.com/rajebdev/ompchamber/commit/f0db3768336026417683d8ddb67e999353351416))
* **plugins:** let a plugin read the sidebar and act on a session ([6171a37](https://github.com/rajebdev/ompchamber/commit/6171a37160bb65017086da8d10d4161b4a9add6b))
* **plugins:** let a plugin run code against the app shell ([1ba0047](https://github.com/rajebdev/ompchamber/commit/1ba0047407bdc67bd70baee0ee7d963a9a8bbd7e))
* **plugins:** let a plugin supply a provider's mark ([e759bc9](https://github.com/rajebdev/ompchamber/commit/e759bc9b871c31bbd0990a5c0414c7d7a1ccd0f6))
* **plugins:** load a plugin's declared stylesheet with its content script ([d2fd738](https://github.com/rajebdev/ompchamber/commit/d2fd738d980ed8e7d2fec511b54ae49e3fc279f1))
* **plugins:** mark the unstable surfaces experimental_ ([5f8d300](https://github.com/rajebdev/ompchamber/commit/5f8d30092a59641a730854d195c8b16d8606d7f0))

### Changed

* **contributing:** warn that the skip marker matches anywhere in a message ([88e2bed](https://github.com/rajebdev/ompchamber/commit/88e2bed4e94474a0306707dfcb6bedfe56b4de39))
* **plugins:** document the stylesheet, the sidebar and the stability policy ([4916029](https://github.com/rajebdev/ompchamber/commit/4916029e1a1d869bd77f3a093159983c303939e9))
* **plugins:** record wave 2's surfaces and the two decisions behind them ([411656a](https://github.com/rajebdev/ompchamber/commit/411656a36fb1eb2a764d767ed4046d701d867751))

## [4.9.1](https://github.com/rajebdev/ompchamber/compare/v4.9.0...v4.9.1) — 2026-10-08

### Fixed

* **db:** honor the DB path override in mock mode ([2e1fa62](https://github.com/rajebdev/ompchamber/commit/2e1fa623a87e0b60b640e06b3354c6167e2a8962))
* **ui:** give the sidebar footer and composer Send an accessible name ([728b83f](https://github.com/rajebdev/ompchamber/commit/728b83f1cd2b1ef2010c7a262f2dca8527dc29a5))

## [4.9.0](https://github.com/rajebdev/ompchamber/compare/v4.8.0...v4.9.0) — 2026-10-08

### Added

* **chat:** remove the tool group title from the timeline ([9dc4825](https://github.com/rajebdev/ompchamber/commit/9dc4825a2de173b9123d10473192261108c5cfba))

### Changed

* **chat:** drop the tool section's group heading and bulk control ([c64aeca](https://github.com/rajebdev/ompchamber/commit/c64aeca95d2e301156c76d2ecf29f646c0e09323))

### Fixed

* **chat:** keep streamed fragments on one row without a message seed ([cf2d1f6](https://github.com/rajebdev/ompchamber/commit/cf2d1f6913b9c6551c57d73e0e4b369315773c89))
* **chat:** stop a collapsed edit card quoting its own excerpt header ([32111a7](https://github.com/rajebdev/ompchamber/commit/32111a7e56c9653d325592fc31c3444ebf5a3c3a)), closes [path#TAG](https://github.com/rajebdev/path/issues/TAG)
* **layout:** cap the editor and right panel as one coupled pair ([9d361a9](https://github.com/rajebdev/ompchamber/commit/9d361a9405fec2d7cf420052859445fa4d9f9265))

## [4.8.0](https://github.com/rajebdev/ompchamber/compare/v4.7.2...v4.8.0) — 2026-10-08

### Added

* **chat:** render the full-output reader by artifact type ([e99234f](https://github.com/rajebdev/ompchamber/commit/e99234f3b273cf5c57069b38e54a3d83d29118ce))
* **layout:** add navbar reload button and gate the layout switch to dev ([757866f](https://github.com/rajebdev/ompchamber/commit/757866fe172a7d16fb7e3c761553a0280b4bf8b6))
* **omp:** adopt 18.8.3 RPC surface and fix the drift it exposed ([9f8e2e3](https://github.com/rajebdev/ompchamber/commit/9f8e2e3dbf65494bd71fcadcf7d1e3101a50e26a))

### Fixed

* **chat:** dispatch an internal-URL tool call by its device ([edca9f9](https://github.com/rajebdev/ompchamber/commit/edca9f9dc329a794fb3ec101c51734bfb58434f6))
* **chat:** head each tool card with its own intent ([c009cff](https://github.com/rajebdev/ompchamber/commit/c009cff94a2fe51bd114b647f3902c6d9e5b4946))
* **chat:** let a long tool diff scroll inside its height ceiling ([23b372d](https://github.com/rajebdev/ompchamber/commit/23b372ddbbdd713273bf7a88f43816919c2b01d4))
* **chat:** let a tool card's heading rule run to the panel edge ([6a05b3b](https://github.com/rajebdev/ompchamber/commit/6a05b3b789c09757811df45fb38883c00f8181fa))
* **fs:** show the file diff for dot-paths and hostile filenames ([9c6cf38](https://github.com/rajebdev/ompchamber/commit/9c6cf3828b6ca57d75b39961c3293cb408cf16fd))
* **git-panel:** make every Source Control action do what its button says ([e07edaf](https://github.com/rajebdev/ompchamber/commit/e07edaff15739d81c5ab4ae61c451a21d068f707))
* **provider-icon:** paint provider marks in the surrounding ink ([e77863b](https://github.com/rajebdev/ompchamber/commit/e77863b5b91d1b9e8248217145f40cedefd4b70d)), closes [#141310](https://github.com/rajebdev/ompchamber/issues/141310)
* **realtime:** rebind a session topic when its omp child is replaced ([965e2ac](https://github.com/rajebdev/ompchamber/commit/965e2acd14ce8d960d6028d8e0d2dd39fea6f0c9))

## [4.7.2](https://github.com/rajebdev/ompchamber/compare/v4.7.1...v4.7.2) — 2026-10-08

### Fixed

* **chat:** colour an edit's +/− green and red, with no chip background ([c6fd543](https://github.com/rajebdev/ompchamber/commit/c6fd543a4b9b7b6131f3375f958dc9a01f4f9f92))
* **chat:** give a tool card one meta line, and drop it on expand ([ca8e19c](https://github.com/rajebdev/ompchamber/commit/ca8e19c346e319bfb4122b46206efc84761d2e0b))
* **chat:** keep a tool card's meta row to facts, and eval to its title ([b23a611](https://github.com/rajebdev/ompchamber/commit/b23a611fa4f29caad0f73281a15298a84fa569ad))

## [4.7.1](https://github.com/rajebdev/ompchamber/compare/v4.7.0...v4.7.1) — 2026-10-07

### Fixed

* **chat:** clamp a tool section's title to one line ([209eadd](https://github.com/rajebdev/ompchamber/commit/209eadd89e645ce7f076ca7e534facf99ef84e52))

## [4.7.0](https://github.com/rajebdev/ompchamber/compare/v4.6.0...v4.7.0) — 2026-10-07

### Added

* **chat:** state a tool result's outcome while its card is collapsed ([5fd47bc](https://github.com/rajebdev/ompchamber/commit/5fd47bc99ced47dd094f7935baf0680ef5d315a5))
* **search:** jump to a hit in the editor with in-file highlighting and a replace preview ([d8a804a](https://github.com/rajebdev/ompchamber/commit/d8a804a00ab2ecc6b35b06da01877fd4b3039033))

### Changed

* **omp:** split the terminal run settle out of the frame fold ([060220a](https://github.com/rajebdev/ompchamber/commit/060220a4428686f5e2d717ec7bccde3938a09688))

### Fixed

* **chat:** keep a retried ask dialog answerable ([c5e80f6](https://github.com/rajebdev/ompchamber/commit/c5e80f686b1533fd7ca742015a29dfe844d95c1f))
* **chat:** stop the mention rewrite from reflowing the whole body ([333c88d](https://github.com/rajebdev/ompchamber/commit/333c88d1d01fd06891522a702f4f4492a6ec6f6a))
* **search:** virtualize results, cap the run, and stop scroll from re-rendering ([e63f130](https://github.com/rajebdev/ompchamber/commit/e63f130a782a051b6b6524cf669fae35f28efafa))

## [4.6.0](https://github.com/rajebdev/ompchamber/compare/v4.5.0...v4.6.0) — 2026-10-07

### Added

* refresh session-data panels on every tool call ([0c49b17](https://github.com/rajebdev/ompchamber/commit/0c49b17f0b383096ab347d54d6314be83c72a0dd))

### Fixed

* **chat-timeline:** name the wait while the generating indicator has no identity ([a15e40e](https://github.com/rajebdev/ompchamber/commit/a15e40e2d2b2d7ebd776c8a30c45f9e8209a3b67))
* **chat:** load history when opening a session that is already streaming ([57d4680](https://github.com/rajebdev/ompchamber/commit/57d46804bbb42fbe821871e2b2858ce0dc3545e9))
* **files:** re-read open folders on refresh and stop re-fetching empty ones ([f88aeca](https://github.com/rajebdev/ompchamber/commit/f88aeca2e3986a2f6292c0858b8a90f4628affb4))
* **workspace:** refresh panel data and indicators on realtime pushes ([1081071](https://github.com/rajebdev/ompchamber/commit/10810715b9c5e5249fc33a4c69ddc034933872b7))

## [4.5.0](https://github.com/rajebdev/ompchamber/compare/v4.4.1...v4.5.0) — 2026-10-07

### Added

* republish watched git/fs topics on tool_execution_end ([025293e](https://github.com/rajebdev/ompchamber/commit/025293e437b30ae14461c38264f5616db513bc24))

### Changed

* **chat:** remove the dead steering queue and follow-up RPC ([abce54c](https://github.com/rajebdev/ompchamber/commit/abce54ceb40b4867a49cb53a6b8f3117ba17e7ba))
* document the per-tool-call panel refresh in AGENTS.md ([b0ac947](https://github.com/rajebdev/ompchamber/commit/b0ac9479c1c68f4e0849cc96a317ccb9c5fa6cc6))

### Fixed

* **chat:** arm the auto-title window before /rename, not after its ack ([3280ea4](https://github.com/rajebdev/ompchamber/commit/3280ea44bfeb325f75a683a130c459f71c4b098e))
* **chat:** attach a new session's first prompt to its own run and timeline ([ff1c0e9](https://github.com/rajebdev/ompchamber/commit/ff1c0e951d57a723a0997a0ce588d6e999c4b232))
* **chat:** stop a steer from hanging on a pending approval dialog ([93b40c4](https://github.com/rajebdev/ompchamber/commit/93b40c4ecfc640a115bd3ac99126547654f30fd7))
* **sessions:** answer /modes from the live child before its transcript exists ([ac05255](https://github.com/rajebdev/ompchamber/commit/ac052554350e19eb6c93ca7235033df877d7660e))

## [4.4.1](https://github.com/rajebdev/ompchamber/compare/v4.4.0...v4.4.1) — 2026-10-07

### Fixed

* **usage:** align the usage topic with the report both surfaces render ([1f91cf8](https://github.com/rajebdev/ompchamber/commit/1f91cf8781f242844772688369b0089ce911efcb))

## [4.4.0](https://github.com/rajebdev/ompchamber/compare/v4.3.2...v4.4.0) — 2026-10-07

### Added

* **nav:** make the navbar session menu act on the session ([24abc07](https://github.com/rajebdev/ompchamber/commit/24abc07b3fb56a035ee2def1a96b0b2c63b2f700))
* **realtime:** route every server-originated event through one hub ([2761390](https://github.com/rajebdev/ompchamber/commit/276139087d21b567d4920e3020a70a484c554e8b))

### Changed

* correct the polling claims the realtime cutover left behind ([ac5afa0](https://github.com/rajebdev/ompchamber/commit/ac5afa0d9fd93e608ba0c24783e1dbd2c3a8e7bb))
* **omp:** drop the /api/omp routes the realtime cutover left without callers ([4ffe959](https://github.com/rajebdev/ompchamber/commit/4ffe9599a012f0ea8817e57e74f2d4e7bfe66229))
* **realtime:** record the four phases and their decisions ([d8c289b](https://github.com/rajebdev/ompchamber/commit/d8c289b585ff0520753b28ae106dcdd2fb8248e8))

### Fixed

* **chat:** never resume the generating UI from a `busy` probe ([bed107f](https://github.com/rajebdev/ompchamber/commit/bed107fcc7e07b5629561ae5288b995163130710))
* **chat:** stop a chamber-mode dispatch from settling a running turn ([39767a4](https://github.com/rajebdev/ompchamber/commit/39767a416c78ffeee2c53fa2e24a6b4c60571651))
* **editor:** render markdown source when the preview toggle is off ([b599f4f](https://github.com/rajebdev/ompchamber/commit/b599f4fd2754c607d1c33c9d5c4dc0522ae5a004))
* **realtime:** publish the session data topics and drop the dead ones ([180446d](https://github.com/rajebdev/ompchamber/commit/180446d656a4e51ce346a131cbe7ac574a48f80f))
* **realtime:** relay a peer-owned session over the unified socket ([f18bfe2](https://github.com/rajebdev/ompchamber/commit/f18bfe2f7e938c6da5f228dded987001d5f55cba))
* **realtime:** serve the MOCK todo/plan demo from the topic resolvers ([bfabf44](https://github.com/rajebdev/ompchamber/commit/bfabf444e9d96526675e5fbb44b6390f6c692c1a))
* **ui:** stop inline rename from committing twice on Enter ([b8ff23a](https://github.com/rajebdev/ompchamber/commit/b8ff23a0e4784c51db18fea8972c4b904d4fb7c0))

## [4.3.2](https://github.com/rajebdev/ompchamber/compare/v4.3.1...v4.3.2) — 2026-10-06

### Fixed

* **updates:** resolve the package root by walking up, not by depth ([cbde609](https://github.com/rajebdev/ompchamber/commit/cbde609c66ff3c7ba8f0c0291f653dba62643575))

## [4.3.1](https://github.com/rajebdev/ompchamber/compare/v4.3.0...v4.3.1) — 2026-10-06

### Fixed

* **theme:** paint the PWA window chrome the top bar's color ([d95f5b8](https://github.com/rajebdev/ompchamber/commit/d95f5b8f46655866d72f57912e640e55abbffd60))

## [4.3.0](https://github.com/rajebdev/ompchamber/compare/v4.2.1...v4.3.0) — 2026-10-06

### Added

* **chat:** name an omp provider retry in the timeline ([d3b8718](https://github.com/rajebdev/ompchamber/commit/d3b87189b646584ceb719e4a4b6f6f6def54cf04))
* **cli:** run the production build by default and build it on demand ([3e442ed](https://github.com/rajebdev/ompchamber/commit/3e442ed7a798943bb00444209892d7f74b54a3f1))
* **git:** expand the full commit message from a history row ([ec107ac](https://github.com/rajebdev/ompchamber/commit/ec107ace87fd7e0309679b6e97a7e47bbc0c7e35))
* **nav:** badge the desktop stream indicator on the wordmark ([160bb84](https://github.com/rajebdev/ompchamber/commit/160bb844299f6ebd04e245e5fcd022a4bfba05d4))
* **nav:** change height into h-9 for same with PWA browser ([b486e5e](https://github.com/rajebdev/ompchamber/commit/b486e5e3d89a590b683ba62572351aba6d1c1955))
* **sidebar:** default session sort to latest session activity ([a10c36e](https://github.com/rajebdev/ompchamber/commit/a10c36e826e1edcbcb0e60d82f139ae1a3cccd8f))
* **ui:** give panels a fetch reader, a host scope and a markdown passthrough ([6e59def](https://github.com/rajebdev/ompchamber/commit/6e59defa3f6d976d86849e810243cecdfa27adc8))

### Changed

* **panels:** make every right-panel view a plugin with one enablement axis ([5b7f4a3](https://github.com/rajebdev/ompchamber/commit/5b7f4a36e68fbb0a40a5623db41b9905d14bca2f))
* record the run settle and the provider-retry phrase ([b64e344](https://github.com/rajebdev/ompchamber/commit/b64e344fd7ef992ae561a5792e0e6dedf8c021db))

### Fixed

* **auth:** keep a session across restarts and off the login screen ([1b33b19](https://github.com/rajebdev/ompchamber/commit/1b33b19ad316df454466c5a3c5df54f9e3f74181))
* **providers:** let "fetch models" replace the model list instead of appending ([ac9ba48](https://github.com/rajebdev/ompchamber/commit/ac9ba48dd3bf21e666f4304bd7a36e071bd03b68))
* **session:** settle a run omp no longer owns ([1f24622](https://github.com/rajebdev/ompchamber/commit/1f24622ca42fbfe193e97298d29e2fd9b42d63aa))

## [4.2.1](https://github.com/rajebdev/ompchamber/compare/v4.2.0...v4.2.1) — 2026-10-05

### Fixed

* **panels:** draw the navbar panel trigger with the plugin mark ([6fb0791](https://github.com/rajebdev/ompchamber/commit/6fb0791e938bf5a325cecaddd479fc637b28e10c))
* **panels:** make a dangling catalog entry clearable from the pane ([e11e3aa](https://github.com/rajebdev/ompchamber/commit/e11e3aacbc53e12666938ee68bf9ab1c5d8daee8))
* **ui:** let useSessionValue follow writes from other components ([de33442](https://github.com/rajebdev/ompchamber/commit/de33442f357bd6381c97af4b0758b647d5a0410a))

## [4.2.0](https://github.com/rajebdev/ompchamber/compare/v4.1.2...v4.2.0) — 2026-10-05

### Added

* **ci:** release the packages and the app in one chained run ([e465215](https://github.com/rajebdev/ompchamber/commit/e465215086fef139fe0b95d8585c74c1dd2ff653))

### Fixed

* **cli:** restart the instances an update actually replaced ([3768524](https://github.com/rajebdev/ompchamber/commit/37685247509b11b10feec7ca381bb887ba7e14cb))
* **server:** report and survive file-descriptor exhaustion ([fff8889](https://github.com/rajebdev/ompchamber/commit/fff8889967687b7c3d53a2dd9da7751d2edbbc14)), closes [bun#40706](https://github.com/rajebdev/bun/issues/40706)
* **session:** judge a stream row by its owner's identity, not liveness alone ([8a64ee6](https://github.com/rajebdev/ompchamber/commit/8a64ee670e0b77cd6b3369113eba3af74b29530e))
* **session:** release the stream row a destroyed wrapper leaves behind ([052eda7](https://github.com/rajebdev/ompchamber/commit/052eda73b321d4d75298d96df423d25c7b92879c))

## [4.1.2](https://github.com/rajebdev/ompchamber/compare/v4.1.1...v4.1.2) — 2026-10-05

### Changed

* **release:** the workspace pin comes from the lock, not the manifest ([646b181](https://github.com/rajebdev/ompchamber/commit/646b181a50a540176efb948659674d0d8fb8d3da))

### Fixed

* **ci:** give each release workflow its own concurrency group ([0ba215e](https://github.com/rajebdev/ompchamber/commit/0ba215e6723f6a9ab4a856c07936c71b881fca72))
* **plugins:** refresh bun.lock so a released package pins the new version ([0a9b503](https://github.com/rajebdev/ompchamber/commit/0a9b503dfe8c33b4bff2f3c0ee915bafec8ed334))

## [4.1.1](https://github.com/rajebdev/ompchamber/compare/v4.1.0...v4.1.1) — 2026-10-05

### Fixed

* **ci:** fast-forward the release checkouts so the second release still cuts ([a425a15](https://github.com/rajebdev/ompchamber/commit/a425a15493f68ef93f799cd3d54bf6a368978eff))

## [4.1.0](https://github.com/rajebdev/ompchamber/compare/v4.0.1...v4.1.0) — 2026-10-05

### Added

* **plugins:** version and release the plugin packages from commits ([6b88727](https://github.com/rajebdev/ompchamber/commit/6b88727336697b3b76dc8cf5dc3a83829766ec0f))

### Changed

* **release:** record how the plugin packages are released ([1ba573e](https://github.com/rajebdev/ompchamber/commit/1ba573e3ad66378bddd4a399ddfa0b2f23efe305))

## [4.0.1](https://github.com/rajebdev/ompchamber/compare/v4.0.0...v4.0.1) — 2026-10-05

### Fixed

* **panels:** resolve the SDK app subpath without the workspace symlink ([d16c018](https://github.com/rajebdev/ompchamber/commit/d16c0184e865d03bbaef599b8de92dbc08a163f5))

## [4.0.0](https://github.com/rajebdev/ompchamber/compare/v3.16.1...v4.0.0) — 2026-10-05

### BREAKING CHANGES

* **panels:** panel plugins must be rewritten. A plugin is now a package with
an `app` bundle exporting `definePluginApp`, not a directory of HTML documents;
the `panels` and `capabilities` manifest fields are gone, and `editorPanel` is
replaced by `panel`. Sandboxed panels are no longer supported.
* **panels:** a manifest declaring two panels in the same position is now
rejected with a reason instead of loading both, and bundled plugins are no
longer copied into the working marketplace on first boot.

### Added

* **panels:** a store-and-installed pane, hideable activity bar, header and editor slots ([1b278f0](https://github.com/rajebdev/ompchamber/commit/1b278f04d46c7ce5268057c7c4246b128de027fa))
* **panels:** install from the bundled store, enable/disable, one panel per position ([cd538b6](https://github.com/rajebdev/ompchamber/commit/cd538b6fd906590e1290bbb78c22424c6c36cdc5))
* **panels:** run plugins in-process as Preact components, not sandboxed frames ([5018640](https://github.com/rajebdev/ompchamber/commit/50186400e5728192b6d977fdcc1b58e160f466de))

### Fixed

* **chat:** stop a follow-up from being lost when a run starts elsewhere ([ee15c02](https://github.com/rajebdev/ompchamber/commit/ee15c02b0280a4fb166d87081ca29e3e2718173b))

## [3.16.1](https://github.com/rajebdev/ompchamber/compare/v3.16.0...v3.16.1) — 2026-10-05

### Fixed

* **panels:** resolve the plugin packages at runtime, ship the marketplace ([e6c2c81](https://github.com/rajebdev/ompchamber/commit/e6c2c81837d857448cc574d2843778c9c27e8c54))

## [3.16.0](https://github.com/rajebdev/ompchamber/compare/v3.15.0...v3.16.0) — 2026-10-05

### Added

* **panels:** render plugin panels in the right panel and the editor ([72d107f](https://github.com/rajebdev/ompchamber/commit/72d107f7180b5e2a845cbbee54401d12f4697d4e))
* **panels:** serve sandboxed panel plugins from a marketplace ([3ea2ff9](https://github.com/rajebdev/ompchamber/commit/3ea2ff9639608f8f9a149c7132d559020177e653))
* **plugins:** publish the panel SDK and UI kit as workspace packages ([cb121af](https://github.com/rajebdev/ompchamber/commit/cb121afd1635c77955c732e5082c11e95d4dbe6f))
* **settings:** a Panel Plugins category, install and remove, bundled plugin ([6267690](https://github.com/rajebdev/ompchamber/commit/62676909b432caf86caaa19cf1cc8085ef44aeec))

### Changed

* **plugins:** document the panel plugin SDK, marketplace and publishing ([d3e6928](https://github.com/rajebdev/ompchamber/commit/d3e6928066df8a28dbd9bba7d34d4dc57747526a))

## [3.15.0](https://github.com/rajebdev/ompchamber/compare/v3.14.0...v3.15.0) — 2026-10-04

### Added

* **updates:** resolve both update targets from npm ([04a35d4](https://github.com/rajebdev/ompchamber/commit/04a35d4c80dcbcd2f77c90b13c4acc8167f795a6))

## [3.14.0](https://github.com/rajebdev/ompchamber/compare/v3.13.1...v3.14.0) — 2026-10-04

### Added

* **agent:** route a peer-owned session through its instance ([cb890ab](https://github.com/rajebdev/ompchamber/commit/cb890ab06664868f136f584f74e8694748db1b4a))
* **lifecycle:** read a process parent pid through the platform probe ([890563b](https://github.com/rajebdev/ompchamber/commit/890563bef31764a779ff664d5c2a4b0e098f32d0))
* **session:** guard a session's omp writer against a second instance ([95183d2](https://github.com/rajebdev/ompchamber/commit/95183d2759fda890e9072d88bc3529c1e13d792a))
* **session:** serve a peer-owned session by relaying to its instance ([f87728f](https://github.com/rajebdev/ompchamber/commit/f87728fb9be168b6731e535b1bb4405f93150dd5))

### Fixed

* **chat:** stop listing a sent turn twice in the timeline rail ([34efcf7](https://github.com/rajebdev/ompchamber/commit/34efcf7d9e592f66f92bc5e7d67a255394211d9b))
* **context:** measure an empty session against the selected model's window ([be9a776](https://github.com/rajebdev/ompchamber/commit/be9a776be5e0f6c5561888f7ea5d37da05c71886))
* **mobile:** move the Plan/Goal toggles to the attachment row on a phone ([b7bd935](https://github.com/rajebdev/ompchamber/commit/b7bd9353c5f07822d3e54e21bfec35d0a59f8767))
* **mobile:** name the provider and model on separate lines in the header ([8ca4dba](https://github.com/rajebdev/ompchamber/commit/8ca4dba003d3acb717fe2869dc3c442fd9dfea21))
* **session:** refuse to spawn a writer for a session another process owns ([165c112](https://github.com/rajebdev/ompchamber/commit/165c112e7e4f91abfd1587f043010bb7a75712a1))
* **ui:** reveal hover-only controls on devices without a cursor ([72035f9](https://github.com/rajebdev/ompchamber/commit/72035f92f5b478632236f04a7879c8dabb6f56be))

## [3.13.1](https://github.com/rajebdev/ompchamber/compare/v3.13.0...v3.13.1) — 2026-10-03

### Fixed

* **sidebar:** stop the run spinner and name a new session at send time ([1791c85](https://github.com/rajebdev/ompchamber/commit/1791c850f79bb32964abca6a1415c95314d79246))

## [3.13.0](https://github.com/rajebdev/ompchamber/compare/v3.12.1...v3.13.0) — 2026-10-02

### Added

* **dictation:** add a composer mic button backed by omp's own speech-to-text ([9344e1a](https://github.com/rajebdev/ompchamber/commit/9344e1a3e16b1830ea9b378ffcf03959200efa7e))
* **models:** enrich model display name from id with title-case and suffix format ([2d62c51](https://github.com/rajebdev/ompchamber/commit/2d62c5173cbe0a1e7e5399129b4224ab41b4fd40))

### Fixed

* **context-panel:** resolve context window dari model registry, bukan hardcoded 1M ([858359f](https://github.com/rajebdev/ompchamber/commit/858359fff4a64525aacaf61238bcd8b69f0a4c9e))

## [3.12.1](https://github.com/rajebdev/ompchamber/compare/v3.12.0...v3.12.1) — 2026-10-02

### Fixed

* **usage:** keep each Kenari account as its own provider ([a23a5c2](https://github.com/rajebdev/ompchamber/commit/a23a5c22775850d930d250a5510ffd93ca6aa9ca))

## [3.12.0](https://github.com/rajebdev/ompchamber/compare/v3.11.0...v3.12.0) — 2026-10-02

### Added

* **chat:** start the sidebar run spinner on the click, not on dispatch ([ddd8d98](https://github.com/rajebdev/ompchamber/commit/ddd8d9828b495b50bff0fa1c0cc31fc810b191e7))

### Changed

* **rpc:** split the session wrapper's out-of-band probes into two modules ([9b998ad](https://github.com/rajebdev/ompchamber/commit/9b998ad36d9a511a0c4fa08171b23c1da4722894))

### Fixed

* **chat:** give a first send's sidebar row a spinner from the click ([b467509](https://github.com/rajebdev/ompchamber/commit/b467509dade93a5e16ebcf4d7139903e23e0e82a))
* **chat:** keep the first run's indicator, with the model it actually used ([d4a0723](https://github.com/rajebdev/ompchamber/commit/d4a07231ab60a41c9655fb6a2adf12ceabdbcbc3))
* **chat:** show Stop from the server stream status, not just this client's run ([0eb9371](https://github.com/rajebdev/ompchamber/commit/0eb9371f2f74a146ab0ab3bf8816a063617b922e))
* **eval:** paint the language icon in the surrounding ink, not the brand color ([abfc0e6](https://github.com/rajebdev/ompchamber/commit/abfc0e6570116d1f03d67d2a65710ab24b42af52))
* **fs:** signal the process group when a shell command times out ([48647f0](https://github.com/rajebdev/ompchamber/commit/48647f05921ff108ed94411914aec20718410193))
* **state:** stop the agent stream status and the listener reference leaking ([9bdeafd](https://github.com/rajebdev/ompchamber/commit/9bdeafdd71d5a001b648e9a347274b630c798cf5))

## [3.11.0](https://github.com/rajebdev/ompchamber/compare/v3.10.1...v3.11.0) — 2026-10-02

### Added

* **chat:** persist each run's provider and model beside the stream status ([883b1af](https://github.com/rajebdev/ompchamber/commit/883b1af91137997a381c24a2af4d53a0b7c7b3d6))

### Fixed

* **eval:** title the tool card from input.title, icon it by language, keep the result whole ([5a17f99](https://github.com/rajebdev/ompchamber/commit/5a17f99f47616fdad3750664c05ef9b4b91d0962))

## [3.10.1](https://github.com/rajebdev/ompchamber/compare/v3.10.0...v3.10.1) — 2026-10-01

### Fixed

* **session:** release the stream row a prompt that opened no turn left behind ([3d50fd3](https://github.com/rajebdev/ompchamber/commit/3d50fd3c89874af2c962f7d434f6b731962d5db8))

## [3.10.0](https://github.com/rajebdev/ompchamber/compare/v3.9.0...v3.10.0) — 2026-10-01

### Added

* **readme:** give the Elysia, Shiki and version badges their logos ([6a6b366](https://github.com/rajebdev/ompchamber/commit/6a6b36689e5407dae367bca30385a51293feff60))
* **workspace:** add a Plan panel for the session's plan-mode artifacts ([1dd7a38](https://github.com/rajebdev/ompchamber/commit/1dd7a3834c507128fb076c9f0decce74da6effdc))

### Fixed

* **chat:** make the Plan toggle reach the session it was set on ([451f7f4](https://github.com/rajebdev/ompchamber/commit/451f7f4c271879a4f97ce3df4c41d2826a6baa3f))
* **chat:** paint a read image from its own result bytes ([62afb50](https://github.com/rajebdev/ompchamber/commit/62afb502e339170e5737627cf50a28d13dc45223))
* **chat:** render an edit result as its numbered excerpt, not one plain block ([71f76a6](https://github.com/rajebdev/ompchamber/commit/71f76a675c71ba37ac54088209874d6336cdda99)), closes [path#TAG](https://github.com/rajebdev/path/issues/TAG)
* **chat:** render runtime notices instead of leaking their raw markup ([6322c34](https://github.com/rajebdev/ompchamber/commit/6322c34b69f2b3965277b9532060370810b865ca))
* **providers:** enable "fetch models" for models.yml providers ([a514929](https://github.com/rajebdev/ompchamber/commit/a514929b51b406a21853c593595f8fc2167e0632))

## [3.9.0](https://github.com/rajebdev/ompchamber/compare/v3.8.0...v3.9.0) — 2026-10-01

### Added

* **chat-timeline:** give mobile a tap-sized jump-to-user-message control ([4380b10](https://github.com/rajebdev/ompchamber/commit/4380b10ff3f74dfbe52751f266690775123f7896)), closes [#N](https://github.com/rajebdev/ompchamber/issues/N) [#4](https://github.com/rajebdev/ompchamber/issues/4) [#1](https://github.com/rajebdev/ompchamber/issues/1)
* **chat:** add a goal strip and an auditor-driven continuation loop ([ca3354f](https://github.com/rajebdev/ompchamber/commit/ca3354f7122ed8cddb34d2f355d00e16d0ba4876))
* **chat:** drive omp's plan and goal modes from the composer ([651bc4c](https://github.com/rajebdev/ompchamber/commit/651bc4cc825f19ab8599bc7085f8da527201e4fb))
* **chat:** show send button on desktop while a run streams ([b682f3c](https://github.com/rajebdev/ompchamber/commit/b682f3c81b9c8dded514ecaf060bcc155ff57afe))
* **schedule:** run prompts on a clock, behind the sidebar Calendar button ([508237f](https://github.com/rajebdev/ompchamber/commit/508237f77dd2fd8cd132200fedff408a9c5c55a7))
* **settings:** add Plugins panel under LIBRARY ([2d0c07b](https://github.com/rajebdev/ompchamber/commit/2d0c07b4657be2d3a4a7ed7ade1cc72ee0b97e6d))
* **updates:** announce a new release once per version, with its changelog ([e45604a](https://github.com/rajebdev/ompchamber/commit/e45604aec37acb611c484e6fc1788e8a4582a950))
* **updates:** give MOCK mode an update that exists and cannot touch the machine ([3f1db25](https://github.com/rajebdev/ompchamber/commit/3f1db25ca20930cce567c8b388c64b4c28ca560f))

### Fixed

* **chat-timeline:** clear the undone turn when the rewind empties the transcript ([70552ef](https://github.com/rajebdev/ompchamber/commit/70552ef5a2dcab5b05e676a41993164069b52fba))
* **chat:** keep the timeline's auto-scroll out of the ResizeObserver delivery ([9f35246](https://github.com/rajebdev/ompchamber/commit/9f3524624556c292ac20c97bd52e0fe558dcac99))
* **chat:** make goal mode actually run and keep running ([50c8fdd](https://github.com/rajebdev/ompchamber/commit/50c8fdd75aea47139a7cdd5a8020c97d8e5b6a75))
* **dev:** stop the ResizeObserver report from raising the dev error overlay ([1bbafde](https://github.com/rajebdev/ompchamber/commit/1bbafde6ed6cfb870d8dd3dcda817085e624fc65))
* **editor:** keep the line-number gutter as tall as the document ([b106b7e](https://github.com/rajebdev/ompchamber/commit/b106b7eb7fec9a4b558c94ff931e889b23eec076))
* **omp:** recycle standby omp processes after an update and on Reload OMP Engine ([c3837e9](https://github.com/rajebdev/ompchamber/commit/c3837e9ee432da4fdbbe3e01b70550c588682484))
* **updates:** run the manual update command with bun, not npm ([115f405](https://github.com/rajebdev/ompchamber/commit/115f405a45ad890583e47b200fa72fb92bffdadd))

## [3.8.0](https://github.com/rajebdev/ompchamber/compare/v3.7.1...v3.8.0) — 2026-09-29

### Added

* **wiki:** add a right-panel wiki reader for GitHub and GitLab wikis ([e43c912](https://github.com/rajebdev/ompchamber/commit/e43c9124b2af2bc957b8f3094ac08805124e118c))
* **wiki:** move the Wiki view beside Source Control in both bars ([3d37181](https://github.com/rajebdev/ompchamber/commit/3d3718146f66e43b5434f91daa078e9f097b4ea3))

### Changed

* document the opt-in UI password, TLS and session revocation ([fdd4b2f](https://github.com/rajebdev/ompchamber/commit/fdd4b2fc0ce89718c7bbdbd0288645680ddb564c))

### Fixed

* **skills:** load newly created skills into live sessions ([d4600c6](https://github.com/rajebdev/ompchamber/commit/d4600c6c4fec2b6b446d8ff34f76914abff66b5b))
* **skills:** pick up skills written mid-run, by hand, or in an ancestor dir ([6c2c99a](https://github.com/rajebdev/ompchamber/commit/6c2c99ad2977c3c9a635a026371451324c8ff3ff))
* **workspaces:** stop the omp project sync from appending to a curated list ([8d944a8](https://github.com/rajebdev/ompchamber/commit/8d944a8f3382c21edee0c452e46720d8adc93e1a))

## [3.7.1](https://github.com/rajebdev/ompchamber/compare/v3.7.0...v3.7.1) — 2026-09-29

### Fixed

* **about:** point social links at the real project and refresh the row set ([3bac3cd](https://github.com/rajebdev/ompchamber/commit/3bac3cdf893443ffcbcfaf92add6dc7a13d40ef9))

## [3.7.0](https://github.com/rajebdev/ompchamber/compare/v3.6.0...v3.7.0) — 2026-09-29

### Added

* **auth:** add opt-in UI password protection with TLS and session revocation ([a81e4cf](https://github.com/rajebdev/ompchamber/commit/a81e4cf2935d433ad6fa357dad106f09056a61c8))
* **chat-timeline:** make footer actions act on the turn they describe ([20245ae](https://github.com/rajebdev/ompchamber/commit/20245aef9b2b46ff3aacd25ce73bc77b5bc59eec))
* **chat-timeline:** maximize the New Chat modal and grow its composer ([4bcf5c2](https://github.com/rajebdev/ompchamber/commit/4bcf5c2897940a34865bf2635e1d0969845a1dcf))
* **chat-timeline:** separate a seeded new chat from the user's own instruction ([67ad744](https://github.com/rajebdev/ompchamber/commit/67ad74481300004c95729ba6b9475945b03e34df))
* **sidebar:** add Go to Explorer and Rename with AI to the row menus ([f7e39e5](https://github.com/rajebdev/ompchamber/commit/f7e39e59b4b4af11223622bda146c45892c005e8))
* **sidebar:** give desktop session rows a clock and the folder header a hover chevron ([013ac89](https://github.com/rajebdev/ompchamber/commit/013ac8956ccc43c54e8ad950964fc7f963880ffc))
* **sidebar:** keep the desktop session and folder actions on screen ([8036a80](https://github.com/rajebdev/ompchamber/commit/8036a808d8cca98b1fd1ce4db313045984cf85af))
* **workspace:** share one selected repo across the files, search, git and terminal views ([27b3b14](https://github.com/rajebdev/ompchamber/commit/27b3b1442a911829a7b800685fcaa983b60d3cf5))

### Fixed

* **chat:** drive the generating indicator from the session stream state ([c50dd52](https://github.com/rajebdev/ompchamber/commit/c50dd5212b62df7a71092865df7ee53a179b8389))
* **chat:** withhold the run footer while the session is still streaming ([e5d5d99](https://github.com/rajebdev/ompchamber/commit/e5d5d99691b3da28db6b39b28d968e4e319f33d5))
* **git:** make the Source Control dot follow the repo the panel is on ([edd35cc](https://github.com/rajebdev/ompchamber/commit/edd35cc49f8f9e95e0d50e40bb55683a13148afb))
* **git:** report the branch's commit count, and stop fabricating history ([fab733f](https://github.com/rajebdev/ompchamber/commit/fab733f4703064903b13f4f90d0eba82f417d323))
* **mobile:** line the show-more chevron and label up with the drawer's columns ([3056224](https://github.com/rajebdev/ompchamber/commit/30562244116445643ed736ba5c8b78367d1415d1))
* **session-state:** restore a pending chat's saved UI state instead of resetting it ([3d3ad45](https://github.com/rajebdev/ompchamber/commit/3d3ad457c2368d65d747395790997ac51b1c6301))
* **todo:** draw a recorded init-list task as its phase, and read all five omp statuses ([5fa9efc](https://github.com/rajebdev/ompchamber/commit/5fa9efcef1930fc9e9eef6ed080cd2ce4d368008))
* **updates:** drop the update log once a run succeeds ([1bdc23a](https://github.com/rajebdev/ompchamber/commit/1bdc23a45863cabca935382a26ef1060c2af130d))

## [3.6.0](https://github.com/rajebdev/ompchamber/compare/v3.5.0...v3.6.0) — 2026-09-28

### Added

* **diagnostics:** report descriptor pressure before spawns start failing ([ed7be43](https://github.com/rajebdev/ompchamber/commit/ed7be4378565abecee4c992c89207d97dfe15635)), closes [bun#40706](https://github.com/rajebdev/bun/issues/40706) [#4](https://github.com/rajebdev/ompchamber/issues/4) [#10](https://github.com/rajebdev/ompchamber/issues/10)
* **settings:** scope skills and commands to the user or a workspace ([5a1c721](https://github.com/rajebdev/ompchamber/commit/5a1c72148db286a1a08124f5979e7db43cb2a4bd))
* **skills:** discover skills through omp and scope the surfaces to a workspace ([e081204](https://github.com/rajebdev/ompchamber/commit/e0812046f40f240f97a1f1835ddb4ce7b56beedb))
* **updates:** stream update progress to the About modal ([f2554e5](https://github.com/rajebdev/ompchamber/commit/f2554e5beecc618fc1fe67e86ac7cf82052a9b22))

### Changed

* **agents:** record the dev server descriptor cliff ([bc29778](https://github.com/rajebdev/ompchamber/commit/bc29778bc9554ece2112fb73fe340b82b9bb2d60))
* **chat:** stop mirroring the whole transcript into the chat overlay ([0f0f02b](https://github.com/rajebdev/ompchamber/commit/0f0f02b932f38797d550939b86f67547ad2b8046))

### Fixed

* **chat:** place a raw turn by its clock, not by the rows the overlay drops ([264f2d9](https://github.com/rajebdev/ompchamber/commit/264f2d9bd7cab51993dd29a048df2e8c8fd36188))
* **db:** hold one sqlite handle across a hot reload ([ece893f](https://github.com/rajebdev/ompchamber/commit/ece893f525289ed79ea289b5b1927e6e7f738090))
* **db:** let a blocked writer wait instead of failing on the spot ([e62a052](https://github.com/rajebdev/ompchamber/commit/e62a05293671a4f691c2ab11c6aa746def302720))
* **markdown:** stop a lone $ from rendering as math ([fb9c0b8](https://github.com/rajebdev/ompchamber/commit/fb9c0b82ff303278fed7137a64f18c90049616d7))
* **sessions:** stop the sidebar probe reporting a caught ENOENT as a crash ([651a48f](https://github.com/rajebdev/ompchamber/commit/651a48f12e2840f074f71ffea1ab2072b1b3986c))
* **terminal:** spawn one shell per id when two attaches race ([f051973](https://github.com/rajebdev/ompchamber/commit/f051973d3fcc60a377f1abb11faaa7ed4dc00b30))
* **updates:** refuse a second update while one is running ([2aef033](https://github.com/rajebdev/ompchamber/commit/2aef03389c90572f48aed69ae34939de06ea3b40))

## [3.5.0](https://github.com/rajebdev/ompchamber/compare/v3.4.0...v3.5.0) — 2026-09-28

### Added

* **sessions:** delete a session from the sidebar ([e4fd65e](https://github.com/rajebdev/ompchamber/commit/e4fd65e27d3bab4a7b8ed4ede1154d7a1dadde41)) (thanks [@rayzalzero](https://github.com/rayzalzero))

## [3.4.0](https://github.com/rajebdev/ompchamber/compare/v3.3.3...v3.4.0) — 2026-09-28

### Added

* **chat:** refuse TUI-only slash commands instead of sending them to the model ([ed01bc5](https://github.com/rajebdev/ompchamber/commit/ed01bc54f7cad316238d67ff1f8bc0825877be4b))

### Fixed

* **chat:** keep builtin-command output after a reload ([de7dc05](https://github.com/rajebdev/ompchamber/commit/de7dc05bc3675281ca29b1230f831b8f8178c78d))
* **chat:** strip ANSI from command output and refetch commands when omp's set changes ([e1027f6](https://github.com/rajebdev/ompchamber/commit/e1027f6f8acc7741eac05d4881c1c7355f38507e))

## [3.3.3](https://github.com/rajebdev/ompchamber/compare/v3.3.2...v3.3.3) — 2026-09-27

### Fixed

* **fonts:** serve the font faces from source so /fonts.css cannot go stale ([a63b2e0](https://github.com/rajebdev/ompchamber/commit/a63b2e097eeddbcf54cf9f7ed74dd65fe6cd2d6b))

## [3.3.2](https://github.com/rajebdev/ompchamber/compare/v3.3.1...v3.3.2) — 2026-09-27

### Changed

* **code:** skip the escape pass when there is nothing to escape ([f02256e](https://github.com/rajebdev/ompchamber/commit/f02256e09f88ce8c735f1d750ca2ab1db40c28ba))
* **fs:** drop the redundant stat behind the directory picker ([e1b07de](https://github.com/rajebdev/ompchamber/commit/e1b07de7dc2cfbebbe526c381575814ef89bb737))
* **fs:** walk for nested repos instead of spawning find ([ed3ce5b](https://github.com/rajebdev/ompchamber/commit/ed3ce5b5c9f85b3010d121acf7c22de64300d824))
* **lifecycle:** reuse the probe scratch buffers in argvOf and executablePath ([e57c846](https://github.com/rajebdev/ompchamber/commit/e57c846808fc7abd712c3153aa9c231e51787cdf))
* **omp:** encode an RPC frame once and hoist the codec ([b6397ff](https://github.com/rajebdev/ompchamber/commit/b6397ff287d0b76b39179946100be4d7cc2abaf9))
* **omp:** split NDJSON lines with a cursor instead of re-slicing the buffer ([2c3123a](https://github.com/rajebdev/ompchamber/commit/2c3123afcafb2ba12ea1445b6a36ffb0a583bd34))
* **server:** skip entries without usage in the session usage scan ([b786012](https://github.com/rajebdev/ompchamber/commit/b786012013a66d54b9dfde9c8bd23d7100103b20))
* **terminal:** re-acquire the controlling terminal without spawning tty ([e9a5314](https://github.com/rajebdev/ompchamber/commit/e9a531470511fb8ee31e9224c34b9431e95d35fb))

### Fixed

* **terminal:** use /dev/fd/0 so the PTY shim works on Linux ([229e321](https://github.com/rajebdev/ompchamber/commit/229e3210394438f3c78afd4be436b81edad92759))

## [3.3.1](https://github.com/rajebdev/ompchamber/compare/v3.3.0...v3.3.1) — 2026-09-27

### Fixed

* **build:** anchor the dependency gate on the package, not the consumer ([5b42c75](https://github.com/rajebdev/ompchamber/commit/5b42c75c21853065c09edfd696cfa1d8e881ca47))

## [3.3.0](https://github.com/rajebdev/ompchamber/compare/v3.2.0...v3.3.0) — 2026-09-27

### Added

* **editor:** make the editor typeface a setting ([f90c369](https://github.com/rajebdev/ompchamber/commit/f90c369dee47219536cfef36b171f8a20547ae41))
* **terminal:** on-screen key bar for touch devices ([2518e94](https://github.com/rajebdev/ompchamber/commit/2518e9433b3d4d5c6c5d1eecd4312dfd93af8156))

### Changed

* **settings:** drop the 15 fields that were never wired ([4a8ff97](https://github.com/rajebdev/ompchamber/commit/4a8ff978e558413aaa52067959782b41721a6ff3))

### Fixed

* **assets:** answer conditional requests instead of resending the file ([fcf3278](https://github.com/rajebdev/ompchamber/commit/fcf32783ae105c84eb1bf2f2a8dad506bbae072e))
* **build:** declare the Tailwind toolchain as runtime dependencies ([1682533](https://github.com/rajebdev/ompchamber/commit/16825333c393b3518950b58a08fe5d7c7a954936))
* **chat:** decide the notice expander by measured clipping, not character count ([da30a7b](https://github.com/rajebdev/ompchamber/commit/da30a7bc41fb8679f0a95d607e23f45ed0b540da))
* **dev:** stop re-downloading the client bundle on every page load ([0ebcb76](https://github.com/rajebdev/ompchamber/commit/0ebcb768bec376926f5eedc72fddb0be62d54385))
* **editor:** give the phone the desktop's type, from one module ([644a7ad](https://github.com/rajebdev/ompchamber/commit/644a7adba535213a61beb4ae82cd1f1dc0a0f23a))
* **mobile:** draw the question mark on a session blocked on input ([55d0163](https://github.com/rajebdev/ompchamber/commit/55d0163fd7ddbe153e4f2070d8ab8c8aaf62c942))
* **server:** report why the client bundle failed instead of a bare 500 ([ab4ddce](https://github.com/rajebdev/ompchamber/commit/ab4ddced2789e6060d663fbd7c386a17b550f093))
* **terminal:** bundle the nerd symbols face so prompts survive off the laptop ([00f8992](https://github.com/rajebdev/ompchamber/commit/00f8992ab6540fb0d644f3f51160207415ae111a))

## [3.2.0](https://github.com/rajebdev/ompchamber/compare/v3.1.1...v3.2.0) — 2026-09-26

### Added

* **diff:** add full-code and diff-only modes plus a word-wrap toggle ([3e3a64c](https://github.com/rajebdev/ompchamber/commit/3e3a64c86b900bb3b73514eea3b2668358466769))
* **sidebar:** refresh the session list from the mobile toolbar ([69ccf9a](https://github.com/rajebdev/ompchamber/commit/69ccf9aed23b8971907ae839f96351e7ac81d6f5))

### Changed

* **code:** stop re-deriving line offsets and skip the view nobody draws ([e045ccf](https://github.com/rajebdev/ompchamber/commit/e045ccf685cc5f4983032f7c5f9aa39c1f744b1d))
* **native:** hold the port lock with flock and read p_stat once ([1ea7f7b](https://github.com/rajebdev/ompchamber/commit/1ea7f7be3ece5b520924a7cf50957599b45bf8da))
* **routes:** one git ref listing, in-process versions, real backpressure ([313d732](https://github.com/rajebdev/ompchamber/commit/313d7323ba476c6b66830fd0c9103ab31e5494ac))
* **session:** read the session tree once and cache what is parsed ([ae097f6](https://github.com/rajebdev/ompchamber/commit/ae097f672dde81a46e3a20c5007ca3e6034d976b))

### Fixed

* **agent:** refuse an observer read instead of spawning a process for it ([e69bccb](https://github.com/rajebdev/ompchamber/commit/e69bccb5a7e1a4e319e60dff81ddd90ee5552e27))
* **chat:** stop a non-terminal agent_end from clearing the generating state ([128293c](https://github.com/rajebdev/ompchamber/commit/128293cfbbb12da1dcdbb3f2ea2f688a106544e9))
* **editor:** keep both toolbars usable on a narrow panel ([9961798](https://github.com/rajebdev/ompchamber/commit/9961798b0fe2e3c14ffc24573ff8f6e58c9a95fd))
* **mobile:** drop the roster indent and hold the archive column ([2ad825d](https://github.com/rajebdev/ompchamber/commit/2ad825d708a93dd987df163a77ec5750d0426fa6))
* **mobile:** indent the subagent roster in the session drawer ([21d271b](https://github.com/rajebdev/ompchamber/commit/21d271b08380a790aa52af13f7d8157a0e61b81b))
* **mobile:** lead the session row with the roster toggle, like desktop ([547f359](https://github.com/rajebdev/ompchamber/commit/547f359a7273428ee74fb58e877b2fb8ec1d6b6c))
* **mobile:** line the folder glyph up with the roster toggle ([fcf170b](https://github.com/rajebdev/ompchamber/commit/fcf170b167816ecaf1e617a8e5e24e5cb360e67d))
* **mobile:** move the roster toggle beside the folder's chevron ([60d3fb2](https://github.com/rajebdev/ompchamber/commit/60d3fb2d8b74179449a61f850d668022b2376215))
* **mobile:** render the subagent roster in the session drawer ([7798d9b](https://github.com/rajebdev/ompchamber/commit/7798d9b235f5cdb7db3becd64cdcb44f98b8ae27))
* **session:** return the parsed stats and keep titles on large sessions ([fe9ca78](https://github.com/rajebdev/ompchamber/commit/fe9ca783867b5c2ceb13847fdfb54e6640661a5d))
* **settings:** make every settings view usable on a phone ([faf6d3c](https://github.com/rajebdev/ompchamber/commit/faf6d3c693323a2cc2a353becca1566b5ce5a44b))
* **stream:** keep the observer WebSocket alive past its first pong ([2e67d4f](https://github.com/rajebdev/ompchamber/commit/2e67d4f45469afc7df5c357d2e70c12bf96cf80a))
* **subagent:** keep the transcript tailing from disk once the process is gone ([579b787](https://github.com/rajebdev/ompchamber/commit/579b787caff9c1290442e662c8505c28a25365b6))
* **subagent:** render the mobile footer variant in the subagent view ([d930b16](https://github.com/rajebdev/ompchamber/commit/d930b168a0ca7476bbc2c37412f91ae652a3272d))

## [3.1.1](https://github.com/rajebdev/ompchamber/compare/v3.1.0...v3.1.1) — 2026-09-25

### Fixed

* **build:** flatten nested at-rules so Chrome keeps the refinements ([dfa0739](https://github.com/rajebdev/ompchamber/commit/dfa0739e32c73bbd8e1cac92350fe1a55257ab47))
* **cli:** stop only the instances the CLI started ([05f4248](https://github.com/rajebdev/ompchamber/commit/05f424807f343f681f6b37a9781b778b31fd47c2))

## [3.1.0](https://github.com/rajebdev/ompchamber/compare/v3.0.0...v3.1.0) — 2026-09-25

### Added

* **editor:** add find/replace, VS Code keybindings and a command palette ([7913168](https://github.com/rajebdev/ompchamber/commit/791316832cad69f5951e55816412820168bc0599))
* **files:** create a file from a folder's context menu ([6688093](https://github.com/rajebdev/ompchamber/commit/668809399318cafd0ba97287245996326992acc1))
* **todo:** add a right-panel view of the session's live todo list ([7b9750e](https://github.com/rajebdev/ompchamber/commit/7b9750e578d03464ce1ea39a0b5d894c981437ad))

### Changed

* **agents:** record the Todo panel and its read path ([07bbcca](https://github.com/rajebdev/ompchamber/commit/07bbcca85cd67a986a64bdac27cc395a36cdcf21))
* **chat:** group the todo readers under chat/todo/ ([41f4ac7](https://github.com/rajebdev/ompchamber/commit/41f4ac7a063ac648cce90e63f081abe0cbbc6d0c))
* **release:** drop the inert bumpStrict and wire the rules module ([58f9da7](https://github.com/rajebdev/ompchamber/commit/58f9da7d2da9c9d3a55c39bd966d5e25c38ee167))
* state the version rules that actually run ([46b2708](https://github.com/rajebdev/ompchamber/commit/46b270806abbe38479301115125be923d142e741))

### Fixed

* **browser:** drop the agent panel's non-functional device selector ([8a84e56](https://github.com/rajebdev/ompchamber/commit/8a84e56a2d01e7f4f94dfe1faf331eaa6a2b75f6))
* **release:** decide a version from the rules the repository means ([5b61621](https://github.com/rajebdev/ompchamber/commit/5b616214d3df9bd2b2a1f8c2a556db29df61a2ee))

## [3.0.0](https://github.com/rajebdev/ompchamber/compare/v2.0.2...v3.0.0) — 2026-09-25

### BREAKING CHANGES

* **build:** `bun run dev:client` and `bun run dev:server` are gone —
`bun run dev` runs the single process that replaces both. `dist/client` is
no longer a client-only artifact: it is the production server bundle, and
`dist/client/index.html` is no longer the file the server reads.
`ompchamber serve --prod` runs `dist/client/index.js` and requires
`bun run build` to have produced it. `postcss.config.mjs` is removed (the
Tailwind plugin is configured explicitly) and so is `rsbuild.config.ts`.

### Added

* **build:** bundle the client with Bun instead of rsbuild ([e73d552](https://github.com/rajebdev/ompchamber/commit/e73d552526fb0d143ead71da81155c17626e89fb))
* **mobile:** add per-workspace new-session button to the session drawer ([20546a4](https://github.com/rajebdev/ompchamber/commit/20546a4569309e014c2d9ed6691413c08e65249d))
* **providers:** draw every provider mark from one shared component ([87a2f47](https://github.com/rajebdev/ompchamber/commit/87a2f47346473045052ccb5c922aa09bb7bae526))
* **providers:** register a provider's wire dialect, and add models by hand ([5c5758f](https://github.com/rajebdev/ompchamber/commit/5c5758f3da959172846be4bef8c936f192058057))
* **usage:** report every credentialed provider's quota, not just kenari and DeepSeek ([bac35df](https://github.com/rajebdev/ompchamber/commit/bac35df86b8ed5b046b714859e4cfa984c4ba4ae))

### Changed

* **agents:** record the editor and diff toolbar contracts ([3a5a4cc](https://github.com/rajebdev/ompchamber/commit/3a5a4cc3a01fa6cbf0c5f6ec75724cbab74c7080))
* **agents:** record the provider dialect, usage, and mark contracts ([e466aa1](https://github.com/rajebdev/ompchamber/commit/e466aa1dd81b8b4862092a356288593e87023782))
* describe the Bun bundler dev loop and its constraints ([549945a](https://github.com/rajebdev/ompchamber/commit/549945a981ae62f63ba51718597ee6311e463353))
* **editor:** theme the diff tab icon instead of hardcoding blue ([e1caaa1](https://github.com/rajebdev/ompchamber/commit/e1caaa15a607966f0ea99f33732f69e366cf88c1))
* list the variables the server reads in .env.example ([590fb6c](https://github.com/rajebdev/ompchamber/commit/590fb6c037607e2248d04f10fc68f9d22de76c54))
* **models:** group the provider modules into provider/ folders ([3e4a73b](https://github.com/rajebdev/ompchamber/commit/3e4a73b156918227b9f69c007bfd901728b27d83))

### Fixed

* **cli:** run the production server from its own bundle ([33eb64c](https://github.com/rajebdev/ompchamber/commit/33eb64ccf81e50860cfc75ff269e971bb90b9d61))
* **diff-panel:** make the toolbar's actions actually act, and fit the panel ([ba0796a](https://github.com/rajebdev/ompchamber/commit/ba0796a28fe03106f1d3c1e975d706f2664fc2fe))
* **diff:** hide whitespace-only changes instead of trimming their text ([a0c29ed](https://github.com/rajebdev/ompchamber/commit/a0c29edc5f092b397085eee58f18fda0c3de8267))
* **editor:** convert a diff tab without mutating persisted session state ([69dcf95](https://github.com/rajebdev/ompchamber/commit/69dcf9592faf352d0ddab6efe3df640c5038f686))
* **editor:** report failed reads and failed saves instead of faking success ([39c1784](https://github.com/rajebdev/ompchamber/commit/39c17849e3d451a126a24f53d76cf3c0b4ac2894))

## [2.0.2](https://github.com/rajebdev/ompchamber/compare/v2.0.1...v2.0.2) — 2026-09-24

### Fixed

* **bot:** read the review comment's values, not its markdown decoration ([d7e6bd2](https://github.com/rajebdev/ompchamber/commit/d7e6bd206857419668f2f693cce7b494869a4052))

## [2.0.1](https://github.com/rajebdev/ompchamber/compare/v2.0.0...v2.0.1) — 2026-09-24

### Changed

* document the bot contract and the contribution policy ([49d08d4](https://github.com/rajebdev/ompchamber/commit/49d08d4903726508e70bc9f716341300dc13cc80))

### Fixed

* **diff-panel:** size the panel from its caller so the diff is not clipped ([56deb5a](https://github.com/rajebdev/ompchamber/commit/56deb5ac3557597f8f8404aa40dc3572587519ca))
* **editor:** keep a file's own line endings when the editor saves it ([a35804e](https://github.com/rajebdev/ompchamber/commit/a35804ebc028ec40200f88f370ce47011ff73231))

## [2.0.0](https://github.com/rajebdev/ompchamber/compare/v1.2.1...v2.0.0) — 2026-09-24

### BREAKING CHANGES

* **btw:** a side question now runs with the tools its approval mode
allows and can modify the workspace, where it was previously read-only. The
`<btw>` prompt is no longer byte-identical to omp's TUI template.

### Added

* **btw:** mark a promoted session with a "btw:" prefix in the sidebar ([1d8a45d](https://github.com/rajebdev/ompchamber/commit/1d8a45d03243153ab519712688d5d744223658b1))
* **btw:** run side questions with tools and render them through the chat timeline ([c1c7986](https://github.com/rajebdev/ompchamber/commit/c1c79861250fa5e19113e8b7ec6aff4c552e9357))
* **chat:** name a session as soon as its first message lands ([54e6e3d](https://github.com/rajebdev/ompchamber/commit/54e6e3db1f5dd74567fc2481fa961a53d4fcb23d))
* **settings:** write per-model configuration omp actually applies ([6f61042](https://github.com/rajebdev/ompchamber/commit/6f6104257295c2e40bc7e5a93651bfc573139407))
* **theme:** add 42 ported palettes and palette cards to appearance ([fa8d222](https://github.com/rajebdev/ompchamber/commit/fa8d2224f648fd653dc688861d8ecd9e599b48d3))

### Changed

* **agents:** document the 350-line ceiling in the verification gates ([7f52118](https://github.com/rajebdev/ompchamber/commit/7f52118800965beecb2a53e4df2582ac5aa6a16e))
* **btw:** record the tool-enabled child, chat-timeline rendering and dialog state ([134c360](https://github.com/rajebdev/ompchamber/commit/134c3600611e9d2878ffba284a6ff5156b8c24ff))
* **fs:** answer repeated git-ignore questions from a cache ([1858fbd](https://github.com/rajebdev/ompchamber/commit/1858fbd3c48ce051d1c5df3d95df754d9cf1dbd8))
* **fs:** run the Search panel on a native ripgrep when one is installed ([bf87e01](https://github.com/rajebdev/ompchamber/commit/bf87e01292a1ce111a5fa116e4cec386cc29decd))
* **lifecycle:** read process identity natively instead of spawning ps ([261500d](https://github.com/rajebdev/ompchamber/commit/261500d921449f34613a71c72f8b2ce06ad81ea0))
* **omp:** drop the running-session broadcast nothing subscribes to ([e10e7be](https://github.com/rajebdev/ompchamber/commit/e10e7beffb59857cc70e5d4d74ae8d333371b156))
* **plugins:** offer zstd before brotli and gzip ([31187a7](https://github.com/rajebdev/ompchamber/commit/31187a7c794ebee069e3ff6290a512eef90ee7cf))
* **readme:** compose the mobile capture at the aspect of its row ([ee2f752](https://github.com/rajebdev/ompchamber/commit/ee2f7525a23a53eb6d82ed2ebf79e9f5de78bb84))
* **readme:** rebuild the README around live versions and real captures ([fb23335](https://github.com/rajebdev/ompchamber/commit/fb233356a5e27a235d3c1ca06286a479c71bf102))
* **terminal:** read the PTY's foreground group without spawning ps ([3b6aee6](https://github.com/rajebdev/ompchamber/commit/3b6aee649d0a530f85fb1c97fab10be776f58d08))
* **terminal:** scan replay scrollback with indexOf instead of byte by byte ([fc5cf1f](https://github.com/rajebdev/ompchamber/commit/fc5cf1f9a259086ae67b57999cdbc3797656736e))

### Fixed

* **chat:** hold the ask modal until the session history has settled ([d686c5b](https://github.com/rajebdev/ompchamber/commit/d686c5b810b0bdafcf8469af23f3e93e168c2c99))
* **chat:** keep what is typed in the extension dialog's editor ([ccd7e8a](https://github.com/rajebdev/ompchamber/commit/ccd7e8adf76bb98fcb857f492eb3fe0f1ba897df))
* **chat:** land the timeline at the tail on open and jump-to-bottom ([8351e52](https://github.com/rajebdev/ompchamber/commit/8351e523d69ba0088870c16b803ec750e4e6a257))
* **chat:** stop the ask card reading a stopped ask as still queued ([9bd47d2](https://github.com/rajebdev/ompchamber/commit/9bd47d23453cf304db800af37e9a9bcc8c74830d))
* **chat:** title a session from its first message only ([5765027](https://github.com/rajebdev/ompchamber/commit/576502749b1c3e2671d4f8a219b5e4a24998770c))
* **editor:** render an opened markdown file as the document it is ([c47689f](https://github.com/rajebdev/ompchamber/commit/c47689f8f742e5008d8d74339308c3f9b8087d68))
* **lifecycle:** open the Darwin probe's libraries on first use ([93fe031](https://github.com/rajebdev/ompchamber/commit/93fe031a212858de057d4385503ff2d6afd24065))
* **markdown:** keep a code span from being autolinked as a link ([a890660](https://github.com/rajebdev/ompchamber/commit/a8906605adcb73506209936042e30a75fc3930d1))
* **queue:** stop a queued follow-up from being stranded by a busy session ([b280393](https://github.com/rajebdev/ompchamber/commit/b28039344698c144d6efd19b076a1bc09da594bd))
* **sessions:** judge a stream row by its owner, not the reader's registry ([2de306a](https://github.com/rajebdev/ompchamber/commit/2de306a47c800f0aeb8e94dd583fab31566c5277))
* **settings:** stop a stale writer reverting another writer's settings ([ce9b9d4](https://github.com/rajebdev/ompchamber/commit/ce9b9d43698c300a1d0038a3d3831fa2841b2674))
* **settings:** stop the provider writers corrupting omp's config files ([45d3cff](https://github.com/rajebdev/ompchamber/commit/45d3cff8c2887e03ab1161729ea9c4d88bc51ad2))
* **terminal:** read tpgid from the right /proc offset ([5baf941](https://github.com/rajebdev/ompchamber/commit/5baf9410f01d4558996104e1579df8cf51c74d73))
* **workspace:** scope repo picker and listing to the active workspace root ([90097be](https://github.com/rajebdev/ompchamber/commit/90097bee917e699376197da05acad1168cfd698c))

## [1.2.1](https://github.com/rajebdev/ompchamber/compare/v1.2.0...v1.2.1) — 2026-09-23

### Fixed

* **btw:** hide the promote button once promoted and label the chip like the chat does ([cd48766](https://github.com/rajebdev/ompchamber/commit/cd48766034389b0fe7d9ca8ed23e90c6ab86b7fb))

## [1.2.0](https://github.com/rajebdev/ompchamber/compare/v1.1.0...v1.2.0) — 2026-09-23

### Added

* **btw:** add a side-question panel backed by a resumed session copy ([548da54](https://github.com/rajebdev/ompchamber/commit/548da545f0efe64d5f052ad9355e92403bbaf97a)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* **btw:** make the side-question form replace the composer ([1a9eea2](https://github.com/rajebdev/ompchamber/commit/1a9eea2c7050e1a90ef46ab6330a8a3f633accd3)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* **chat:** drag and drop files onto the composer ([633ae6b](https://github.com/rajebdev/ompchamber/commit/633ae6b4712c2c651329d3bae0491d6f645ce069))
* **chat:** generate a session title from the first settled run ([e373d1a](https://github.com/rajebdev/ompchamber/commit/e373d1a30e31185fc477f39d42f782c532657f9b))
* **chat:** list every user turn in the jump rail and reach any of them ([0814e16](https://github.com/rajebdev/ompchamber/commit/0814e1689dba656ba1ea5f3c5b02564e9f5e2cc5))
* **chat:** offer the chamber's /btw in the composer command popup ([1e9529f](https://github.com/rajebdev/ompchamber/commit/1e9529fd9422bc072ed93bb689c0810fff5e559c)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* **editor:** render image files as pictures instead of binary text ([48104a6](https://github.com/rajebdev/ompchamber/commit/48104a657e9e5bcc0199f5a434a3fbc9f4e649d1))

### Changed

* **agents:** document the BTW side-question subsystem ([c6210bf](https://github.com/rajebdev/ompchamber/commit/c6210bfb8c2af522a64dd3331ae98b0587ed443a)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* **chat:** make the agent stream connectors transport-generic ([fd13bda](https://github.com/rajebdev/ompchamber/commit/fd13bda24fb69c2e7323cdde18577ecd045b3438)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* split session scanner and db bootstrap under file ceiling ([7f184bb](https://github.com/rajebdev/ompchamber/commit/7f184bb798aaa70ae880e3ed60c563c7074cbe27))

### Fixed

* **btw:** bring the caret into the ask field when the form opens ([a881fc0](https://github.com/rajebdev/ompchamber/commit/a881fc09c676688f72eee4bde23d12add6f4831e)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* **btw:** land the caret in the side session's composer ([f138574](https://github.com/rajebdev/ompchamber/commit/f1385742f5ada1f7ea0e02ba59421b23667aded1)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* **btw:** stop side questions from corrupting turns, titles and composer behaviour ([e5e1a8e](https://github.com/rajebdev/ompchamber/commit/e5e1a8e18ff2cd92479d92f640f2394305e07c7f))
* **chat:** attach files a drop names but does not hand over ([4eba052](https://github.com/rajebdev/ompchamber/commit/4eba0522d3355cf22a40359f705c0f9f6d912764))
* **chat:** keep attachments intact across reload, queue and retry ([8aef900](https://github.com/rajebdev/ompchamber/commit/8aef900391d1e4b0883b95e1a5641df0a8582d0e))
* **chat:** let Enter send a command the popup has already completed ([27907c1](https://github.com/rajebdev/ompchamber/commit/27907c134cf445d1b0b306f255a60d46429f86df)) (thanks [@rayzalzero](https://github.com/rayzalzero))
* **chat:** read dropped files from the object that can actually be read ([2423ab5](https://github.com/rajebdev/ompchamber/commit/2423ab521fefd0dc73382ad590b8cbc11fc6f488))
* **session-sidebar:** order sessions by last real activity, not file mtime ([1207f88](https://github.com/rajebdev/ompchamber/commit/1207f887b213ae927c94e809943ccec3165d1a62))

## [1.1.0](https://github.com/rajebdev/ompchamber/compare/v1.0.0...v1.1.0) — 2026-09-23

### Added

* **chat:** match the composer slash popup to oh-my-pi ([9635283](https://github.com/rajebdev/ompchamber/commit/9635283712e2793920b27e800db13f75b575c10a))
* **layout:** store panel widths per session as a share of the available area ([0004c95](https://github.com/rajebdev/ompchamber/commit/0004c95db26476d4d910115fa2c1daef8fda9c1c))
* **models:** persist favorite and recent models, keep the last five ([2abd752](https://github.com/rajebdev/ompchamber/commit/2abd752dbc046ff3cb234c2cbf328ccf85d2f365))
* **sidebar:** label subagent rows and transcripts with identity and target ([ef85132](https://github.com/rajebdev/ompchamber/commit/ef85132d8ef5816311c0337fcce6b676a94d884c))

### Changed

* **models:** extract the registry loader and split model types ([4926da7](https://github.com/rajebdev/ompchamber/commit/4926da76b188ea95819af6b444114b3e58c197a8))

### Fixed

* **chat-timeline:** render yield summary as markdown ([2bdd27c](https://github.com/rajebdev/ompchamber/commit/2bdd27c748ee56f1039bfee31604fdbdd36d1bbc))
* **chat:** keep a mid-stream model pick off the running turn ([5b6f7b7](https://github.com/rajebdev/ompchamber/commit/5b6f7b7e504006b94863b60c469c7443c12a48b6))
* **queue:** recover the follow-up queue from a lost delivery timer ([6832174](https://github.com/rajebdev/ompchamber/commit/6832174643909c5a568cd32be33edd2893cf7a3d))
* **session-sidebar:** keep the chevron hover-only while the roster is expanded ([363998f](https://github.com/rajebdev/ompchamber/commit/363998fb91f4e0056dd0b198a435c9de6d45b5d8))
* **session-sidebar:** make the run-status glyph pointer-inert so the chevron is clickable ([cd3f8c1](https://github.com/rajebdev/ompchamber/commit/cd3f8c181fa691a67252b67f083dbd7491a6e174))
* **session-sidebar:** pin the expand chevron whenever the row is not streaming ([1bbefcc](https://github.com/rajebdev/ompchamber/commit/1bbefcc40fb219a454161129972c6bb678f2b32e))

## [1.0.0](https://github.com/rajebdev/ompchamber/compare/v0.8.0...v1.0.0) — 2026-09-22

### BREAKING CHANGES

* (!) footer plus the mixed-change split rule. The
commit subject doubles as a changelog bullet, so the subject must
name the behavior that changed.

### Added

* **chat:** move follow-up queue ownership to the server ([dc8101e](https://github.com/rajebdev/ompchamber/commit/dc8101ee6438913421e47fa0b5bf71f460a884b7))
* **chat:** re-signal the sidebar on every turn start ([b2eccf1](https://github.com/rajebdev/ompchamber/commit/b2eccf1126e35572f38dd216b77bb5b22de99fd7))
* **chat:** render builtin slash command output and settle the spinner ([25cb527](https://github.com/rajebdev/ompchamber/commit/25cb527345d008c510c449f173aec146aa500aae))
* **chat:** restore the stream status row on message_start frames ([4c68630](https://github.com/rajebdev/ompchamber/commit/4c68630f965a62dfb9d85206fbae899e645b072c))
* **settings:** surface omp builtin commands in the slash autocomplete ([0b47f43](https://github.com/rajebdev/ompchamber/commit/0b47f43192060ad508d3e86b3831d6bfdc247507))
* **terminal:** replace one-shot command runner with a real PTY shell ([f36ef40](https://github.com/rajebdev/ompchamber/commit/f36ef40e78de67083f6ef53aab1dbe91bb082fae))

### Changed

* add conventional commit type selection rules to AGENTS.md ([4589b94](https://github.com/rajebdev/ompchamber/commit/4589b94d6723e75debc4b523fa359c997a5ec269))

### Fixed

* **git:** refresh the tracking ref before counting ahead/behind ([b62da76](https://github.com/rajebdev/ompchamber/commit/b62da76b53dadc6aea34c9416d82c525eae55887))
* **sidebar:** spinner vanished for sessions re-streaming after a seen badge ([b442607](https://github.com/rajebdev/ompchamber/commit/b4426074559c204840dc794d7abb550ac659d67f))
* **stream-status:** derive terminal badge from turn stopReason, drop ambiguous error status ([1636647](https://github.com/rajebdev/ompchamber/commit/1636647e5c038a74dc1e12649d1319fe62ece1b1))

## [0.8.0](https://github.com/rajebdev/ompchamber/compare/v0.7.0...v0.8.0) — 2026-09-22

### Added

* **chat:** answer the ask tool inline with every question and answer ([92baa04](https://github.com/rajebdev/ompchamber/commit/92baa043b59c24731f84655502a6b333a8c5993f))
* **editor:** render long files lazily in the code surface ([fb30237](https://github.com/rajebdev/ompchamber/commit/fb302374a27499513015725f06851949a73a89d7))
* **markdown:** repaint mermaid diagrams on theme switch and open them in a zoom/pan viewer ([7b89852](https://github.com/rajebdev/ompchamber/commit/7b89852d59fe60bcbf5efaad922753da1e9ee2bd))
* **release:** credit contributors in the generated changelog ([af11d2a](https://github.com/rajebdev/ompchamber/commit/af11d2aaafb10286b722252fad9084ea4572a43a))
* **sidebar:** flag sessions waiting for input with an icon and a cue ([5253963](https://github.com/rajebdev/ompchamber/commit/52539636a2ede8205783ee420d5e9d0bd8bff569))

### Fixed

* **chat:** stop the thinking level resetting to off on send ([470d283](https://github.com/rajebdev/ompchamber/commit/470d2838774311c208e3d61e3e1cc8e0ec3cf065))
* **file-explorer:** refresh git status on the same triggers as the listing ([c983ac1](https://github.com/rajebdev/ompchamber/commit/c983ac1a97386991acc4025eb02e74b38ff78402))
* **rpc:** keep a session alive while it is blocked on a dialog ([cace9e3](https://github.com/rajebdev/ompchamber/commit/cace9e396e714b7074bd1b4c2128057250fb5ca3))

## [0.7.0](https://github.com/rajebdev/ompchamber/compare/v0.6.0...v0.7.0) — 2026-09-22

### Added

* **session:** mark the live stream status at prompt dispatch, not agent_start ([c148bc5](https://github.com/rajebdev/ompchamber/commit/c148bc5631cfcd2a034e05d650ee2a3ff0ea352a))
* **update:** restart the updated instance and leave servers started from source alone ([a25f8ca](https://github.com/rajebdev/ompchamber/commit/a25f8ca56727d59e8de606641e7cc5daee85dc9f))

### Changed

* **readme:** document the automatic restart and the source-run exception ([0ea1135](https://github.com/rajebdev/ompchamber/commit/0ea11350f56692cf8d6d30fd36d8759ba358eee2))

### Fixed

* **lifecycle:** record the launch mode from argv, never from the environment ([9697514](https://github.com/rajebdev/ompchamber/commit/9697514c3a32135308178e0025fb2a47d675bb43))

## [0.6.0](https://github.com/rajebdev/ompchamber/compare/v0.5.0...v0.6.0) — 2026-09-21

### Added

* **server:** guard ports and register every running instance ([5358864](https://github.com/rajebdev/ompchamber/commit/5358864d5c52e6fff12c95310b7d7402ceb45759))

### Fixed

* **editor:** keep content after autosave and align gutter with wrapped rows ([3f82fbe](https://github.com/rajebdev/ompchamber/commit/3f82fbeb00eeb4a5ae3c3956ac6c3c92361e86fb))
* **layout:** enforce panel floors, per-view defaults and sane widths ([49349e6](https://github.com/rajebdev/ompchamber/commit/49349e6df4d5f205d6a735598a61d0c115558cf2))
* **markdown:** stop mermaid leaking its syntax-error banner into the body ([1dd19e9](https://github.com/rajebdev/ompchamber/commit/1dd19e9c305b512abb803ceead977cc1eca2f540))
* **mobile:** keep the header session picker inside the viewport ([ac19515](https://github.com/rajebdev/ompchamber/commit/ac1951519b0cf88b02a48bd5a0bf18df138a1d51))
* **server:** serve public assets from the build output too ([5c694b8](https://github.com/rajebdev/ompchamber/commit/5c694b832650119d33826ef6832fe4960866eb42))

## [0.5.0] — 2026-09-21

MOCK flips to real data by default, a missing `omp` binary refuses startup instead of degrading into
a dashboard whose every action fails, and the MOCK chat transport drops its Gemini dependency.

### Added

- Startup gate: OMPChamber is a console for a **live** omp install — every agent session, config
  read/write, session-state query and update shells out to the `omp` CLI — so the binary is now a
  startup precondition rather than a degraded mode. `src/server/lib/omp/core/startup.ts` (new) holds
  `ompStartupError()` (the actionable refusal) and `ompStartupLogLines()` (the executable plus the
  `~/.omp` tree the process reads); `src/server/index.ts` runs the gate before the listener opens and
  before `getDb()` — the database is opened lazily, so a refused start never touches it — and
  `ompchamber serve` applies the same gate before spawning, so a failure leaves no detached child, no
  log file and no registry entry pointing at a process that already exited. `MOCK=true` is exempt:
  demo mode exists to run without a real install.
- Startup banner: the resolved paths every session/agent diagnostic traces back to — data mode, omp
  binary, config dir, agent dir, SQLite file, then the provider and model counts omp reports, with
  `listening` last. The registry probe is a live RPC round-trip (a cold utility process takes
  seconds), so it runs **after** the listener accepts requests: startup is never delayed, only the
  final banner line is, and the shared utility process is left warm for the first `/api/models` call.
  The provider count is the number of providers that actually serve a model — omp's login catalog
  lists 75 sign-in offers, 73 of them without credentials, and counting those would report a provider
  set the chamber cannot use — i.e. the same set `GET /api/models` groups by.
- `fetchOmpRegistrySnapshot()` (`src/server/lib/models/provider-registry.server.ts`) extracts the two
  RPC parses so the provider settings page and the startup banner read one implementation, guarded by
  `DetectedLoginProvider` instead of a structural assumption about the response.

### Changed

- **Breaking:** `OMP_WEB_OMP_BIN` is renamed **`OMPCHAMBER_OMP_BIN`**, matching the other host
  variables (`OMPCHAMBER_PORT`, `OMPCHAMBER_HOST`, `OMPCHAMBER_BUN`). The old name is no longer read,
  so an explicit binary path must move to the new variable or fall back to a `PATH` lookup.
  `README.md` and `ompchamber --help` document the requirement and the variable.
- `MOCK` now defaults to **real data**: `isMockMode()` (`src/server/mock.server.ts`) is true only for
  an explicit `true` / `1` / `on` / `yes`, and unset or unrecognized values run against real
  resources. The chamber is a diagnostic console for a live omp install, so demo presets are opted
  into rather than inherited by omission; `getMockModeInfo().rawEnv` reports `false (default)`.
  `.env.example`, `README.md` and `DESIGN.md` document the default, and
  `src/client/data/models/catalog.ts` now states its MOCK-only contract: `POST /api/models` in real
  mode starts from an empty catalog instead of seeding the shipped demo rows, so a demo model can
  never be persisted into a real install's stored catalog.
- MOCK chat streaming no longer calls a real Gemini endpoint — `onStart` always runs the simulated
  handler, so the demo transport has no network dependency and no API key to configure. The
  `!isMockMode()` 400 guard on `POST /api/chat/stream` is unchanged: real mode still has no streaming
  endpoint.

### Fixed

- Files panel: **Copy Path** copied a hard-coded template prefix —
  `'/app/applet/examples/' + file.path` — so every entry produced a path that resolves nowhere outside
  the original applet sandbox. The listing's absolute base was already in the payload (`/api/fs/dir`
  answers `root: baseDir`, the resolved workspace root or the selected `repo=` directory) and the
  client now keeps it in `listingRoot`, threading it down through `FileTreeItem`'s own child recursion
  as `basePath` so the base travels with the tree instead of being re-derived per node.
  `toAbsolutePath()` (`src/shared/lib/fs/paths.ts`, new) joins base and relative path with the base's
  own separator, strips only `/` and `./` prefixes — a dot-file name such as `.env` survives — and
  falls back to the relative path when no base is known, so a rejected listing degrades instead of
  inventing a root; anchoring on the server-resolved base also means a `~`-relative or
  allow-list-rejected client `rootPath` cannot yield a wrong absolute path. Both copy actions now go
  through `copyToClipboard()`, whose textarea fallback keeps copying working on an insecure origin
  where `navigator.clipboard` is undefined. Copy Relative Path is unchanged.

### Removed

- `@google/genai` — the SDK, its `GEMINI_API_KEY` env read and the dead handler that used them.
  `handleGeminiStreaming()` is deleted from `src/shared/lib/chat/stream-service.ts`, the real-Gemini
  branch from `src/server/routes/chat/stream.ts`, the key block from `.env.example`, and
  `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` from `metadata.json`. Provider model names in the catalogs
  and the generic `?key=` model-list probe in `routes/settings/provider-models.ts` are unrelated and
  untouched.

## [0.4.0] — 2026-09-21

### Added

- Files panel: entries git refuses to track now render dimmed — the icon at 40% opacity and the name at
  `text-ink/40` against the panel's `text-ink/80`, with a `<path> — git-ignored` tooltip; a live
  git-status colour still wins when both apply. `collectIgnoredPaths()`
  (`src/server/lib/fs/git-ignore.ts`) runs one `git check-ignore --stdin -z` **per directory listing**,
  never per entry, so local (`.gitignore`, `.git/info/exclude`) and global (`core.excludesFile`)
  rules are covered alike: paths travel NUL-separated over stdin, stdout is drained while stdin is
  written, and a non-zero exit (no match, not a repository, git absent) yields an empty set instead of
  an error. `listEntries` emits the verdict as `FsNode.ignored`, which the search filter and expanded
  children preserve.

### Changed

- Chat: tool output is now rendered as **markdown** wherever it is shown as a block (`FallbackOutput` and
  the `edit`/`write` card's Execution Output). An XML wrapper that opens the output — omp's
  `<system-reminder …>…</system-reminder>` — is peeled first, its attributes (`reason`, `rule`, `path`)
  become the block's header row, and content markdown would reflow (a log, a JSON body, an HTML dump) is
  fenced so it stays verbatim instead of collapsing into a single paragraph. A tool card whose result
  carried a reminder also flags it in the header: bell + red **Reminder** left of the status badge.
- Chat: the AI run footer (provider · model · date · duration · tokens · actions) is now the run's own
  boundary row instead of living inside the last answer bubble. It renders after every row the run owns
  — including notice rows omp wrote at its tail — so it is always immediately before the next user
  message, and a notice-only stretch never gets one. Placement is resolved once per timeline in
  `src/shared/lib/chat/timeline/run-footer.ts`; `MessageItem` no longer renders a footer and drops its
  footer-only props (`provider`, `providerNames`, `modelName`, `modelNames`, `thinkingLevel`,
  `footerVisible`, `durationMs`, `isMobile`, `onRetry`).
- Chat: the session sidebar refreshes on the run's **first completed assistant turn** instead of waiting
  for `agent_end` or the 8 s stream poll, so a session's real title and `updated_at` stop lagging a
  whole turn behind. A completed turn is the first point where the refresh can return anything new —
  omp writes the session JSONL (auto-title at line 1) at `message_end`, whereas a token-level signal
  would fire earlier and re-scan the same file — and the role check excludes `notice` rows, which
  include the `system-reminder` frames the live stream stamps on non-user rows. The per-run guard in
  `src/shared/lib/chat/omp/omp-callbacks.ts` is re-armed at `agent_start` and on stream reattach, so
  later assistant segments cannot keep resetting the throttle window.
- Client bundle: the three heaviest assets are no longer on paths most pages never touch. Mermaid 12
  made `elk` the default `layout`, so **ELK (1.48 MB raw / 434 kB gzip) is gone** — `layout: 'dagre'`
  is pinned in `mermaid.ts` (verified byte-identical across 20 diagram types) and `elkjs` is aliased
  to a stub that throws, because a diagram that explicitly asks for ELK should fail loudly rather than
  silently render with a different layout. **Shiki** stopped calling `loadAllLanguages()` at boot:
  `highlighter-lazy.ts` owns the policy — a grammar is fetched the first time a caller asks for that
  language, callers keep rendering synchronously on the plain-text fallback, and `onLanguageReady` /
  `useSyntaxReady` re-render them when the chunk lands. **KaTeX** left the critical path the way mermaid
  already had: `marked.ts` emits a `.math-pending` placeholder carrying the TeX source and `katex.ts`
  swaps in real markup after the async chunk arrives, with both DOMPurify traps handled (a bare
  root-level `<span>` is dropped, and `data-math*` must be allowlisted or hydration has nothing to
  read). KaTeX fonts are regenerated woff2-only and Fira Code is a latin-only face set, taking 1.8 MB
  of font files to 388 KB. Measured: initial payload 496 kB → 374 kB gzip, cold-boot chunk requests
  58+ → 20.
- Client bundle: the settings modal and the mobile layout are lazily loaded, since at most one of the
  two trees is ever used and the settings tree only appears behind a click — initial payload 374.4 kB
  → 252.6 kB gzip (-32.5%). `settings/LazyModal.tsx` is now the modal's single import path and its
  `isOpen` gate is load-bearing rather than cosmetic: `lazy()` starts fetching as soon as it renders,
  even when the wrapped component would render `null`, so without the gate the 68 modules plus the
  162 kB `omp-schema.json` would be requested at boot. `App.tsx` imports `MobileLayoutWrapper` lazily
  too, because `initialIsMobile` is known before the first render; the runtime "Switch to Mobile View"
  toggle still loads the chunk on demand, and `fallback={null}` is indistinguishable from the
  pre-hydration frame since `body` already paints `--theme-canvas`.

### Fixed

- Ordering: nothing reorders messages any more — neither the API nor the UI. `GET
  /api/chat/:sessionId` returns the session's messages in **file order**, and the timeline renders that
  array as-is, so a notice row appears exactly where omp wrote it. The server-side notice/turn swap,
  the five scattered display-side copies (`session-load` fetch + older-page prepend, rollback
  refetch, optimistic send, live stream folding) and `src/shared/lib/chat/order.ts` are gone.
- Chat: a `notice` row that kept the turn's own text is an **assistant answer**, not a card — omp
  sometimes writes the reply into `notice`, and the timeline rendered it as a collapsed System Notice
  with the answer hidden while the JSONL mapper deleted the tags that text quoted. One classifier
  (`src/shared/lib/chat/timeline/notice-row.ts`) now decides for the whole timeline: a notice row
  carrying the turn's metadata (model, provider, usage, `durationMs`, `startedAt`, `completedAt`,
  `thinking`, `toolCalls`) renders as content, with `thinkingLevel` excluded on purpose because the
  live stream stamps it on every non-user frame. The JSONL mapper and `messages-map.ts` likewise turn
  only a text block that **is** a reminder envelope into a notice, so prose quoting the tag stays
  content — and such a row owns its run footer and Copy action like any other AI row, so the turn's
  own usage finally surfaces.
- RPC: a command timeout no longer counts as proof the omp child has wedged. omp runs RPC handlers one
  at a time, so the `get_state` (5 s) and prompt-ack (30 s) caps also fired while a turn sat queued
  behind the child's own work, and the reset destroyed the live turn and every subagent under it. A
  timed-out command against a busy session now answers `session_busy` and leaves the child alone; only
  an idle, unresponsive session is reset, and `GET /api/agent/:id` answers a busy session from local
  flags so the attach probe cannot queue a `get_state` behind the running turn. Liveness also learned
  about subagents: `subagent-liveness` folds `subagent_lifecycle` / `progress` / `event` frames into a
  roster (identity is `id` with an index alias for id-less frames, and stale entries are pruned) and
  `AgentSessionWrapper#isBusy()` gates the idle reaper and `reconcileSpawnApprovalMode` on it, where
  `isRunning()` alone knew nothing about a subagent outliving its parent turn. With the automatic reset
  no longer covering a busy session, **Stop** escalates to an explicit `force_reset` after 10 s without
  a clean stop, and the client reattaches instead of auto-resending a prompt whose ack timed out — it
  may already have been accepted.

## [0.3.0] — 2026-09-21

### Added

- `ompchamber update` — self-update from GitHub releases, with `--check`, `--force` and
  `--no-restart`. The install is replaced in place: `bun add -g ompchamber@<version>` for a bun
  global install, or fetch + `--ff-only` merge to the release tag + `bun install` + client rebuild
  for a git checkout. A running instance is restarted on its recorded port and mode afterwards; an
  uncommitted work tree is never merged over.
- Install-method detection (`bun-global` / `git` / package-manager / unmanaged) shared by the CLI
  and the console, so an install that cannot replace itself reports the exact command to run.
- The console's **About → Updates** button now performs a real OMPChamber update instead of
  reporting it as manual, and the update check reads the version from disk so a completed update
  stops showing as available before the server restarts.
- `GITHUB_TOKEN` / `GH_TOKEN` is honoured for release lookups, raising the unauthenticated GitHub
  API rate limit (60/hour per IP).
- GitHub Actions publish pipeline (`.github/workflows/publish.yml`): publishing a GitHub release
  installs, typechecks, builds `dist/client`, verifies the release tag against the `package.json`
  version and runs `bun publish` against npm.

### Changed

- `package.json` is publishable: `private` removed, and `files` limits the tarball to `src`,
  `dist/client` and `tsconfig.json`.

## [0.2.0] — 2026-09-21

The stack rewrite release: **Remix + React 19 + Vite → Elysia + Preact + Rsbuild on Bun**, plus the
agent-stream WebSocket transport, Shiki highlighting, and a persistent message queue.

### Added

- Agent event stream over **WebSocket** (`GET /api/agent/:sessionId/ws`), selectable in
  Settings → Chats, with SSE as the fallback transport and a shared connection status indicator in
  the navbar and mobile header.
- **Shiki** syntax highlighting replacing PrismJS and ANSI-colored tool output — a dual
  `one-light` / `one-dark-pro` theme pair plus 26 more languages, consumed through
  `--shiki-light` / `--shiki-dark` CSS variables.
- Hand-rolled resizer (`group` / `panel` / `separator`) replacing `react-resizable-panels`, with
  one remembered pixel width per panel and per right-panel view.
- Hand-rolled Preact code editor replacing `react-simple-code-editor`.
- `lucide-preact` icons plus static brand SVGs replacing `react-icons`.
- Persistent message queue stored in a `queued_messages` table with a model snapshot, stop-all
  semantics and stick-to-bottom scroll.
- In-place **undo / rewind** for omp sessions by truncating the session JSONL, behind a
  confirmation modal.
- Structured MCP tool renderer with per-key JSON display, and a renderer for omp hashline edit
  patches.
- Ripgrep-backed search panel streaming matches over SSE as the tree is walked.
- Behavior settings panel bound to native `AGENTS.md` and `RULES.md`, and the full native omp
  config schema in the OMP Engine panel.
- Server-side pagination for the Context panel raw-message list, with telemetry auto-reload while
  a session is streaming.
- Auto-refresh of open file panels on AI file-mutating tools, and of the sidebar when a response
  starts.
- Server-authoritative per-session stream status in the sidebar, plus a workspace sort comparator
  shared between client and server.
- Provider metadata (display label, timestamps) threaded through timelines and rendered in the
  message footer.
- Mobile view running the shared chat timeline, with a root menu for AI messages.
- `bun run dev:lan` to expose the dev server on the LAN.

### Changed

- Runtime is Bun-only end to end: `bun:sqlite` replaces `sqlite3`, `Bun.spawn` / `Bun.spawnSync`
  replace every `node:child_process` call site, `Bun.YAML` replaces the `yaml` package,
  `Bun.gzipSync` / `Bun.file` / `Bun.Glob` replace their `node:` equivalents, and the omp RPC layer
  reads NDJSON from a Bun `ReadableStream` instead of `node:readline`.
- Server is a single Elysia app shared by dev and prod; routes are grouped by domain with one
  plugin per domain, mounted from `src/server/routes/index.ts`.
- Client runs on Preact 10 — zero React packages in the dependency tree.
- Modules are split three ways (`src/client`, `src/server`, `src/shared`) with the `@/` alias
  mandatory: no relative imports, no re-export barrels.
- CLI moved from `bin/` to `src/cli/` and stripped of Node builtins; it resolves its data
  directory through `os.homedir()` so paths stay absolute without a shell.
- omp config, session and subagent layers converted from synchronous fs to async `Bun.file`.
- Persisted settings live exclusively in SQLite — the single source of truth.
- Syntax colors are the only chroma outside dark themes; every other surface uses theme tokens.

### Removed

- React packages: `react`, `react-dom`, `react-icons`, `react-markdown`,
  `react-resizable-panels`, `react-simple-code-editor`, `motion`, `lucide-react`, `prismjs`.
- Build tooling: `@remix-run/*`, `vite`, `@tailwindcss/vite`, `autoprefixer`,
  `remix-flat-routes`, `vite-plugin-pwa`, `@resvg/resvg-js`.
- Markdown extras: `rehype-raw`, `remark-gfm`.
- Data helpers: `sqlite`, `sqlite3`, `yaml`, `isbot`.

### Fixed

- Layout: right-panel view and editor-mode switches restore the panel's remembered width instead
  of snapping back to a default, and fixed panels shrink correctly when the container is squeezed.
- omp: tool output keeps its whitespace when a JSONL session is reloaded; the adopted session id is
  used when a stream ends in error, so the sidebar refreshes; the DevTools port is probed before a
  stale browser endpoint file is trusted; directory guards use `stat`, ending silent project-path
  probe failures.
- CLI: home resolves through `os.homedir()`, keeping `stop` / `status` pointed at the real
  `~/.ompchamber` when `HOME` is absent (cron, launchd, GUI launchers).
- Dev loop: hot-update artifacts are proxied on any path, lazy compilation is disabled to stop HMR
  trigger 404s, and dev assets are served `no-store` so a stale bundle cannot pin in the browser.
- Terminal reports real runtime versions instead of hardcoded strings.
- Providers can be disabled, removing them from the model list; the model picker starts empty and
  shows a loading skeleton.

## [0.1.0] — 2026-09-14

Initial public snapshot on the Remix + React + Vite stack.

### Added

- Workspace and session sidebar over omp's project registry.
- Streaming chat timeline with thinking accordions, tool-call cards and a composer.
- Editor panel plus right-hand developer panels: context telemetry, files, search, git, terminal,
  browser, and the mobile layout.
- SQLite-backed settings, and the `MOCK=true` / `MOCK=false` demo-versus-real data modes.
- `ompchamber` CLI: `serve`, `stop`, `restart`, `status`, `logs`.

[0.5.0]: https://github.com/rajebdev/ompchamber/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/rajebdev/ompchamber/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rajebdev/ompchamber/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rajebdev/ompchamber/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rajebdev/ompchamber/releases/tag/v0.1.0
