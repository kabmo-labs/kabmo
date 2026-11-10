# Changelog

All notable changes to Kabmo.

Kabmo starts at `0.0.1`. The pre-rename history (OMPChamber 0.x-4.x) is kept in [CHANGELOG-legacy.md](./CHANGELOG-legacy.md).

## [0.26.0](https://github.com/kabmo-labs/kabmo/compare/v0.25.0...v0.26.0) — 2026-11-10

### Added

* **chat:** add fork action to assistant run footer ([0f5717f](https://github.com/kabmo-labs/kabmo/commit/0f5717f04e8ea53e2c43f01015caeda727f5c111)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** offer the ACP agent's own session modes ([f4d93a8](https://github.com/kabmo-labs/kabmo/commit/f4d93a8f99ad386f385a24ecee596b70910826a1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** queue a second update and probe the new version after it ([ae4c900](https://github.com/kabmo-labs/kabmo/commit/ae4c900e818a55f22269fbba1918fab5856c3375)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** support ACP v1 and v2 side by side ([e81ec32](https://github.com/kabmo-labs/kabmo/commit/e81ec32c1f7562669746b4a1c098d57bc6aeec87)) (thanks [@rajebdev](https://github.com/rajebdev))
* **notifications:** notify finished, waiting-for-input and failed runs ([ecdc241](https://github.com/kabmo-labs/kabmo/commit/ecdc2419128356b3dd9e0c5249c9ae805545daa1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sessions:** start child and fork chats from the pending composer ([169a037](https://github.com/kabmo-labs/kabmo/commit/169a03784127671f3645aa4a88064425b5332d0d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** draw child sessions and subagents as one tree branch ([95ed6dc](https://github.com/kabmo-labs/kabmo/commit/95ed6dc9581a6d9c9bf62c172fa220d6c5b39980)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **composer:** show the ACP mode selector after a cold chat spawns ([3bc1dc8](https://github.com/kabmo-labs/kabmo/commit/3bc1dc8b1cf667ec6434f4e875f701892b81c31a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness/acp:** stamp message timing for the assistant footer ([065e164](https://github.com/kabmo-labs/kabmo/commit/065e1645456110af6be0467b72b8b4faa4f09fc2)) (thanks [@rajebdev](https://github.com/rajebdev))
* **windows:** let WinForms own the DPI declaration ([b172b85](https://github.com/kabmo-labs/kabmo/commit/b172b85952f6efaa5890df8e74eaec58f3961800)) (thanks [@rajebdev](https://github.com/rajebdev))
* **windows:** name the WPF types the WinForms globals shadow ([3d288ed](https://github.com/kabmo-labs/kabmo/commit/3d288ed9a7a0dd38b001659d5636d19a3bc71220)) (thanks [@rajebdev](https://github.com/rajebdev))
* **windows:** stop WinForms' implicit usings colliding with WPF's ([a25fc9d](https://github.com/kabmo-labs/kabmo/commit/a25fc9d4938a9499449058850db0d4523a0d3759)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.25.0](https://github.com/kabmo-labs/kabmo/compare/v0.24.0...v0.25.0) — 2026-11-10

### Added

* **chat:** orchestrate workers from [@harness](https://github.com/harness) mentions ([2305bbc](https://github.com/kabmo-labs/kabmo/commit/2305bbc23feb66edfcaf31923ba4ceb190be5c0a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** run harness updates as a background job with a readable log ([505bcdf](https://github.com/kabmo-labs/kabmo/commit/505bcdfcdecc52a751f406116d82f25947cb3b80)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** bump the pin to 18.18.6 and read its wait sentence ([acd3822](https://github.com/kabmo-labs/kabmo/commit/acd3822c8c2fd978e34541fa203bfcd1650e0aa6)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sessions:** add child sessions, forks and agent orchestration ([8dc7e44](https://github.com/kabmo-labs/kabmo/commit/8dc7e4409e1d7cb2cf46fa6ab8bb5eaa96411b12)) (thanks [@rajebdev](https://github.com/rajebdev))
* **terminal:** render the panel with ghostty-web instead of xterm ([9b678a5](https://github.com/kabmo-labs/kabmo/commit/9b678a5a7ad7905ec5a46cfaa43f0351e3023a2d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **usage:** read New API gateway spend from the provider's own base URL ([5d416ff](https://github.com/kabmo-labs/kabmo/commit/5d416fff55e5b75d4eca5553c30a9354c302cd88)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **chat:** keep the mock-mode branch inside the send file's ceiling ([d4dc790](https://github.com/kabmo-labs/kabmo/commit/d4dc790ce22545078e4d2fb03e72d70eccae3040)) (thanks [@rajebdev](https://github.com/rajebdev))
* **milestones:** add M21, the ghostty-web migration record ([d8f5158](https://github.com/kabmo-labs/kabmo/commit/d8f51580631fb364aa6099215d9f21ab9f591a84)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** answer the demo shell from the simulated stream, not a failed spawn ([814fa38](https://github.com/kabmo-labs/kabmo/commit/814fa38ebd964fdf513abd9cc4ceb57a5a498729)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** stop the generating indicator jumping when a pending chat is adopted ([4517837](https://github.com/kabmo-labs/kabmo/commit/45178370d815b0ff42944c1477338695617b18d3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **diff:** open markdown diffs without multi-second stalls ([7c0b315](https://github.com/kabmo-labs/kabmo/commit/7c0b315a23b65b95c9e13c4d1413256ee25d4774)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness/acp:** deliver subagent notices that arrive after end_turn ([fb092a1](https://github.com/kabmo-labs/kabmo/commit/fb092a18f32ba94ff47d20579b99570b46ff8a77)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [google-antigravity/antigravity-cli#1461](https://github.com/google-antigravity/antigravity-cli/issues/1461)
* **harness:** stop Claude gateway 400s and surface ACP failures ([d27b9f8](https://github.com/kabmo-labs/kabmo/commit/d27b9f8509ead4ce6398d0c9ce067fda7c9893de)) (thanks [@rajebdev](https://github.com/rajebdev))
* **terminal:** pad the cell 2.5px above and 1px below the glyph ink ([2a3ce2b](https://github.com/kabmo-labs/kabmo/commit/2a3ce2bf43c51839e5a230d5f7dd1eff954fad6c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **terminal:** replay the scrollback at the PTY's current grid ([a855e03](https://github.com/kabmo-labs/kabmo/commit/a855e0310fe45d905e8ede0bfb1a0ecbfe2d486a)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.24.0](https://github.com/kabmo-labs/kabmo/compare/v0.23.0...v0.24.0) — 2026-11-09

### Added

* **chat:** list a running harness's own models ahead of its probe ([f2a669b](https://github.com/kabmo-labs/kabmo/commit/f2a669beef2dc88b80b4a4f4caf61c9512a76bbd)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** let zcode carry a custom provider and require its runtime ([887a9e3](https://github.com/kabmo-labs/kabmo/commit/887a9e38369f113497a4b3d1bd0f54e113207584)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** pin Claude picker aliases to the gateway's model ids ([ea42553](https://github.com/kabmo-labs/kabmo/commit/ea4255353032c5226f1f957684ba370f1f5aefe7)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** probe enabled harnesses on server boot ([e6ed343](https://github.com/kabmo-labs/kabmo/commit/e6ed3439698472cbda9f7abae9f3e912aa48238f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **models:** refresh the agent registry and every reader after a provider write ([c887e3a](https://github.com/kabmo-labs/kabmo/commit/c887e3a33ab78ee7fa9463fff3dc29f92e0c271a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** bump the pin to 18.18.3 and adopt the ask form shape ([1d30e79](https://github.com/kabmo-labs/kabmo/commit/1d30e7918533e2493021aea9043b990201279434)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **about:** export the shared card width the About dialog imports ([dcaf475](https://github.com/kabmo-labs/kabmo/commit/dcaf4751b7060e117db66e6312bda585b1f5197c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **about:** keep the About dialog clear of the phone's chrome and give it one scroller ([883f97c](https://github.com/kabmo-labs/kabmo/commit/883f97cbf9974d3b0662084c4e7de86f38ee3dc5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** rewind omp-acp sessions and keep the source harness on New Chat ([6184f9b](https://github.com/kabmo-labs/kabmo/commit/6184f9b18143b56e7d4d02486226655502258e1c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness/acp:** keep id-less chunks in one message row ([13544f6](https://github.com/kabmo-labs/kabmo/commit/13544f6d282233ee1bcf26d3c64e11ea3ba73432)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness/acp:** keep the footer on the model the agent actually serves ([c62845c](https://github.com/kabmo-labs/kabmo/commit/c62845c98db2a6593e7ceb0831f6bc7cc4bd7220)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness/acp:** render a silent turn as an error, never as an empty bubble ([4607529](https://github.com/kabmo-labs/kabmo/commit/4607529e87d90fc8693605bb39fd0f77ef584dd9)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** make adapter and CLI updates land where the harness launches ([24f7cda](https://github.com/kabmo-labs/kabmo/commit/24f7cda51ca415b5e3db313598fc2177ac688a24)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** reclaim an idle ACP child on the omp window ([2f00517](https://github.com/kabmo-labs/kabmo/commit/2f005172b8cf1481f9a27fd1284445d8589abc4b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** show the adapter version when the CLI version is unreadable ([b37ac1e](https://github.com/kabmo-labs/kabmo/commit/b37ac1e017af630ff2e40d4fd0a639e1ffadf011)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** wait out opencode's plugin activation before reading it as blocked ([7a4f281](https://github.com/kabmo-labs/kabmo/commit/7a4f281e21d85508f87465d731738dbcb2809367)) (thanks [@rajebdev](https://github.com/rajebdev))
* **markdown:** give the inline-code chip its own opaque fill ([711c089](https://github.com/kabmo-labs/kabmo/commit/711c089a45770158cbc6780403a81cf528c5764d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** delete an ACP harness session instead of refusing or re-listing it ([c15bd08](https://github.com/kabmo-labs/kabmo/commit/c15bd086cc0bd94d84182b87412275fe2975bf69)) (thanks [@rajebdev](https://github.com/rajebdev))
* **workspace:** reload the Files panel whenever it is shown again ([e73e877](https://github.com/kabmo-labs/kabmo/commit/e73e877db5d365c2233c8d2f1adf994ae188a8a7)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.23.0](https://github.com/kabmo-labs/kabmo/compare/v0.22.0...v0.23.0) — 2026-11-08

### Added

* **browser:** move overflowing toolbar controls into a ⋯ menu and keep the address bar ([dd9575a](https://github.com/kabmo-labs/kabmo/commit/dd9575a39cc94c962acf3c87d74e01980513e1ee)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** paint Stop red and Send blue, both on the solved signal token ([c2b7602](https://github.com/kabmo-labs/kabmo/commit/c2b76022909bce4f6a8623d56e41387529aac7eb)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** add and import custom providers into each agent's own registry ([bccb002](https://github.com/kabmo-labs/kabmo/commit/bccb002b7d402a057e1a7edd072e9d49a7711c7d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** add zcode over its ACP bridge ([3e80b38](https://github.com/kabmo-labs/kabmo/commit/3e80b384c9b3f848cde841ccb8f756ff9d29a661)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** answer the slash picker with the agent's own commands ([e77ffb7](https://github.com/kabmo-labs/kabmo/commit/e77ffb725bb089fa60556928d5a071d7e060e31b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** bring ACP composer and tool surfaces to omp RPC parity ([c76247f](https://github.com/kabmo-labs/kabmo/commit/c76247fc14ea3c645f73202bbc8b20792077784d)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** draw only the configuration fields an agent actually reads ([8cdc1ef](https://github.com/kabmo-labs/kabmo/commit/8cdc1ef8dcd2080cf6f028f1a8c0de24dcd70192)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** make the roster switchable and the agent's mark the tab ([575f0d5](https://github.com/kabmo-labs/kabmo/commit/575f0d5c210dc53c043b995c8438c78610a0bdd1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** name a chat that has no session file, and let it resume ([a506e4f](https://github.com/kabmo-labs/kabmo/commit/a506e4f1f6a1b154d94a69690dfaba54c5064679)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** run ACP goals on their own harness and bridge panel data ([795d7aa](https://github.com/kabmo-labs/kabmo/commit/795d7aaf00f0593924c2fe7ed33ae18695f78b3b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** run chats on any ACP agent, with per-harness settings ([687c5ad](https://github.com/kabmo-labs/kabmo/commit/687c5adf1f471e8ce5a4b7f17acbdad883376437)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** filter long model lists with a searchable select ([c2c4c66](https://github.com/kabmo-labs/kabmo/commit/c2c4c6641a0f0c7a0e9b88339e31b9aefba15f24)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* order the plan pages as numbered milestones with an enforced index ([d98b25e](https://github.com/kabmo-labs/kabmo/commit/d98b25e8aefd5767278c6b87ba3c7d572c44e050)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **agent:** answer Plan/Goal on harnesses without the omp extension ([08bdd8a](https://github.com/kabmo-labs/kabmo/commit/08bdd8aeeb84c5fce419ba73fb6ded1eb14c4276)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** offer only the mode toggles the chat's harness can honour ([4786404](https://github.com/kabmo-labs/kabmo/commit/4786404b8a9e66be33d5f4c67b156f9bdc9d7131)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** restore the generating indicator's spun mark ([471cff8](https://github.com/kabmo-labs/kabmo/commit/471cff891e0702c4f42a6e97256134eb59e2c9b5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** answer a failed probe instead of a 500 ([9657e4d](https://github.com/kabmo-labs/kabmo/commit/9657e4dd076901f48d465bbf36119d307332211f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** deliver queued follow-ups and honour the composer on ACP ([9587dd4](https://github.com/kabmo-labs/kabmo/commit/9587dd4d95d1556c9d342ad97f6ce7cc912a8dbe)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** let the configured command decide availability ([98d6643](https://github.com/kabmo-labs/kabmo/commit/98d66437a49369c44745a413b878e24dd80614a1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** move only the stale half of an adapter and name the update with a download icon ([882421e](https://github.com/kabmo-labs/kabmo/commit/882421e7b330c3d8d877637b0c49fdb7e108ea3b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** probe with the user's launch line and explain exits ([8bca208](https://github.com/kabmo-labs/kabmo/commit/8bca208e488a0f0d48414481528671028aa62119)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** report a silent ACP turn and normalise array-shaped models ([f26952f](https://github.com/kabmo-labs/kabmo/commit/f26952f0bc7fedaa79b315c0d5f1045679c3216b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **harness:** write the durable run marker for ACP turns ([2c94178](https://github.com/kabmo-labs/kabmo/commit/2c941782f270408d4b4462225a7f53bcc6acc6eb)) (thanks [@rajebdev](https://github.com/rajebdev))
* **icons:** solve the light tone per paper bucket, brightest-first ([587743d](https://github.com/kabmo-labs/kabmo/commit/587743df4b7eb605c85c2c1c424487155f6f40f2)) (thanks [@rajebdev](https://github.com/rajebdev))
* **navbar:** make the context ring visible on every palette ([53989e9](https://github.com/kabmo-labs/kabmo/commit/53989e93d899d0d3fc12d0710d123c7ea3d1ff85)) (thanks [@rajebdev](https://github.com/rajebdev))
* **navbar:** step the context ring track back while an arc is drawn ([d005843](https://github.com/kabmo-labs/kabmo/commit/d00584321dc5a5570ed1d69b29babb159a1e0f12)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** adopt 18.17.0's wait windows, message list and shell trace ([428a776](https://github.com/kabmo-labs/kabmo/commit/428a776bbfd05880ce67c8357e7b35ea488108fa)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** invalidate the cached binary path when the override changes ([99ece48](https://github.com/kabmo-labs/kabmo/commit/99ece486276bdbc3e3cb4bd75ad42433583a1d4c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** pin 18.18.1 for its shell crash fixes and cd-aware cwd ([66d27db](https://github.com/kabmo-labs/kabmo/commit/66d27db01d52bd5ababaa9c41cc9343e7e94f742)) (thanks [@rajebdev](https://github.com/rajebdev))
* **realtime:** keep signal pushes alive across a hot reload ([b66d924](https://github.com/kabmo-labs/kabmo/commit/b66d92482282742a481e49299dbee7c1d4fe1994)) (thanks [@rajebdev](https://github.com/rajebdev))
* **stats:** name an omp acp child as its own session ([2ac9857](https://github.com/kabmo-labs/kabmo/commit/2ac9857df283dd14a152e1447957ffa37dd01e18)) (thanks [@rajebdev](https://github.com/rajebdev))
* **toasts:** one queue, one host, and a duration sized to the message ([a4c7fbc](https://github.com/kabmo-labs/kabmo/commit/a4c7fbc82f8e76863dbfee22083040f6e83f2546)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ui:** space the navbar's controls like the sidebar toolbar's ([e7008f4](https://github.com/kabmo-labs/kabmo/commit/e7008f4c342cb6fa4b99e9aff589ccd7dce61b29)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.22.0](https://github.com/kabmo-labs/kabmo/compare/v0.21.1...v0.22.0) — 2026-11-05

### Added

* **chat:** arm a goal and start it with the operator's next message ([550dc0c](https://github.com/kabmo-labs/kabmo/commit/550dc0c80e8abc6b0d0532b385da937657bdc977)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#if](https://github.com/kabmo-labs/kabmo/issues/if)
* **cli:** name the install command Kabmo requires, and add `kabmo doctor` ([e19969f](https://github.com/kabmo-labs/kabmo/commit/e19969f83cf6187e451eb3590dbe39c7d1b24e69)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** restyle the send and stop controls as one action pair ([1c19882](https://github.com/kabmo-labs/kabmo/commit/1c19882eaa5469559b4f58605dc06a24d1d63bf9)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#c8321e](https://github.com/kabmo-labs/kabmo/issues/c8321e)

### Changed

* **copy:** remove the em dash from every string the UI shows ([635847e](https://github.com/kabmo-labs/kabmo/commit/635847e7a3c084c2556b6274f857433549a0e577)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **composer:** drop a goalArm prop the committed types do not declare ([f52119d](https://github.com/kabmo-labs/kabmo/commit/f52119d5519fbb852cbb3531f9145beb0d486f0c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** put the model and mode controls on the readable level ([26df853](https://github.com/kabmo-labs/kabmo/commit/26df85323886252fa275ea580941fcb61d211b00)) (thanks [@rajebdev](https://github.com/rajebdev))
* **glass:** make composer popovers opaque so text behind them stays hidden ([4153450](https://github.com/kabmo-labs/kabmo/commit/415345057d4678616aef6a66f6d6b31d770f8597)) (thanks [@rajebdev](https://github.com/rajebdev))
* **icons:** tint every icon legibly, and stop discarding a call site's colour ([06351fd](https://github.com/kabmo-labs/kabmo/commit/06351fd60be6b2b4e9a6c43490c8cc468c0d1248)) (thanks [@rajebdev](https://github.com/rajebdev))
* **models:** state the compat flag that makes omp send an attached image ([a03ab6b](https://github.com/kabmo-labs/kabmo/commit/a03ab6b4d8b7f739a090a452636efa0d15d6d9d3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** carry the load-failure flag through the controller ([dc67efc](https://github.com/kabmo-labs/kabmo/commit/dc67efc56827fe1966ec8db6573dda86e22bf81e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **theme:** keep the muted ink a lightness ramp and add a solved AA level ([d3506df](https://github.com/kabmo-labs/kabmo/commit/d3506df5b7c4c7ad29e869ffde271fe0cb919581)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ui:** add the three extracted hooks the shell already imports ([3127c4a](https://github.com/kabmo-labs/kabmo/commit/3127c4affa8974f3b75216c12cedf4d8aecf37d4)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ui:** finish the touch-target and type-scale pass in the composer ([d6430fe](https://github.com/kabmo-labs/kabmo/commit/d6430fee64f890cc2b8b5029d3cda1828d59a62b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **ui:** give phone controls a 44px target and dialogs a keyboard contract ([edd30ad](https://github.com/kabmo-labs/kabmo/commit/edd30ad147353813123a152480924d3f31c4575f)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.21.1](https://github.com/kabmo-labs/kabmo/compare/v0.21.0...v0.21.1) — 2026-11-05

### Fixed

* **icons:** mute an icon by removing colour, not by darkening it ([dd7056b](https://github.com/kabmo-labs/kabmo/commit/dd7056b0b22ca53029c38b6765aa37a09a6709e6)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.21.0](https://github.com/kabmo-labs/kabmo/compare/v0.20.0...v0.21.0) — 2026-11-04

### Added

* **readme-media:** capture stills in the shipped look and verify each one ([8bfd283](https://github.com/kabmo-labs/kabmo/commit/8bfd2837b0ec8eb1208d3eb06a23782e6076c58d)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **readme:** show the glass surface with full-colour icons, and call the product a web console ([a13b248](https://github.com/kabmo-labs/kabmo/commit/a13b248e90672231e59c387fa097edbe2875f2d5)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **glass:** keep a switch knob opaque by excluding it from the canvas well ([687f045](https://github.com/kabmo-labs/kabmo/commit/687f045f6de9f0452d80a4422f34ac38a4db15ab)) (thanks [@rajebdev](https://github.com/rajebdev))
* **icons:** solve the light icon tone per hue instead of one pair ([2a69ecd](https://github.com/kabmo-labs/kabmo/commit/2a69ecdbf57bf09f942f3f8c655b749b5b7333c4)) (thanks [@rajebdev](https://github.com/rajebdev))
* **session-sidebar:** paint the stuck folder header on the phone ([f1a5372](https://github.com/kabmo-labs/kabmo/commit/f1a53722f67f109f10d25a4579018801f6347783)) (thanks [@rajebdev](https://github.com/rajebdev))

### Removed

* Revert "fix(release): build a shell only when its version moved" ([2ffe027](https://github.com/kabmo-labs/kabmo/commit/2ffe02706ee43ae64dfea510416ee6e713dfcba8)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.20.0](https://github.com/kabmo-labs/kabmo/compare/v0.19.0...v0.20.0) — 2026-11-04

### Added

* **panel-plugins:** add Update per plugin and Update all ([497a765](https://github.com/kabmo-labs/kabmo/commit/497a765977f6e20b3e89e0e70b6d0c51cf129842)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **release:** build a shell only when its version moved ([75cb3cd](https://github.com/kabmo-labs/kabmo/commit/75cb3cd56ad6f38c29be3f85d120fb863ffb5537)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.19.0](https://github.com/kabmo-labs/kabmo/compare/v0.18.0...v0.19.0) — 2026-11-04

### Added

* **git-panel:** spin the Sync glyph while a pull or push is in flight ([1565485](https://github.com/kabmo-labs/kabmo/commit/15654854cf502305866bb5ba8dde8685d91f8462)) (thanks [@rajebdev](https://github.com/rajebdev))
* **theme:** add a glass surface style and a two-axis icon colour mode ([049a100](https://github.com/kabmo-labs/kabmo/commit/049a10073e0e94de12c15d1b6f06db61bca5b142)) (thanks [@rajebdev](https://github.com/rajebdev))
* **theme:** port nine newer palette families and guard the glass composite ([0c46f3f](https://github.com/kabmo-labs/kabmo/commit/0c46f3fa8239720b41285da9bf9843e6997f9963)) (thanks [@rajebdev](https://github.com/rajebdev))
* **wordmark:** give the header lockup a soft halo on dark palettes ([49d4938](https://github.com/kabmo-labs/kabmo/commit/49d49388deaffcabbf402bda384c41e0276aea13)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **icons:** resolve the repo root without URL.pathname, which breaks on Windows ([db8e9e9](https://github.com/kabmo-labs/kabmo/commit/db8e9e9b201a6cc8e935bf6b22b18cd1d120956c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **queue:** keep queued follow-ups in order and parked while omp is busy ([9e860ca](https://github.com/kabmo-labs/kabmo/commit/9e860cad92a4bd51922093141bbfb029326d597f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **rpc:** keep an aborted run's verdict through agent_end compaction ([7047281](https://github.com/kabmo-labs/kabmo/commit/70472818b43908d818792ccb59e3888097cfb3d8)) (thanks [@rajebdev](https://github.com/rajebdev))
* **rpc:** read the advertised transport ceilings and survive a bad chunk ([c13dc08](https://github.com/kabmo-labs/kabmo/commit/c13dc08875f27f960dbdb27188b33f751b91006d)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.18.0](https://github.com/kabmo-labs/kabmo/compare/v0.17.0...v0.18.0) — 2026-11-03

### Added

* **about:** open each product's running-release notes from its version line ([57baed5](https://github.com/kabmo-labs/kabmo/commit/57baed56d10d5a176037baca260df732648b673c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **agents:** edit omp's own definition files, with omp's own keys ([5348f35](https://github.com/kabmo-labs/kabmo/commit/5348f35f3f3a476d5287a2a62152d1c7ee35ff2a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **browser:** annotate the user browser panel and send the marks to chat ([8b2dbcf](https://github.com/kabmo-labs/kabmo/commit/8b2dbcf04246e639aff72b4a6775c24160cc881f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **browser:** close the agent's tabs from the browser panel ([67bb753](https://github.com/kabmo-labs/kabmo/commit/67bb753fca64b1c01ada80a7d938d771c9a5ac5c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **browser:** name an annotation's region and read its element when the page allows ([5fcbfcb](https://github.com/kabmo-labs/kabmo/commit/5fcbfcbc0b93188e0ccecf85e4bd4e410e075daf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** review a rendered markdown document block by block ([9a6b8f5](https://github.com/kabmo-labs/kabmo/commit/9a6b8f5e299ab92326b0feefcdb7cec4c7e5c0d1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** name what a config row's draft cannot be parsed as ([deed9a2](https://github.com/kabmo-labs/kabmo/commit/deed9a29cc367bc2f95ccb9b7f58a5cf20545aeb)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** rebuild the OMP Engine panel's controls around what omp reports ([4f27635](https://github.com/kabmo-labs/kabmo/commit/4f276351f967cfae20bb1f248e15ef5cf5ccd906)) (thanks [@rajebdev](https://github.com/rajebdev))
* **tools:** add tui tool-render style, coloured terminal text without a card ([a77421c](https://github.com/kabmo-labs/kabmo/commit/a77421cceb78ad26947397fad885784222867c65)) (thanks [@rajebdev](https://github.com/rajebdev))
* **tools:** state omp 18.16.0's minimized bash output and bump the pin ([78dec3b](https://github.com/kabmo-labs/kabmo/commit/78dec3b231195bfef8c252f55d9ddffd8a8dbf36)) (thanks [@rajebdev](https://github.com/rajebdev))
* **usage:** index token usage on disk and report it per provider ([ba4c31a](https://github.com/kabmo-labs/kabmo/commit/ba4c31a6d3593df152ad66217687573b913556c4)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **omp:** drop MCP from the shared utility child ([902b20d](https://github.com/kabmo-labs/kabmo/commit/902b20d8c65a604df47ed647f51f8703ea7b7ade)) (thanks [@rajebdev](https://github.com/rajebdev))
* **terminal:** coalesce PTY reads into bounded frames ([f053d0c](https://github.com/kabmo-labs/kabmo/commit/f053d0c2c335eab5a243e05d24993e574c59ceee)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **agents:** read a Windows path, and stop the settings suites leaking ([43d1379](https://github.com/kabmo-labs/kabmo/commit/43d1379fb32ccd4b58fad73cfe60df3fcfd474ae)) (thanks [@rajebdev](https://github.com/rajebdev))
* **behavior:** scroll the line numbers with the text and report a refused copy ([1f9467d](https://github.com/kabmo-labs/kabmo/commit/1f9467d7444a610559feff33fd3244026d71b2e5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **browser:** seed the agent panel's first frame instead of waiting for one ([8a2aeb9](https://github.com/kabmo-labs/kabmo/commit/8a2aeb96b08b868f2e8a823f9ef4ef7590fefd4a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **chat:** keep the landing draft in memory instead of the fallback session ([1c7d11e](https://github.com/kabmo-labs/kabmo/commit/1c7d11e322389897fb67f97ea341fe426f883df5)) (thanks [@rajebdev](https://github.com/rajebdev))
* **diff:** count changes from the merge view's own chunks ([b43f9fe](https://github.com/kabmo-labs/kabmo/commit/b43f9fe9c7432f19a9eb8dc69b644ba549c21cba)) (thanks [@rajebdev](https://github.com/rajebdev))
* **mcp:** answer with the server list instead of an empty object ([ed9ce86](https://github.com/kabmo-labs/kabmo/commit/ed9ce864246ea786e6c1e11cf17ae97e51a6a01e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** re-enable an extension instead of answering nothing to do ([9200671](https://github.com/kabmo-labs/kabmo/commit/920067156e504a992435f398315827fae2c2d7d3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** send every command as one frame so image prompts reach the model ([718f867](https://github.com/kabmo-labs/kabmo/commit/718f867b669aad10cebb8fc6f29fbc82480c6a2f)) (thanks [@rajebdev](https://github.com/rajebdev))
* **read:** render XML section wrappers in omp docs as headings ([29fe534](https://github.com/kabmo-labs/kabmo/commit/29fe5347ef5e650eb8afec44660a788a026bb104)) (thanks [@rajebdev](https://github.com/rajebdev))
* **router:** follow the live window, and stop the suites leaking globals ([33c7042](https://github.com/kabmo-labs/kabmo/commit/33c7042b0f9af8cca3eff34a9325feb4fb8cabc2)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** make the Agents, Commands, MCP and Skills panes report their writes ([e745b36](https://github.com/kabmo-labs/kabmo/commit/e745b36b49b767f883ea562814b54b023aeee536)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** report every write's real outcome instead of assuming success ([9a0a5f8](https://github.com/kabmo-labs/kabmo/commit/9a0a5f80678eba5eb3df8446b14e388823784aab)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** drop a duplicate applyLoading, and wait for the page instead of a timer ([01dd09e](https://github.com/kabmo-labs/kabmo/commit/01dd09e38764d5c4739fa8ceae92ac94e4fdd249)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** keep a subframe navigation inside the user browser panel ([a536244](https://github.com/kabmo-labs/kabmo/commit/a5362445b74506a99eaff1bbb2d318959ae62614)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shells:** stop the phone shells crashing and signing out on a server switch ([ddd3220](https://github.com/kabmo-labs/kabmo/commit/ddd3220ec055c711a446d843088738955fa72438)) (thanks [@rajebdev](https://github.com/rajebdev))
* **sidebar:** portal the folder and server menus so no sticky row can cover them ([92067ef](https://github.com/kabmo-labs/kabmo/commit/92067efb23bc26d05bb3c8f34ce2aed78c1fcb52)) (thanks [@rajebdev](https://github.com/rajebdev))
* **terminal:** treat a backpressured send as delivered ([7fd4a3c](https://github.com/kabmo-labs/kabmo/commit/7fd4a3c1bd342dc9ab36cf55d51cd19e21abf021)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.17.0](https://github.com/kabmo-labs/kabmo/compare/v0.16.0...v0.17.0) — 2026-11-02

### Added

* **editor:** show whitespace on the selection, and drop indent guides ([c5551af](https://github.com/kabmo-labs/kabmo/commit/c5551aff023e5a12ba4d5934ad27c0e7efd7e90b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **omp:** bump the pin to 18.15.0 and lead job rows with the intent it adds ([be44d55](https://github.com/kabmo-labs/kabmo/commit/be44d5547d1c50ce1829b16c43700788927825c3)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** make Settings → Projects a working editor, with a custom accent ([bb251c4](https://github.com/kabmo-labs/kabmo/commit/bb251c4c46dbb5582340f44ac9873b0a12b7f088)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shell:** add a server switcher to the Android and iOS console ([9ccc562](https://github.com/kabmo-labs/kabmo/commit/9ccc562cd157d8c0224716024c5ec6a7c29f1905)) (thanks [@rajebdev](https://github.com/rajebdev))
* **skills:** import skills from any git repository ([a9b73c7](https://github.com/kabmo-labs/kabmo/commit/a9b73c768079d1874364ed0eba75ca68ab29a87a)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **ci:** raise one workflow per push to main ([af26528](https://github.com/kabmo-labs/kabmo/commit/af265280332dbf80a9961d92dde1e856793e0145)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** scope SVG ids before sanitizing so a gradient keeps its paint ([6318bb5](https://github.com/kabmo-labs/kabmo/commit/6318bb52ac173f86a6215f0e9ae8c6a8ba381a94)) (thanks [@rajebdev](https://github.com/rajebdev)), closes [#body](https://github.com/kabmo-labs/kabmo/issues/body) [#body](https://github.com/kabmo-labs/kabmo/issues/body) [#id](https://github.com/kabmo-labs/kabmo/issues/id)
* **files:** make a collapsed folder chain navigable, and drop-highlight the hovered row ([e87ffcb](https://github.com/kabmo-labs/kabmo/commit/e87ffcbf950def9c622629ed4c2ced9c6df7d515)) (thanks [@rajebdev](https://github.com/rajebdev))
* **release:** commit the shell bumps only after every build passed ([12f3665](https://github.com/kabmo-labs/kabmo/commit/12f36659654ffa52b5abc132c90e3aa3de2ce7cf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shell:** open a real file panel for uploads in the macOS and Android shells ([0de09e4](https://github.com/kabmo-labs/kabmo/commit/0de09e4d9593f87e2bfbf610ba31295c5d927c3e)) (thanks [@rajebdev](https://github.com/rajebdev))
* **shell:** read a macOS/Linux shell as desktop, not as an iPhone ([26333b1](https://github.com/kabmo-labs/kabmo/commit/26333b1428f1e196df89ea6afad14ab2c921eb31)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.16.0](https://github.com/kabmo-labs/kabmo/compare/v0.15.0...v0.16.0) — 2026-10-31

### Added

* **model-picker:** pin provider headings while the model list scrolls ([567be1e](https://github.com/kabmo-labs/kabmo/commit/567be1e69d706e9d81c7e21b34537c96e8bb8ce4)) (thanks [@rajebdev](https://github.com/rajebdev))
* **stats:** stop a process, and report footprint and available memory ([8a8a6c4](https://github.com/kabmo-labs/kabmo/commit/8a8a6c4e8f7119b0b1d32679cbc8a6301f86075a)) (thanks [@rajebdev](https://github.com/rajebdev))
* **wiki:** read phone wiki pages with a floating page-list modal ([3de287a](https://github.com/kabmo-labs/kabmo/commit/3de287a5430aa652d5756d040fbfa1e13bc5f272)) (thanks [@rajebdev](https://github.com/rajebdev))

### Changed

* **sessions:** answer the subagent badge without reading full transcripts ([c31d8b1](https://github.com/kabmo-labs/kabmo/commit/c31d8b1c7b36c6800adb50af345dc66beb2ccddb)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **kabmo-sdk:** stop requiring @types/node to read signalName ([f32cb16](https://github.com/kabmo-labs/kabmo/commit/f32cb169da54c3c294777e0bc1ca7e09a755e8a1)) (thanks [@rajebdev](https://github.com/rajebdev))
* **lifecycle:** report physical footprint as the process memory ([af1dced](https://github.com/kabmo-labs/kabmo/commit/af1dcedf241dec712394e78b71b9f6ac03ce5e16)) (thanks [@rajebdev](https://github.com/rajebdev))

## [0.15.0](https://github.com/kabmo-labs/kabmo/compare/v0.14.1...v0.15.0) — 2026-10-31

### Added

* **command-runner:** open with every command file group collapsed ([2387306](https://github.com/kabmo-labs/kabmo/commit/2387306380195e89bbf2324247b76ebd3b0e510b)) (thanks [@rajebdev](https://github.com/rajebdev))
* **git-panel:** widen the commit history dialog on desktop ([f48dcdb](https://github.com/kabmo-labs/kabmo/commit/f48dcdb17105344e9634ca848b3312c696fc1fbf)) (thanks [@rajebdev](https://github.com/rajebdev))
* **settings:** enlarge the settings dialog to a 1280px desktop canvas ([8bc6228](https://github.com/kabmo-labs/kabmo/commit/8bc6228a06d613fdb210450e223496a19b2afbd9)) (thanks [@rajebdev](https://github.com/rajebdev))

### Fixed

* **chat:** land the scroll-to-bottom jump at the tail instead of stopping part way ([418a2c1](https://github.com/kabmo-labs/kabmo/commit/418a2c16b993ac5a1780557eadea5d5c552dee7c)) (thanks [@rajebdev](https://github.com/rajebdev))
* **composer:** keep the stretched glass card opaque over the transcript ([0910b8e](https://github.com/kabmo-labs/kabmo/commit/0910b8ef27e5377adc0798ccdfa81551358090ad)) (thanks [@rajebdev](https://github.com/rajebdev))
* **editor:** stop reporting subfolder files as deleted ([91467d4](https://github.com/kabmo-labs/kabmo/commit/91467d4a10835f65c012aa2061883ee857250318)) (thanks [@rajebdev](https://github.com/rajebdev))

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
