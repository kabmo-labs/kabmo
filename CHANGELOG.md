# Changelog

All notable changes to Kabmo.

Kabmo starts at `0.0.1`. The pre-rename history (OMPChamber 0.x-4.x) is kept in [CHANGELOG-legacy.md](./CHANGELOG-legacy.md).

## [0.14.1](https://github.com/kabmo-labs/kabmo/compare/v0.14.0...v0.14.1) — 2026-10-30

### Fixed

* **chat:** keep a thinking block open when its row leaves the mount window ([231ab98](https://github.com/kabmo-labs/kabmo/commit/231ab98822f4c060bd8eb8428e3954ff756b43b1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **command-runner:** give a run the PATH a terminal would have ([8750ba2](https://github.com/kabmo-labs/kabmo/commit/8750ba2bb365c032aa2cc2d61ef1f38b141195cd)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** draw a viewBox-only SVG preview at a real size ([9177dca](https://github.com/kabmo-labs/kabmo/commit/9177dca76d5e81b16f751ffab8117ce210db1797)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** draw the phone drawer's folder header on its own surface, and size its rows like that header ([2e93c9a](https://github.com/kabmo-labs/kabmo/commit/2e93c9a70fa1e9d1cefb13b731547a110add4121)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.14.0](https://github.com/kabmo-labs/kabmo/compare/v0.13.0...v0.14.0) — 2026-10-30

### Added

* **chat:** let the composer draw in five selectable styles ([8695897](https://github.com/kabmo-labs/kabmo/commit/86958972d9bf28e3ae944887ab438e6fadc97b26)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** let the transcript draw tool calls in four selectable styles ([690e78f](https://github.com/kabmo-labs/kabmo/commit/690e78f3262d8787c30815ca25214c6a6e1a4e22)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** bump the pin to 18.14.0 and adopt the three surfaces it exposes ([e0747a1](https://github.com/kabmo-labs/kabmo/commit/e0747a1ad7952ab0dfd0c02b0759981dff32e4f4)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** group the Chats category into a master/detail sidebar ([c2c10eb](https://github.com/kabmo-labs/kabmo/commit/c2c10ebc96ddd902df0ba425f341979753c763ad)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** archive a session batch from the selection bar ([13159f1](https://github.com/kabmo-labs/kabmo/commit/13159f1b1d8cffeb06d16397c6434651909d85e3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** let the session sidebar draw a classic or modern chrome ([acab5e9](https://github.com/kabmo-labs/kabmo/commit/acab5e9bb814a23e034d4fd737ae24fc4939982d)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **server:** move the post-listen boot into its own module ([24c2da3](https://github.com/kabmo-labs/kabmo/commit/24c2da31c7a7695b0bc56c7fa55cad453e63d9aa)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **composer:** name the provider of a shared model in the favorites and recent rails ([1e8c1e0](https://github.com/kabmo-labs/kabmo/commit/1e8c1e0a9ea39b6c78e24e124d2f815630bb3a3d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** keep a folded block unfoldable on WebKit and steady the E2E layer ([e5be69e](https://github.com/kabmo-labs/kabmo/commit/e5be69e2db82e62c5f50d2ed7e40b029afef1992)) (thanks [@rajebdev](https://github.com/rajebdev))
* **plugins:** contain a background service's rejection instead of exiting ([e109f15](https://github.com/kabmo-labs/kabmo/commit/e109f158c6b9287c7bd2dddb220b793aa27c6d74)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.13.0](https://github.com/kabmo-labs/kabmo/compare/v0.12.0...v0.13.0) — 2026-10-29

### Added

* **chat:** add compact, wide and full width modes to the conversation ([97bc64b](https://github.com/kabmo-labs/kabmo/commit/97bc64ba0e2d2b937675c2069681861445247aba)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** grow the prompt box to seven lines, then scroll ([4a2fd03](https://github.com/kabmo-labs/kabmo/commit/4a2fd0317fca52956a06c559b50e17ef3f5641cc)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **browser:** paint screencast frames into a canvas and bound the editor cache ([0f82a64](https://github.com/kabmo-labs/kabmo/commit/0f82a64ff09228a6b082f0df4cc4c16a70880f25)) (thanks [@rajebdev](https://github.com/rajebdev))
* **git-forge:** drop the navbar readout, leaving the panel as the only surface ([cc20db7](https://github.com/kabmo-labs/kabmo/commit/cc20db7997aa29015567ea96b19491671bf4cc57)) (thanks [@rajebdev](https://github.com/rajebdev))
* **server:** answer the session model and thinking level from the file tail ([0f22b48](https://github.com/kabmo-labs/kabmo/commit/0f22b48277e2da2a5bed5d09f51bd37656c2e25d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **server:** collect once the process passes a memory ceiling ([ae3ffee](https://github.com/kabmo-labs/kabmo/commit/ae3ffee6567723c43912409c6d15d3d08bdd433a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **terminal:** release the WebGL context while the panel is hidden ([01a678b](https://github.com/kabmo-labs/kabmo/commit/01a678bea172b42de4d253516e39f25c9c89230c)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **android:** trim the WebView when the system reports memory pressure ([a0b27aa](https://github.com/kabmo-labs/kabmo/commit/a0b27aa1d9e6edbf30d7b585b7e07ef1fbfb8b8e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **build:** align bun-types with the 1.4.4 runtime ([ed0e321](https://github.com/kabmo-labs/kabmo/commit/ed0e321b40354c4ce96d0061da401977782b2ba0)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** land the jump rail on the clicked turn ([dd1e5bf](https://github.com/kabmo-labs/kabmo/commit/dd1e5bf65313137bab80fdad040320b554a504bd)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#60](https://github.com/kabmo-labs/kabmo/issues/60)
* **composer:** line the picker's provider mark up with the row grips ([529a74f](https://github.com/kabmo-labs/kabmo/commit/529a74fb0d5cb3051f66d829d7989023dcee110c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** put the picker's chevron on the stars' axis ([9bc871f](https://github.com/kabmo-labs/kabmo/commit/9bc871f101345d0356a5fef403fcb52abe7347ea)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** remember folded picker sections across chats ([3bee458](https://github.com/kabmo-labs/kabmo/commit/3bee4583de7ae7d8ef12719add5d97d57af8bb96)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** tidy the model hover card and anchor it to its row ([3becfe2](https://github.com/kabmo-labs/kabmo/commit/3becfe20a00a1e4d84d35ba1286db39a4212c5da)) (thanks [@rajebdev](https://github.com/rajebdev))
* **git-forge:** read a GitLab credential, and stop hiding merged requests ([b36c8bc](https://github.com/kabmo-labs/kabmo/commit/b36c8bc28f43dc3666d78c61cafd9b4a99ee67c1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ios:** reload the console when the OS kills the web process ([d478af2](https://github.com/kabmo-labs/kabmo/commit/d478af2e568c7a207f7598b4b89e234eba39ac0e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **linux:** reach the memory-pressure policy through the lib crate ([f8193d0](https://github.com/kabmo-labs/kabmo/commit/f8193d01da20c13c6ec817e58c993b0422bba42d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **linux:** tell WebKitGTK when the web process should trim ([f0f86ec](https://github.com/kabmo-labs/kabmo/commit/f0f86ecef0de1313793235dcc743e13652e00324)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** reload the console when the OS kills the web process ([42e6201](https://github.com/kabmo-labs/kabmo/commit/42e620180f021c0d388745f76ea122366b547d6d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **plugins:** retry a plugin call that landed in a restart's boot window ([918e7b9](https://github.com/kabmo-labs/kabmo/commit/918e7b9ce1ed6d3198549ef906ddb55d0fcf4ba2)) (thanks [@rajebdev](https://github.com/rajebdev))
* **plugins:** stop a plugin's throw from drawing the app twice ([4fb04d8](https://github.com/kabmo-labs/kabmo/commit/4fb04d8f5458c8df0c1a72e06987b382f502c518)) (thanks [@rajebdev](https://github.com/rajebdev))
* **providers:** read a provider icon from its base domain too ([1d14cb9](https://github.com/kabmo-labs/kabmo/commit/1d14cb98ec04699b024357c823e6c285848d9a85)) (thanks [@rajebdev](https://github.com/rajebdev))
* **scrollbars:** bind an arm to the container the input landed in ([a071d2c](https://github.com/kabmo-labs/kabmo/commit/a071d2cf75808eab5252fd2a1c0d9311f9f4b220)) (thanks [@rajebdev](https://github.com/rajebdev))
* **scrollbars:** keep a user's scroll inside the reveal gate when a frame runs long ([13b66ce](https://github.com/kabmo-labs/kabmo/commit/13b66ce70ebcddd9391e33fc92a1e4e3a5cb29f2)) (thanks [@rajebdev](https://github.com/rajebdev))
* **scrollbars:** make one input arm one reveal, so a blocked frame cannot swallow it ([c4968c2](https://github.com/kabmo-labs/kabmo/commit/c4968c2d55a01b2fea7b90812e0d6b99d41dc451)) (thanks [@rajebdev](https://github.com/rajebdev))
* **test:** make the two Windows-only assertions answer on Windows ([fb07699](https://github.com/kabmo-labs/kabmo/commit/fb07699eee8f16e7a653417c771befd560da9d0f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **test:** pin the stub-cache age floor to whole-second timestamps ([22e9982](https://github.com/kabmo-labs/kabmo/commit/22e998233476ba88cb4c717942d3c33e757b57d0)) (thanks [@rajebdev](https://github.com/rajebdev))
* **test:** remove the temp directories unit suites left in $TMPDIR ([add4f2e](https://github.com/kabmo-labs/kabmo/commit/add4f2ebde7be1343cd3cad4ed0c0ded1b38ceb0)) (thanks [@rajebdev](https://github.com/rajebdev))
* **test:** stop the compiled-fixture cache growing on every run ([2fc00a6](https://github.com/kabmo-labs/kabmo/commit/2fc00a644694d5d1c8e6b94f43f3d0b3b796bb9b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **windows:** lower the webview's memory target while minimised ([9049bd5](https://github.com/kabmo-labs/kabmo/commit/9049bd5d3b70484bde04214a9619905b96463646)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.12.0](https://github.com/kabmo-labs/kabmo/compare/v0.11.1...v0.12.0) — 2026-10-28

### Added

* **composer:** draw the picker with provider logos on an aligned grid ([f1c522e](https://github.com/kabmo-labs/kabmo/commit/f1c522e4b68d4d31a432b8c4539d59f38baf1987)) (thanks [@rajebdev](https://github.com/rajebdev))
* **diff:** step through changed hunks from the diff toolbar ([bf36f31](https://github.com/kabmo-labs/kabmo/commit/bf36f31e2b4f9781c002f5cb23663df545349384)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** show git line blame on hover, with the line's own history ([f86b9d0](https://github.com/kabmo-labs/kabmo/commit/f86b9d0ec9279a1c41e3643e67fa4f35a62ab31d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** validate config files, band conflict markers, and report plugin errors ([e607646](https://github.com/kabmo-labs/kabmo/commit/e607646fdedb837752eefeba71ae256bd76d403a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **git-panel:** toast the outcome of a Source Control action ([e50d693](https://github.com/kabmo-labs/kabmo/commit/e50d6931cc4b0be2ffe7e6d816168848bc447c03)) (thanks [@rajebdev](https://github.com/rajebdev))
* **marketplace:** add the forge credential sheet and its write-scope probe ([41d5718](https://github.com/kabmo-labs/kabmo/commit/41d57182bc8c8e67e0a0e1ac8ae2bdbc5ae8b212)) (thanks [@rajebdev](https://github.com/rajebdev))
* **marketplace:** add the git-forge plugin for issues, requests and releases ([4848360](https://github.com/kabmo-labs/kabmo/commit/4848360881ba0dd5aa346e826f41d5dc56497033)) (thanks [@rajebdev](https://github.com/rajebdev))
* **marketplace:** give the forge plugin filters, CI, change review and writes ([0add3f5](https://github.com/kabmo-labs/kabmo/commit/0add3f5618b3dc8b643d37d2690b0236d8dd848f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **panel-plugins:** report source, author, versions and placement on cards ([582f824](https://github.com/kabmo-labs/kabmo/commit/582f8245f4d3c16b18d85a960b9d317e4f6b93aa)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** add a provider-list refresh control and a loading spinner ([2dafcbc](https://github.com/kabmo-labs/kabmo/commit/2dafcbc3005138bf2b6079c2d9f2e0d4ffb5b11c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** draw a models.yml provider with its own site's favicon ([31da1ed](https://github.com/kabmo-labs/kabmo/commit/31da1edd5af42c53845e07c2306d865874817e1a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** make the provider panel write what omp actually reads ([61acdb2](https://github.com/kabmo-labs/kabmo/commit/61acdb264b3ab632b0e307a947098f60e3b97d73)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** open documents from the OS in every shell ([15948bb](https://github.com/kabmo-labs/kabmo/commit/15948bb0c2499ae767709ace3cbb7986ef906c1a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** open the workspace that holds a streaming or brand-new chat ([0b7c47e](https://github.com/kabmo-labs/kabmo/commit/0b7c47e73ac841872a975d4acb969ec1b83aaae8)) (thanks [@rajebdev](https://github.com/rajebdev))
* **usage:** draw both Usage surfaces with the provider's own web icon ([28d5822](https://github.com/kabmo-labs/kabmo/commit/28d5822860ec57e78c281f82717a938773a620d4)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* move the subsystem manual into the wiki ([ecde722](https://github.com/kabmo-labs/kabmo/commit/ecde722265071a0a22385c5a19f26c2e107cd59b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** drop the provider row's status dot and delete button ([9cacc39](https://github.com/kabmo-labs/kabmo/commit/9cacc393f0263b9e0f9e3f902ce9515fa1bc4169)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** keep the wait card when its result is not in the transcript ([fa20bff](https://github.com/kabmo-labs/kabmo/commit/fa20bfffa78d8132fc324786625254a1de8bc1a9)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** refresh the model picker on provider changes and persist collapsed sections ([2f47636](https://github.com/kabmo-labs/kabmo/commit/2f476361c44529d64c7276c15f77b09c9d1679e2)) (thanks [@rajebdev](https://github.com/rajebdev))
* **db:** return the slot's own promise so a failed open is observed ([9de7154](https://github.com/kabmo-labs/kabmo/commit/9de7154eceeeb3282a5d0cdd9c91d1133c1fcd84)) (thanks [@rajebdev](https://github.com/rajebdev))
* **diff:** keep the shape control on the row at the panel floor ([0266983](https://github.com/kabmo-labs/kabmo/commit/0266983277103e4b61ccc577c61069673d6372b3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** keep Save as ahead of the reading aids on the row ([cffb220](https://github.com/kabmo-labs/kabmo/commit/cffb2204748e6e441b0af685df9e3362b7f8c9cd)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ios:** take no suggested name for a delivered document ([23f3b3a](https://github.com/kabmo-labs/kabmo/commit/23f3b3aee71a23a1cdc2d25a2096c02f97beadb4)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#if](https://github.com/kabmo-labs/kabmo/issues/if)
* **linux:** match the Exec line the installer actually writes ([7ac9b45](https://github.com/kabmo-labs/kabmo/commit/7ac9b452ff982c698ad3640f23f78cac5c7a61f5)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#if](https://github.com/kabmo-labs/kabmo/issues/if)
* **markdown:** bind the sanitizer to the live window, not the import ([7eca11b](https://github.com/kabmo-labs/kabmo/commit/7eca11bf292f42f66f16114184fd8a49fe6d022d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **marketplace:** list git-forge in the curated catalog, and bind the file to the tree ([bcd7174](https://github.com/kabmo-labs/kabmo/commit/bcd717467d834b9e56562528ece4df8a9fb64cd2)) (thanks [@rajebdev](https://github.com/rajebdev))
* **marketplace:** read the forge sub-resources from where each host keeps them ([0514bdc](https://github.com/kabmo-labs/kabmo/commit/0514bdcda30200e63b70fbad52ebbddf479befa5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **prewarm:** carry the live access mode so the prewarmed child is claimed ([afd6ccc](https://github.com/kabmo-labs/kabmo/commit/afd6cccc1b6a19bb4dd3d75319495a094d5da690)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** drop an unused import that fails the no-unused gate ([17c20e0](https://github.com/kabmo-labs/kabmo/commit/17c20e0cdcf01295667f2b5b424291ed3cf68d5d)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.11.1](https://github.com/kabmo-labs/kabmo/compare/v0.11.0...v0.11.1) — 2026-10-27

### Fixed

* **omp:** resume a session whose recorded model is gone, and report a refused send ([27bf161](https://github.com/kabmo-labs/kabmo/commit/27bf16181e9d7a1ef50aa1efb4977aff7e818f37)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.11.0](https://github.com/kabmo-labs/kabmo/compare/v0.10.1...v0.11.0) — 2026-10-27

### Added

* **diff-panel:** fold brace blocks and highlight the matched pair ([ab9cf96](https://github.com/kabmo-labs/kabmo/commit/ab9cf96bfdbd52efd5f7eaf3556016fd932c5262)) (thanks [@rajebdev](https://github.com/rajebdev))
* **git-panel:** offer repository init when the folder is not a repo ([be5af8b](https://github.com/kabmo-labs/kabmo/commit/be5af8bdc72a84b464ee2d8741fc35f2fcda4c87)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** adopt 18.13.0 running-task telemetry and bump the pin ([dd75856](https://github.com/kabmo-labs/kabmo/commit/dd758562b33dcc5ed93be847d693b3907d360dcd)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** bump the pin to 18.13.1 and fix the approval gate it exposed ([c415464](https://github.com/kabmo-labs/kabmo/commit/c4154647a5452bf371c92597aee018a556d05161)) (thanks [@rajebdev](https://github.com/rajebdev))
* **release:** bump each artifact group in one commit ([52ce0ba](https://github.com/kabmo-labs/kabmo/commit/52ce0ba672b5540d4dff9c6fd3cf737dd8f92ee3)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **shells:** record the quit reply route and the GTK loop rule ([5ad90aa](https://github.com/kabmo-labs/kabmo/commit/5ad90aa830c07a211dab0209cd055695ff481979)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** render omp developer turns as a system notice on reload ([79ac3ff](https://github.com/kabmo-labs/kabmo/commit/79ac3ff9c05facb4a7fc1844e57341add00a2233)) (thanks [@rajebdev](https://github.com/rajebdev))
* **linux:** keep the GTK loop free while a server starts or updates ([b38e7b8](https://github.com/kabmo-labs/kabmo/commit/b38e7b86409c0992f48bd63b92efc75f1d4f3ecf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** deliver the quit reply on the main run loop ([323fb27](https://github.com/kabmo-labs/kabmo/commit/323fb2728b8151dab7ff9e43e54a9c182aea09e8)) (thanks [@rajebdev](https://github.com/rajebdev))
* **windows:** bound the taskkill wait on the quit path ([7c369a1](https://github.com/kabmo-labs/kabmo/commit/7c369a12272c7c2fe4330a823c1a1fcbdad18bc9)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.10.1](https://github.com/kabmo-labs/kabmo/compare/v0.10.0...v0.10.1) — 2026-10-27

### Fixed

* **editor:** hang the bracket guide from the pair's leftmost brace ([f5d1e85](https://github.com/kabmo-labs/kabmo/commit/f5d1e859959cadb5b9ae4d24922ce4b4e42c8b20)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** keep a markdown preview open when an outline row is clicked ([808bd1b](https://github.com/kabmo-labs/kabmo/commit/808bd1b74fb77e2a2ae1d54ff1f0d3b384064083)) (thanks [@rajebdev](https://github.com/rajebdev))
* **linux:** call run_javascript with its one callback argument ([b74a96f](https://github.com/kabmo-labs/kabmo/commit/b74a96fabeedd05161bc8cfb90e3226d778dea51)) (thanks [@rajebdev](https://github.com/rajebdev))
* **mobile:** scroll the active panel chip into view ([5bcd887](https://github.com/kabmo-labs/kabmo/commit/5bcd887077402d4d27dcf002e25fbe94e130fe6a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **scrollbars:** stop the reveal from re-arming on programmatic scrolls ([a98d848](https://github.com/kabmo-labs/kabmo/commit/a98d848c52a936cdb5be6da03acbdafd3cd6570b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** paint every loading overlay from the active theme ([2e44585](https://github.com/kabmo-labs/kabmo/commit/2e44585ca6f147cfc25c6f7b12b432fd3df76118)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** draw the APK control's glyph on the phone footer ([91508ea](https://github.com/kabmo-labs/kabmo/commit/91508ea813bdffb21488735032199479968d7f3c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **tool-renderers:** align every code gutter with its code ([39b7442](https://github.com/kabmo-labs/kabmo/commit/39b7442019053c972845a8ea8ef8e2777789bc50)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.10.0](https://github.com/kabmo-labs/kabmo/compare/v0.9.0...v0.10.0) — 2026-10-26

### Added

* **editor:** add Save As and the split editor ([d61c7ec](https://github.com/kabmo-labs/kabmo/commit/d61c7ec0602bfdaef8fd3eff0e72c6fee8d0d3cb)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** close the editor panel's gaps — indent, data loss, tabs, typing ([f9739f2](https://github.com/kabmo-labs/kabmo/commit/f9739f263c7174c14db2db0078d82ac7f6ecf410)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** draw the bracket pair guide and parse with stream languages ([ae31841](https://github.com/kabmo-labs/kabmo/commit/ae31841113a274b6dab0d0708898ee312cc3b570)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** fold blocks and match brackets without a grammar ([07c3843](https://github.com/kabmo-labs/kabmo/commit/07c384398a08d59d6c4c1d0a034721059b0bbac1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **files:** collapse single-child folder chains into one row ([46d9787](https://github.com/kabmo-labs/kabmo/commit/46d9787e24bef73a7c49fd6262c9e5002efa7a1a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **release:** publish the packages to GitHub Packages as a second, manual destination ([391352d](https://github.com/kabmo-labs/kabmo/commit/391352d302d75bfb0b78830abce25c3ba32f52ba)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** clear the drop overlay instead of counting nested drags ([f7fc85f](https://github.com/kabmo-labs/kabmo/commit/f7fc85f830020f7da70205504cf74723e4cfd4c0)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** let a tool diff scroll inside its card ([744543b](https://github.com/kabmo-labs/kabmo/commit/744543b74b10612a9ca4bab527f13fcfc7dd892d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** return the stretched composer to its dock on send, on both layouts ([45e1f9b](https://github.com/kabmo-labs/kabmo/commit/45e1f9b3f4b971c62f3ce66eb4019a6eeef2c666)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ci:** read the packument on stdin so Windows can skip published versions ([c4e4cd6](https://github.com/kabmo-labs/kabmo/commit/c4e4cd647c1bf2cbb442ba4c5516057ac6f52d10)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** give the web view its clipboard chords via an Edit menu ([9c72514](https://github.com/kabmo-labs/kabmo/commit/9c72514dc085afe1dec71efd2e94a5aea053c078)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** let the frame's resize band win over the page's drag region ([1de95f5](https://github.com/kabmo-labs/kabmo/commit/1de95f5d26391966f4257ecca2c1099fe67953c5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** open a dropped file by reading the shell's pasteboard ([2d88622](https://github.com/kabmo-labs/kabmo/commit/2d88622a6820e26ddf3ca25a1559795dae01f25e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** open the console settings modal from the menu bar ([e432bdb](https://github.com/kabmo-labs/kabmo/commit/e432bdb3572b87c2f91c845adcf5171f7b2a787e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **realtime:** repair a socket the browser never reported dead ([ee94bfb](https://github.com/kabmo-labs/kabmo/commit/ee94bfbf95830fbb608b0f57090e2e05af9b5e72)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** make the launch splash fill the window on macOS and Linux ([96c5bf3](https://github.com/kabmo-labs/kabmo/commit/96c5bf3d4372c5706d09403039efd46cd197996b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **toolbar:** make the overflow menu reachable and let the row fill its bar ([ab3cae5](https://github.com/kabmo-labs/kabmo/commit/ab3cae5599190652a9ec1e72aea29270b917057e)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.9.0](https://github.com/kabmo-labs/kabmo/compare/v0.8.0...v0.9.0) — 2026-10-25

### Added

* **editor:** add compact and full width modes to the editor and diff toolbars ([a775579](https://github.com/kabmo-labs/kabmo/commit/a775579d9b4441e83aec86ffbb39f20f01565956)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** give the code editor its own Shiki colour theme ([b3d6b20](https://github.com/kabmo-labs/kabmo/commit/b3d6b20a071e7f51c45563929c91ab832741c63c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** open text files up to 32 MiB ([dccaaa6](https://github.com/kabmo-labs/kabmo/commit/dccaaa69b64481fb2bed169df9bb4f3dd3b975f1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** replace the editing surface with CodeMirror 6 ([6fe0b7f](https://github.com/kabmo-labs/kabmo/commit/6fe0b7fc0fb0459e864bc7cb497cdb5295652d69)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shell:** let the desktop shells install their own updates ([3279572](https://github.com/kabmo-labs/kabmo/commit/32795729d3e031583ca6d2c6725535e79f0194c0)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#if](https://github.com/kabmo-labs/kabmo/issues/if)

### Changed

* **editor:** bound the outline and stop stringifying the document per keystroke ([8f5dd23](https://github.com/kabmo-labs/kabmo/commit/8f5dd237d6c0ec3a43664ec24c9ab7e8dd9d7034)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** drop the dead weight the CodeMirror migration left behind ([00053b6](https://github.com/kabmo-labs/kabmo/commit/00053b63e2a9cad7bd232ae1d7aee02d91fe5de3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** record what the CodeMirror migration review found ([9b10ad3](https://github.com/kabmo-labs/kabmo/commit/9b10ad33e0927263b6a8f0aebc6e2d372c29b25b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** publish a running session's activity instead of the whole list ([779af9e](https://github.com/kabmo-labs/kabmo/commit/779af9ef02344594de00b235b63f4834d20d6065)) (thanks [@rajebdev](https://github.com/rajebdev))
* **tool-renderers:** defer syntax highlighting off the expand tap ([9e47d9c](https://github.com/kabmo-labs/kabmo/commit/9e47d9cc6cb895b85b1c0d563853c7df0d63568a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **workspace:** split the session-state store under the size ceiling ([becf204](https://github.com/kabmo-labs/kabmo/commit/becf20441fcfa68d4cb276f68e1211a98b7037bc)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **auth:** let the native shells ask their update check without a session ([c11b144](https://github.com/kabmo-labs/kabmo/commit/c11b1441a4eb0f42829e9d88d5e7b17f0f14a69e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** keep a finished turn when a spawn adopts its id late, and fix two Windows paths ([a5363b3](https://github.com/kabmo-labs/kabmo/commit/a5363b349bb34aa9dec198bd7cd2e61aec00b85f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** recover a run whose terminal frames died with the socket ([58d13f0](https://github.com/kabmo-labs/kabmo/commit/58d13f0c337df9511ef5fb41d172d8d8a00e6ae4)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** compile find patterns with the cursor's own flags ([4cfcb33](https://github.com/kabmo-labs/kabmo/commit/4cfcb339ce9640e7c401e829f4acbdc777e17f16)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** keep the line's indentation on insert-line-above ([d07c4ea](https://github.com/kabmo-labs/kabmo/commit/d07c4ead5c3c280a95bfbe3a5acdf3a171fd75e1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** open a dropped file instead of inserting its text ([b34a830](https://github.com/kabmo-labs/kabmo/commit/b34a830713ee989b3b0988a614e9ffe5dcf2bffb)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** stop reading the document's re-anchoring as the reader's scroll ([567426d](https://github.com/kabmo-labs/kabmo/commit/567426d345dac9b681c6d59fa97b7593065588d3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **lifecycle:** probe every address a bind host stands for ([6434fd8](https://github.com/kabmo-labs/kabmo/commit/6434fd8fbb8f5c318b293e4d0b5438b03171fd3f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **linux:** keep `schedule_relaunch` out of the `impl Shell` block ([a43edd6](https://github.com/kabmo-labs/kabmo/commit/a43edd6487a24b255c75c2a00005e13780898f36)) (thanks [@rajebdev](https://github.com/rajebdev))
* **telemetry:** stop shipping the whole transcript on the telemetry topic ([32c0e62](https://github.com/kabmo-labs/kabmo/commit/32c0e62f8d91f9bf9385f43795e057a51c960ed0)) (thanks [@rajebdev](https://github.com/rajebdev))
* **workspace:** keep the editor's tabs across a transient root and a late read ([1ad94eb](https://github.com/kabmo-labs/kabmo/commit/1ad94ebd7db451e12dcacd0424bb2aa6343e254a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktree:** give the worktree its own dropdown, beside the workspace ([d1c60de](https://github.com/kabmo-labs/kabmo/commit/d1c60dee2996c2f830fad13fdb75a7acc0954516)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktree:** re-read the list after a create, and de-flake two specs ([8422389](https://github.com/kabmo-labs/kabmo/commit/8422389aa2195ce0b002a6581b0ab341295b871b)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.8.0](https://github.com/kabmo-labs/kabmo/compare/v0.7.0...v0.8.0) — 2026-10-23

### Added

* **files:** nested create and rename, New Folder, and a long-press menu on touch ([5c35f17](https://github.com/kabmo-labs/kabmo/commit/5c35f1767de16751fe9d11172f9bf007424d631d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** a check-for-update button on every native shell ([b329219](https://github.com/kabmo-labs/kabmo/commit/b32921947cf63aa8712a15c553e3a4dc2fa0f3a4)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** one launch splash on all five shells, drawn from the README wordmark ([8619f6b](https://github.com/kabmo-labs/kabmo/commit/8619f6b23b308fd47b49ec04141a9ae7a83937c8)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktree:** a chat is born in a git worktree, chosen before the first send ([01fe3ac](https://github.com/kabmo-labs/kabmo/commit/01fe3ac59282b5180e6672d5c39258fa1b8307df)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **agents:** three shell bugs, stated where the next edit will look ([b58fa04](https://github.com/kabmo-labs/kabmo/commit/b58fa04d058cb52378c6e252bd760a1ffa4603b8)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** plan the CodeMirror 6 replacement, with measurements ([079a63e](https://github.com/kabmo-labs/kabmo/commit/079a63e19505dd77427e0e9f0f9948d009fcbed3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** research transport security and QR pairing ([0bd0bf2](https://github.com/kabmo-labs/kabmo/commit/0bd0bf29f3f82786acf14288dba9c09869b44ae6)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** the caption buttons are a shared cluster's job ([88c531b](https://github.com/kabmo-labs/kabmo/commit/88c531bf8029c3cca4f3be36cad28389abe8d158)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** the desktop shells document the update offer they now have ([64542b8](https://github.com/kabmo-labs/kabmo/commit/64542b8ab8aafabc0913baaa2ab5ecdacd20378f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktree:** record the seven defects the port found, and what is out of scope ([a9d67cd](https://github.com/kabmo-labs/kabmo/commit/a9d67cd532374a9674744b296f93c7d554f98019)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** open a running eval card so its streamed output is visible ([3c1807e](https://github.com/kabmo-labs/kabmo/commit/3c1807e277149d66a577167d09c732e49b51c327)) (thanks [@rajebdev](https://github.com/rajebdev))
* **eval:** line the gutter up with the code it numbers ([930c0ff](https://github.com/kabmo-labs/kabmo/commit/930c0ffe9cec2b75a87433fa73af9bacdfc831bc)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ios:** the splash wordmark is drawn in sRGB, not Generic RGB ([ded47ac](https://github.com/kabmo-labs/kabmo/commit/ded47ac57ab5a2fb71278556ef38db71c3cbf630)) (thanks [@rajebdev](https://github.com/rajebdev))
* **linux,windows:** stop child servers without freezing the window ([5c0a1b5](https://github.com/kabmo-labs/kabmo/commit/5c0a1b5ce1d1137b0887bb6abcfe66a6ebf4d407)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** fail the window suite instead of hanging, and cap it at 120s ([61a7336](https://github.com/kabmo-labs/kabmo/commit/61a733641904f4fac0e1d1923ca280358f671057)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** let the traffic lights be clicked ([93bc11e](https://github.com/kabmo-labs/kabmo/commit/93bc11ecd38b5c78a6e76165b18b74b1482aca49)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** quit without freezing the window ([d795d44](https://github.com/kabmo-labs/kabmo/commit/d795d44756fb9cf1f2fd7ac3ffe839c6c5dcf369)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** stop the window suite hanging on a press into a traffic light ([69b20ca](https://github.com/kabmo-labs/kabmo/commit/69b20ca8235ffa17accbbfb5682e5b03374eaf6e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **panels:** apply bundled plugin updates when the store's version did not move ([08d024d](https://github.com/kabmo-labs/kabmo/commit/08d024db806dea008f10a66f9affe74f87876e5e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** a drag region must not swallow its own controls ([b0dcd17](https://github.com/kabmo-labs/kabmo/commit/b0dcd1750d6b36d5fc35bfd63d37bbb319affc20)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** resolve a folder's sessions through the canonical path ([cb74af8](https://github.com/kabmo-labs/kabmo/commit/cb74af8d160ac492f7b260273586ed1687a79500)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktree-modal:** seed the form on mount so the first paint is usable ([538ad34](https://github.com/kabmo-labs/kabmo/commit/538ad34a766521b9e539d18d1d05833aaa6430a5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktrees:** answer a dirty refusal with 409, not 400 ([3baa68a](https://github.com/kabmo-labs/kabmo/commit/3baa68aed06583408685ba055b6cbc8bc4e433e0)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktrees:** copy env files as files, and await the topology invalidation ([ba90775](https://github.com/kabmo-labs/kabmo/commit/ba9077599760dafa2097c23af40a9d6377c0c15d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktrees:** count chats in a worktree that lives outside the checkout ([64ec214](https://github.com/kabmo-labs/kabmo/commit/64ec214359b5a16d9e44585b5030e15546e23999)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktrees:** name a worktree by its last segment on any separator ([d21d0e0](https://github.com/kabmo-labs/kabmo/commit/d21d0e07f31df343d47a0bf000d054df57a51134)) (thanks [@rajebdev](https://github.com/rajebdev))
* **worktree:** the sidebar row reaches Category, and drop the dead dropdown local ([b6b5c2b](https://github.com/kabmo-labs/kabmo/commit/b6b5c2b0034048804b84f6d8231be622cabf51e9)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.7.0](https://github.com/kabmo-labs/kabmo/compare/v0.6.1...v0.7.0) — 2026-10-23

### Added

* **release:** build both architectures and every package format for the desktop shells ([bf020a7](https://github.com/kabmo-labs/kabmo/commit/bf020a7c11551753d7477b20333cb7276fbaaf60)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.6.1](https://github.com/kabmo-labs/kabmo/compare/v0.6.0...v0.6.1) — 2026-10-23

### Fixed

* **windows:** name GH_REPO on the attach step, which checks nothing out ([0ebc8ad](https://github.com/kabmo-labs/kabmo/commit/0ebc8adbcfc02f5395a4009f04eb501150504063)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.6.0](https://github.com/kabmo-labs/kabmo/compare/v0.5.3...v0.6.0) — 2026-10-23

### Added

* **ios:** a native iOS shell, and one update contract for both shells ([5f147d8](https://github.com/kabmo-labs/kabmo/commit/5f147d8b42d092cb327b34e0e767447fa694c757)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#if](https://github.com/kabmo-labs/kabmo/issues/if)
* **linux:** a native Linux shell, released by a version bump ([221f631](https://github.com/kabmo-labs/kabmo/commit/221f6318a018fe37a0df3816865cbb2c60c01f9b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** a native macOS shell, released by a version bump ([e7f60ea](https://github.com/kabmo-labs/kabmo/commit/e7f60ea9223a1e9a0a1da0ed9af4fcf9f954ca2c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** model role presets with a model picker per role ([57345d7](https://github.com/kabmo-labs/kabmo/commit/57345d70d204e11b6601b504adfae7351df5ccad)) (thanks [@rajebdev](https://github.com/rajebdev))
* **stats:** a CPU/RAM navbar readout that opens the panel ([3d8b48e](https://github.com/kabmo-labs/kabmo/commit/3d8b48e87e9f090cc9c4b9a050feada7ed73b4fc)) (thanks [@rajebdev](https://github.com/rajebdev))
* **windows:** a native Windows shell, released by a version bump ([383adbc](https://github.com/kabmo-labs/kabmo/commit/383adbc8ce03c5a715c948152f1e49ef06d1face)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **desktop-layout:** extract the workspace keybindings ([17b493a](https://github.com/kabmo-labs/kabmo/commit/17b493af23ed8e71915835ad4e90bf255469684e)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** always title a session after its first run, on the session's model ([e5eebb8](https://github.com/kabmo-labs/kabmo/commit/e5eebb8e63600495d16dd93f8817b4ad03f33c05)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ci:** pin working-tree line endings, and await the db close before deleting ([0c7de50](https://github.com/kabmo-labs/kabmo/commit/0c7de50315e62f997ca2e6324f80e05cfd11c723)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** assert the drag against the screen's own constraint, not a raw origin ([fc3cd2e](https://github.com/kabmo-labs/kabmo/commit/fc3cd2e3896d4806094883d6c7feed32bce4df5e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **macos:** rename the app entry point off main.swift so [@main](https://github.com/main) compiles ([eb58e98](https://github.com/kabmo-labs/kabmo/commit/eb58e984c956acd86d3688b8209597a989b60527)) (thanks [@rajebdev](https://github.com/rajebdev))
* **mobile:** tighten a closed workspace folder to the list row rhythm ([230fb65](https://github.com/kabmo-labs/kabmo/commit/230fb65d2ed7fba8418b71651794d17bd280acb5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **queue:** keep the session receiver on a queued dispatch ([07d187d](https://github.com/kabmo-labs/kabmo/commit/07d187d9f6ba928e10f4f08c19d338db7dde8e09)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.5.3](https://github.com/kabmo-labs/kabmo/compare/v0.5.2...v0.5.3) — 2026-10-22

### Fixed

* **mobile:** draw the left dock strip whenever its rail is on ([5d37e0d](https://github.com/kabmo-labs/kabmo/commit/5d37e0d83bb89c224a71c5c7764fc14721d64ac0)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.5.2](https://github.com/kabmo-labs/kabmo/compare/v0.5.1...v0.5.2) — 2026-10-22

### Fixed

* **e2e:** gate the wait spec on the composer, not the sidebar row ([8bba8f0](https://github.com/kabmo-labs/kabmo/commit/8bba8f0121df5a2ebea5ff38d7813b5afd148b0f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **e2e:** gate the wait spec on the spawn's adoption ([339d151](https://github.com/kabmo-labs/kabmo/commit/339d1518190ffc449a91c5370b97347a80ed9d0e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **e2e:** size the wait picker's budget against the dependency's window ([fd76fcd](https://github.com/kabmo-labs/kabmo/commit/fd76fcd3fcd0b5f52d5b6d9d484f49f55ef108ad)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.5.1](https://github.com/kabmo-labs/kabmo/compare/v0.5.0...v0.5.1) — 2026-10-22

### Fixed

* **ci:** give the APK attach a repository to upload to ([eadc3bb](https://github.com/kabmo-labs/kabmo/commit/eadc3bb051ab7f9927ac3ab5a17e88c5d3b7b597)) (thanks [@rajebdev](https://github.com/rajebdev))
* **e2e:** give the wait picker a window longer than its own gate ([4a261cd](https://github.com/kabmo-labs/kabmo/commit/4a261cdfecdee67a4ae4355f08b51145e02d0696)) (thanks [@rajebdev](https://github.com/rajebdev))

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
