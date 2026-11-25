# Saved multi-account for Codex, Claude and Antigravity

Research, 2026-11-25. Question: can Kabmo save several Codex, Claude Code and
Antigravity accounts per harness, let a chat pick one, and resume it on the same
account — without re-authenticating and without the two accounts sharing a
credential?

Sources read at `stablyai/orca@7b6c852` (2026-11-24) and
`pingdotgg/t3code@a2231ca` (2026-11-24). Every claim about their behaviour below
is read from source or their user docs, not from a runtime probe. Kabmo's
current paths were read from this checkout.

**Verdict: possible for all three, but the seam is different per CLI, not per
app.** Codex and Claude expose a home/config-dir variable, so accounts are
isolated directories. `agy` (Antigravity) keeps one native login per machine
unless it is convinced it runs over SSH and is forced onto file storage;
t3code does exactly that, Orca instead swaps the single native credential from an
encrypted vault. Kabmo can copy the isolated-home model for all three, but
Antigravity needs its own adapter and a measured sign-in path, not a generic
env overlay.

Status: **partial** — v1 shipped: isolated homes for Codex, Claude and Antigravity, account-bound spawn/probe/resume, and a separate Accounts settings section; owed: a real Antigravity sign-in, shared config/history, and a per-chat picker.

---

## 1. What “saved account” means in each app

Neither app stores the credential itself as the primary artifact. Both treat an
account as **a named pointer to a credential location the CLI already owns**, plus
identity metadata for display and duplicate detection.

| | Orca | t3code |
|---|---|---|
| Unit | per-agent managed account (`codexManagedAccounts`, `claudeManagedAccounts`) | provider instance (`providerInstances[id]`, driver `codex`/`claude`/`antigravity`) |
| Selection | one active account per runtime lane (host, WSL distro) | per thread/model picker, resolved from the instance |
| Mid-chat switch | no; running sessions keep their account | yes for Codex when both instances share `CODEX_HOME`; no for separate Claude/Antigravity homes |
| Quota | per-account readings; no pool; auto-failover is an open request | pooled display across accounts; no auto-failover |
| Stance | manage the fleet in the app | explicitly “not the right place to manage a pile of accounts”; warns and points at a self-hosted hub |

Orca's open issues confirm the boundary: per-worktree pinning (#9496) and
automatic failover on rate limit (#20512) are still open. t3code closed the
auto-switch request (#2111) and added a non-blocking warning before a second
Claude or Codex account (PR #25475), naming TOS bans as the risk of an
auto-switcher.

---

## 2. Orca

### 2.1 Codex: one isolated home per account, shared config

- Account record: `src/shared/agent-accounts/managed-account-types.ts`
  (`id`, `email`, `managedHomePath`, `providerAccountId`, workspace fields,
  `lastAuthenticatedAt`) plus a user label.
- Home: `<userData>/codex-accounts/<uuid>/home` on the host, or
  `~/.local/share/orca/codex-accounts/<uuid>/home` inside a WSL distro
  (`src/main/codex-accounts/managed-homes/codex-managed-home-path.ts`).
- Ownership is proved by a `.orca-managed-home` marker; the home is refused if
  the path is unowned or names another account. Credentials are written
  `0600` (`codex-managed-home-lifecycle.ts`).
- Add flow: create the home, run `codex login` with
  `CODEX_HOME=<managedHome>` (`codex-login-session.ts:312`), then read the
  identity (`email`, `providerAccountId`, workspace) from the resulting
  `auth.json` and persist it.
- Config is mirrored, not shared by symlink: the real `~/.codex/config.toml`
  (providers, MCP servers, model settings) is merged into each managed home,
  with conflicts preserved (`codex-config-mirror.ts`). A config that pins a
  custom `model_provider` blocks adding an OAuth account, because the new
  credentials would never be used.
- Launch: `prepareForCodexLaunch` injects the selected account's
  `CODEX_HOME`; system default means “do not inject” and leaves the real
  `~/.codex`. Existing panes keep the account recorded for them
  (`codex-pane-account-registry`).
- History can optionally be shared across accounts through a session bridge;
  otherwise each home has its own.

This is an auth-overlay in all but name: **config shared, auth private, optional
history shared**.

### 2.2 Claude: isolated `CLAUDE_CONFIG_DIR`, shared history

- Home: `<userData>/claude-profiles/<uuid>/home`
  (`src/main/claude-accounts/profiles/claude-profile-paths.ts`), with a
  `profile.json` ownership marker.
- Launch env: `CLAUDE_CONFIG_DIR=<profile home>`; auth-related env vars
  (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`,
  `AWS_BEARER_TOKEN_BEDROCK`) are stripped so an ambient key cannot hijack the
  selected account (`runtime-auth/environment.ts`).
- `HOME` is deliberately not changed: on macOS the Keychain item is scoped to a
  hash of `CLAUDE_CONFIG_DIR` (`Claude Code-credentials-<sha256(dir)[:8]>`,
  `runtime-auth/keychain.ts`). Changing `HOME` would hide the login instead of
  switching it.
- Shared state is explicit (`profiles/setup/claude-profile-history.ts`,
  `claude-profile-provisioning.ts`):
  - symlinked: `projects`, `session-env`, `file-history`, `shell-snapshots`,
    `todos`, `paste-cache`, `tasks`, `plans`, `transcripts`, and prompt history;
  - merged/synced: `settings.json` and shared `.claude.json` keys;
  - private: `.credentials.json`, `sessions`, caches, per-folder memory.
- Login: `claude auth login --claudeai` with `CLAUDE_CONFIG_DIR` set
  (`sign-in/claude-login-session.ts:69`).
- A pointer file (`claude-profiles/selected-host`) mirrors the selection for
  terminals that Claude already runs in.

### 2.3 Antigravity: one native login, swapped from an encrypted vault

Orca does **not** run parallel `agy` accounts:

- Users sign in with `agy` themselves, then press “Save current account”.
  `AntigravityAccountService.addCurrentAccount()` reads the native credential,
  resolves the Google identity (subject/email), and appends the raw credential
  string to a vault (`src/main/antigravity/native-account-service.ts`).
- Selecting an account writes that credential back to `agy`'s own store and
  reads it back to verify; a concurrent token refresh raises a conflict instead
  of overwriting (`selectAccount`, `native-credential-backend.ts`).
- Vault: `<userData>/antigravity-accounts/vault` (one per WSL distro), encrypted
  with the OS secret store; refuses to operate when protected storage is
  unavailable (`native-account-store.ts`, `native-account-host.ts`).
- Native store mapping: macOS Keychain, Linux Secret Service (`secret-tool`),
  file `~/.gemini/antigravity-cli/antigravity-oauth-token` on remote/SSH/
  container/WSL hosts, Windows credential file.
- Consequences documented by Orca: no parallel identities, no quota pooling,
  running sessions may keep the old login, and Orca's Antigravity **chats** use a
  separate sign-in from `agy`.

So Orca solved Antigravity by accepting a machine-wide singleton and making the
swap safe and auditable.

---

## 3. t3code

### 3.1 Model: account = provider instance

`ProviderInstanceConfig` is `{driver, displayName, accentColor, environment,
enabled, config}` (`packages/contracts/src/providerInstance.ts`). All three
drivers advertise `supportsMultipleInstances: true`. Account setup is therefore
“add another instance”, and the account is chosen in the thread's model picker.

### 3.2 Codex: direct home or auth-overlay shadow home

`CodexSettings` exposes `homePath` (`CODEX_HOME`) and `shadowHomePath`
(`packages/contracts/src/settings.ts`).

- No shadow → direct: `CODEX_HOME = homePath` (or `~/.codex`).
- Shadow → **auth overlay** (`apps/server/src/provider/Drivers/CodexHomeLayout.ts`):
  - `auth.json` must be a real file in the shadow home; symlinking it is an
    error;
  - `auth.lock` and `models_cache.json` are also private;
  - `log`, `memories`, `tmp`, `.DS_Store` stay local to the shadow;
  - every other entry (including `sessions`, `config.toml`, plugins, skills) is
    symlinked to the shared home, and entries that changed target are relinked.
- The continuation key is `codex:home:<sharedHome>`; two instances with the same
  shared home can continue the same thread, while a separate `CODEX_HOME` cannot
  (`CodexManagedProvider.ts`, `codexContinuationIdentity`).
- Non-default Codex instances automatically get a shadow under
  `<stateDir>/providers/codex/<instanceId>/shadow` (`CodexManagedHome.ts`).
- “Connect with ChatGPT” is a second, managed path: T3 stores ChatGPT OAuth
  sessions in its server secret store (`ProviderCredentialStore`, key
  `provider-auth-<sha256>`) and injects the access token; it does not modify the
  CLI login. One instance can keep several saved connection profiles and switch
  the active one through auth methods (`CodexChatGptAuth.ts`).

### 3.3 Claude: `homePath` is `CLAUDE_CONFIG_DIR`

- `ClaudeSettings.homePath` → `CLAUDE_CONFIG_DIR`; default is inherited
  `CLAUDE_CONFIG_DIR` then `~/.claude` (`Drivers/ClaudeHome.ts`).
- The comment in that file is the rule: changing `HOME` hides macOS Keychain
  credentials, so only `CLAUDE_CONFIG_DIR` is changed.
- Separate account directories are fully isolated, including local conversation
  state; there is no Claude equivalent of Codex's shadow home. Existing threads
  can switch only between instances that share the same config dir.
- Login is the CLI's own `claude auth login` in that config dir.

### 3.4 Antigravity: one private `GEMINI_HOME` per instance

- Each instance gets `<stateDir>/providers/antigravity/<sha256(instanceId)>`
  (`resolveAntigravityInstanceDirectories`).
- Launch env (`antigravityAuthSupport.ts`):
  - `GEMINI_HOME=<instance profile>`;
  - `AGY_ACP_FORCE_FILE_STORAGE=1`;
  - for personal OAuth, a synthetic `SSH_CONNECTION` — the comment states the
    1.5 CLI otherwise keeps **one OS keyring entry for every profile** unless it
    believes it runs over SSH;
  - strips ambient `GEMINI_API_KEY`, `GOOGLE_*`, `AGY_ACP_*`, `BROWSER`, and
    related variables.
- The token lands at `<profile>/antigravity-acp/acp_token.json`; sign-in is
  `agy acp --login` with the same env, and T3 captures the URL/code.
- Runtime binaries are shared; skills/rules from the real `~/.gemini` are
  linked/copied into the private home.
- Auth methods: Google account, Gemini Enterprise, Gemini API key, Agent
  Platform/Vertex. API keys live outside the settings file.
- Instances are separate continuation groups, so switching account means a new
  thread, not a mid-thread swap.

---

## 4. Comparison

| Dimension | Orca | t3code |
|---|---|---|
| Codex isolation | own home per account | own `CODEX_HOME`, optional shadow |
| Codex shared state | config mirrored | config/sessions symlinked; auth private |
| Claude isolation | own `CLAUDE_CONFIG_DIR` | own `CLAUDE_CONFIG_DIR` |
| Claude shared state | history symlinked, settings merged | none |
| Antigravity isolation | none; one native login | private `GEMINI_HOME` per instance |
| Antigravity switch | write native credential + verify | select another instance |
| Parallel accounts | Codex/Claude yes; Antigravity no | yes for all three |
| Selection scope | host or WSL distro; new sessions | thread/model picker |
| Mid-thread account change | no | Codex only, same `CODEX_HOME` |
| Usage | per account; no pool | pooled display; no execution pool |
| Auto-switch on limit | not implemented | refused (TOS risk) |

The two apps agree on the important invariant: **never share the credential
file; share only configuration/history, and only when the CLI tolerates it.**

---

## 5. Kabmo today (measured from this checkout)

- Account-shaped state does not exist. `HarnessConfig` is
  `command | env | provider | model | thinking | mode`
  (`src/shared/lib/harness/config.ts`), stored one row per harness in
  `app_settings` (`omp_harness_config:<id>`).
- `env` is already capable of `CODEX_HOME`, `CLAUDE_CONFIG_DIR` or
  `GEMINI_HOME`, so a *manual* second account is possible today. What is missing
  is persistence, identity, selection and safety:
  - no account record, label, identity, login flow or duplicate detection;
  - changing `env` changes every new chat and invalidates the probe
    (`probeInvalidatedBy` compares only command/env);
  - `harness_sessions` has no account column, so a resumed chat cannot know
    which home it started in;
  - probes are keyed by harness (`harness_probes.harness`), not account, so one
    account's auth/models answer for all;
  - ACP auth support is headless-only (`cached_token` or an env-named method,
    `src/server/lib/harness/acp/auth.ts`); anything browser/terminal prints a
    command instead of starting a login.
- Spawn env is `{...Bun.env, ...accountEnv}` with only Kabmo-owned variables
  stripped (`stripKabmoHostEnv`: `PORT`, `HOST`, `NODE_ENV`,
  `KABMO_UI_PASSWORD`, `NEXT_*`). **Ambient `ANTHROPIC_API_KEY`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `GEMINI_API_KEY`, `CODEX_HOME`, `HOME` are
  inherited.** That is the main correctness bug a multi-account feature must
  close: selecting account B while `ANTHROPIC_API_KEY` is exported runs account
  B's CLI against account A's key.
- `app_settings` stores env as plain text. Credentials must stay in the CLIs'
  own stores; Kabmo should store only homes and labels. API-key Antigravity
  accounts would need an explicit decision (plaintext today vs. a later secret
  store).

---

## 6. Design for Kabmo

### 6.1 Persist accounts, not credentials

New table (one row per saved account):

```sql
CREATE TABLE harness_accounts (
  id TEXT PRIMARY KEY,
  harness TEXT NOT NULL,
  label TEXT NOT NULL,
  home_path TEXT NOT NULL,
  auth_kind TEXT NOT NULL DEFAULT '',   -- oauth | api-key | unknown
  identity TEXT NOT NULL DEFAULT '',    -- JSON: email/subject/workspace
  created_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL
);
```

Selection: per harness (`app_settings` key `harness_selected_account:<harness>`)
plus an explicit per-chat `account_id` persisted in `harness_sessions` (and the
chat row) at spawn. That column is what makes resume safe: a chat is never
resumed on a different account by accident.

`home_path` is inside Kabmo's data dir:
`<kabmo-data>/harness-accounts/<account-id>`, mode `0700`, with a
`.kabmo-account` marker containing the account id. Refuse to create or write a
home that has the wrong marker, exactly like Orca's ownership check.

### 6.2 One adapter per harness, not one generic env overlay

| Harness | Env written | Login | Private | Shared |
|---|---|---|---|---|
| Codex | `CODEX_HOME=<home>` | `CODEX_HOME=<home> codex login` | `auth.json`, `auth.lock`, `models_cache.json` | optional: mirror `config.toml`; symlink `sessions` only if the user opts in |
| Claude | `CLAUDE_CONFIG_DIR=<home>` (never `HOME`) | `CLAUDE_CONFIG_DIR=<home> claude auth login --claudeai` | `.credentials.json`, `.claude.json`, `sessions` | optional: symlink the history dirs Orca shares (`projects`, `todos`, `plans`, ...) and merge `settings.json` |
| Antigravity | `GEMINI_HOME=<home>`, `AGY_ACP_FORCE_FILE_STORAGE=1`, OAuth only: synthetic `SSH_CONNECTION` | `GEMINI_HOME=<home> agy acp --login` (capture URL/code) | whole home; token at `<home>/antigravity-acp/acp_token.json` | share the installed runtime only; link/copy `AGENTS.md`, `GEMINI.md`, `config/skills.json`, skills dirs |

Before applying the account env, strip **all** variables that can select or
authenticate another account:
`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GEMINI_HOME`, `HOME`, `USERPROFILE`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
`CLAUDE_CODE_OAUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `GEMINI_API_KEY`,
`GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_*`,
`AGY_ACP_*`, and `SSH_CONNECTION` unless the adapter sets it. Then apply the
account's explicit env, last. This is Orca's `stripAuthEnv` rule generalised.

### 6.3 Bind the account into every path that has a key

- probe: key `(harness, accountId)`, or delete the harness probe row when an
  account is added/removed; pass the account env to `probeHarness`.
- prewarm/lease: include `accountId` in `acpPrewarmKey`/session lease keys;
  otherwise a prewarmed account-A process is adopted by an account-B chat.
- resume: read the stored `account_id`; if the home or its marker is missing,
  fail with the account name — never fall back to system default.
- session title/transcript import for Codex reads `CODEX_HOME` from the launch
  env today (`codex/transcript.server.ts`); it must read the account's home, not
  `Bun.env.CODEX_HOME`.

### 6.4 UI

- Settings → Harnesses → each harness row gets an **Accounts** section: list,
  add (runs login), rename, remove, set default.
- Composer harness tab shows an account chip next to the model; changing it
  applies to the next prompt or asks to start a new chat when the transport
  cannot switch mid-session.
- Login runs where the agent can see a TTY: reuse the terminal panel or spawn
  the CLI and surface its URL/code. Do not pretend ACP's headless
  `cached_token` is an account login.

### 6.5 Deliberately out of scope

- No automatic failover on quota. t3code refuses it for TOS reasons; Orca has
  not shipped it. If Kabmo adds it later, it must be opt-in and named as such.
- No pooled quota display until per-account usage readers exist. Showing one
  number over accounts Kabmo cannot verify is worse than showing none.
- No credential storage in `app_settings`. Antigravity API-key accounts are the
  only case that needs a secret store; keep them out of v1 or add one first.

### 6.6 Migration

An existing `env` line that already contains `CODEX_HOME`/`CLAUDE_CONFIG_DIR`/
`GEMINI_HOME` must not be silently reinterpreted. Offer “import this home as an
account” once; otherwise leave the harness on its legacy launch override.

---

## 7. Risks

- **Antigravity is the fragile one.** The `GEMINI_HOME` + forced-file-storage +
  SSH-spoof recipe is t3code's workaround for a CLI that wants one keyring entry.
  It changes how `agy` opens a browser and how it decides file vs. keyring
  storage. Measure sign-in on macOS, Linux and WSL before promising parallel
  accounts; the fallback is Orca's model (single native login + encrypted vault
  swap), which is safe but cannot run two accounts at once.
- **Claude Keychain.** Never change `HOME`; only `CLAUDE_CONFIG_DIR`. Deleting a
  profile leaves its Keychain item behind; that is preferable to deleting a
  credential that another path may still reference.
- **Ambient credentials.** Today Kabmo inherits the host's auth env. Without the
  strip list above, “saved accounts” will appear to work and silently use the
  wrong key.
- **Shared history is a privacy boundary.** Codex `sessions` and Claude
  `projects` contain full transcripts. Make sharing opt-in per account and label
  it, rather than defaulting to Orca's behaviour.
- **Mislabeling.** Read identity from the CLI's own token (Codex id token,
  Claude state file, Google userinfo) before showing “work”/“personal”; a label
  alone is not evidence of which account is signed in.

---

## 8. Verification plan

1. Temp-home unit tests with fake `codex`, `claude` and `agy` scripts that echo
   their env and write a marker credential. Assert: account A never sees account
   B's home; ambient auth vars are absent; the stored `account_id` is used on
   resume; a missing home fails instead of falling back.
2. Probe/prewarm tests: two accounts of one harness must not share a probe row or
   a prewarmed process.
3. Real smoke on this machine, in a temp data dir:
   - two `CODEX_HOME` logins (different accounts), start one chat each, confirm
     the CLI reports the expected email;
   - two `CLAUDE_CONFIG_DIR` logins, same check, including macOS Keychain;
   - two `GEMINI_HOME` logins, confirm `acp_token.json` lands in each home and
     `agy` reports the expected account; if the keyring still wins, record it and
     fall back to the vault-swap design for Antigravity.
4. Restart Kabmo and resume each chat; the same account must come back, and a
   deleted account must produce a named error.

---

## 9. Implementation (2026-11-25, v1)

Shipped:

- **Storage.** `harness_accounts` (id, harness, label, home path, identity,
  auth kind, timestamps) and `harness_account_selection` (one active account per
  harness); `harness_sessions.account_id` records the account a chat started on,
  so a resume never silently uses a different login. Homes live under
  `<KABMO_DATA_DIR>/harness-accounts/<uuid>` with a `.kabmo-account` marker; a
  foreign or missing marker is refused, never overwritten.
- **Adapters.** `src/shared/lib/harness/accounts.ts` is the single table for
  `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `GEMINI_HOME`, their strip lists, and the
  sign-in command. `src/server/lib/harness/accounts.server.ts` owns storage and
  launch resolution; `account-identity.server.ts` reads the CLIs' own token files.
- **Everything that spawns uses the account.** Probe, prewarm, one-shot, session
  import, agent-side delete, new chat, and both resume paths resolve the selected
  or recorded account. The prewarm key includes the account id, and a probe is
  forgotten when the login changes.
- **Env isolation.** `envDrop` on the stdio boundary removes ambient
  `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GEMINI_HOME`, `ANTHROPIC_*`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `GEMINI_API_KEY`, `GOOGLE_*` and `SSH_CONNECTION`
  before the account env is applied. System default (no account) leaves the host
  environment untouched.
- **Settings.** A separate **Accounts** section in each harness card: system
  default, saved rows, inline rename, two-step remove, `Verify`, and the exact
  sign-in command with a copy button. Adding an account creates the home; the
  login itself stays in the agent's own store.
- **Sign in runs server-side, Kabmo draws the result.** An unsigned account has a
  `Sign in` button that starts the CLI on a server-side PTY with the account's
  env. The settings panel receives the sanitized output, shows the auth URL and
  the last lines, and accepts the code the page displays; no terminal renderer
  is mounted. A normal exit triggers `Verify`, so a completed browser login
  becomes `Signed in` without a second manual step. Closing the panel kills the
  process tree. An unsigned account that is not active labels its action
  `Use & sign in`: it selects that account and starts the sign-in in one click.
  The selected row keeps a separate `Sign in`. Selecting a signed-in account, or
  finishing a sign-in, also runs the probe once, so its models are ready without
  a second `Check status` click.

Measured during the smoke test:

- creating a Codex, Claude and Antigravity account through `POST /api/harness`
  produced the expected login commands and persisted across a server restart;
- probing Antigravity through a fake launch command showed
  `GEMINI_HOME`, `AGY_ACP_FORCE_FILE_STORAGE` and the synthetic `SSH_CONNECTION`
  in the child environment;
- with `GEMINI_API_KEY=leak` and `GOOGLE_API_KEY=leak` exported by the server,
  an account probe contained neither, while system default still received both;
- selecting system default cleared the account home, and removing the account
  deleted only its marked home;
- the automatic `Sign in` path was smoke-tested end to end with a fake `codex`
  on the server's PATH: the spawned PTY printed an OAuth URL, the panel rendered
  the URL and a code field (no terminal DOM), the submitted code reached the
  child, the child wrote `auth.json`, and the row changed to `Signed in` with the
  token's email — Verify and probe ran without a click. A separate run against
  the real Codex CLI showed the live OAuth URL in the same panel; it was closed
  without completing a sign-in;
- `Use & sign in` on a second, unsigned account selected it, ran the fake login,
  and ended on `Signed in` with that account `IN USE` — no separate Verify click.

Not in v1, deliberately:

- per-chat account picker (selection is per harness, like Orca);
- sharing Codex `config.toml`/sessions or Claude history between accounts;
- automatic failover or quota pooling;
- an in-panel fallback when the embedded PTY cannot start (the copyable command
  remains).

The one unmeasured path is a real Antigravity sign-in against
`GEMINI_HOME` on macOS/Linux: the env recipe is t3code's, but the account's
actual browser login still needs an operator with two Google accounts. Until
that is done, the honest state is "isolated home and env verified; sign-in
recipe inherited, not re-measured."

---

## Sources

Orca (read at `7b6c852`):

- Codex homes and login: `src/main/codex-accounts/managed-homes/`,
  `login/codex-login-session.ts`, `runtime-home/routing/runtime-home-service-launch.ts`
- Codex config mirror: `src/main/codex-accounts/managed-homes/codex-config-mirror.ts`
- Claude profiles: `src/main/claude-accounts/profiles/`,
  `runtime-auth/environment.ts`, `runtime-auth/keychain.ts`,
  `sign-in/claude-login-session.ts`
- Antigravity accounts: `src/main/antigravity/native-account-service.ts`,
  `native-account-store.ts`, `native-credential-backend.ts`,
  `native-account-launch.ts`
- Docs: <https://orca.dev/docs/agents/codex-hot-swap>,
  <https://orca.dev/docs/agents/antigravity-accounts>
- Open requests: #9496 (per-worktree pinning), #20512 (auto failover)

t3code (read at `a2231ca`):

- Provider instances: `packages/contracts/src/providerInstance.ts`,
  `apps/server/src/provider/ProviderInstanceRegistry.ts`
- Codex: `apps/server/src/provider/Drivers/CodexHomeLayout.ts`,
  `CodexManagedHome.ts`, `CodexManagedProvider.ts`, `CodexChatGptAuth.ts`
- Claude: `apps/server/src/provider/Drivers/ClaudeHome.ts`,
  `ClaudeDriver.ts`
- Antigravity: `apps/server/src/provider/Drivers/AntigravityDriver.ts`,
  `apps/server/src/provider/antigravityAuthSupport.ts`,
  `AntigravityAuth.ts`
- Docs: <https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md#use-multiple-accounts>,
  <https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md#separate-accounts-or-configurations>,
  <https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-antigravity.md#accounts-and-removal>,
  <https://github.com/pingdotgg/t3code/blob/main/docs/user/usage.md#track-subscription-limits>,
  <https://github.com/pingdotgg/t3code/blob/main/docs/user/faq.md#can-i-add-a-bunch-of-accounts-for-one-provider>
- Stance: PR #25475; closed request #2111
