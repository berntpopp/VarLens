# Desktop platform sign-in

**Status:** In progress.
**Scope:** Electron main process and the renderer's boot. Web and the hosted server are unchanged.
**Relates to:** #295. On 2026-10-08 the upstream owner agreed to the desktop platform sign-in, on condition that without the admin config file the desktop behaves exactly as today, and asked for `platform-jwt` to move to `src/shared/` first and for small PRs. User-facing setup: `docs/guide/desktop-sign-in.md`.

## Setups

| Setup | Sign-in | Switched on by |
|---|---|---|
| Desktop (default) | none, exactly as today | nothing to configure |
| Web | local or platform login | `VARLENS_AUTH_MODE`, already there |
| Desktop with platform login | platform login in the system browser | admin config file |

Local desktop accounts can join later as another mode on the same gate; platform mode replaces them.

## Principle: our code beside the desktop, small seams in it

Everything the sign-in does lives in new modules (`src/main/auth/`, `src/main/ipc/handlers/desktop-auth.ts`, the renderer's `desktopAuthStore`, `SignInApp.vue`, `components/auth/`). Existing files get only the seams below. Without the admin config file none of them changes what the desktop does; what remains is an `lstat` of the config paths at startup and one `auth:desktopStatus` call while the renderer boots.

| PR | Existing file | Change | Why |
|---|---|---|---|
| 2 | `src/main/index.ts` | `installDesktopAuth()` before IPC registers; with a sign-in mode the startup creates the manager without opening the default database | the mode must be known before any channel answers; nothing opens before sign-in |
| 2 | `src/main/ipc/index.ts` | registers through `createIpcRegistrars`: data domains on startup gate + access gate, `jobs` and `debug` on the access gate only | deny-by-default IPC; `jobs` and `debug` keep answering during startup as before |
| 2 | `src/main/ipc/domains/{jobs,debug}.ts` | `ipcMain` as a parameter, defaulting to Electron's | so they can register through the gate; their tests stay unchanged |
| 2 | `src/main/ipc/domains/auth.ts` | registers the `auth:desktop*` channels | they are auth channels (domain-module convention) |
| 3 | `src/main/services/DatabaseManager.ts` | `setOpenGuard`: `checkKey` before a SQLite file is touched, `checkSession` before any session becomes current; with a guard installed an `AppError` passes through like `WrongPasswordError` (without one every open failure is wrapped as before); `lock()` closes with `closeForLock` and returns false while work runs | binding, passphrase-only and server-workspace refusal in one place; the refusal reaches the user with its message |
| 3 | `src/main/storage/sqlite/SqliteStorageSession.ts`, `src/main/database/DatabaseService.ts` | `closeForLock()`: the service's key copy goes first (`discardKey()`), new reads wait, then writer, read pool and connection close, each step even when one fails | a writer or read pool that a late call respawns finds no key; `close()` is unchanged |
| 3 | `src/main/database/db-key-store-instance.ts` | `setOsKeyWrapAllowed(false)`: the OS credential store wraps no new key; existing wraps still unwrap | `requirePassphrase` behaves like a system without a keyring, through the paths that already handle one |
| 3 | `src/main/services/auth/{AuthService,auth-writes}.ts` | read and bind `database_settings.platform_identity` (`INSERT OR IGNORE` through the writer thread) | the binding is a database write and goes where the other auth writes go |
| 3 | `src/main/services/jobs/JobRunner.ts` | `pruneTerminalJobs(keep)` public | a lock forgets finished jobs, whose params name the account's files |
| 2, 3 | shared contract, preload, `capability-features.ts`, parity manifest, mocks, preload contract test | the `auth:desktop*` methods, desktop-only (`desktopSignIn`) | required for every new IPC method |
| 2, 3 | `src/renderer/src/main.ts`, `AppToolbar.vue` | mount `SignInApp` instead of the app while sign-in is required (PR 2); the lock button (PR 3) | the renderer never mounts code that asks for data |
| 3 | `docs/.vitepress/config.mts` | the guide page | |

## Design

This section describes the state after PR 3. PR 2 brings the mode, the gate with `system:capabilities`, `system:version` and `auth:desktopStatus` as the only channels without a session and the local accounts refused, the admin config file and the sign-in screen; PR 3 adds the sign-in channels, the refusal of server workspaces and of the Postgres backend, and everything from signing in on.

**Mode and gate.** The admin config file is read once at startup (`installDesktopAuth`, `src/main/auth/desktop-auth.ts`). No file: nothing is installed and the gate keeps its pass-through provider, so the default desktop runs the same code path as a sign-in mode. In platform mode `gateIpcMainOnAccess` (`src/main/auth/access-gate.ts`) asks the provider on every call: while nobody is signed in only `CHANNELS_WITHOUT_SESSION` answers (`system:capabilities`, `system:version`, `auth:desktopStatus`, `auth:desktopSignIn`, `auth:desktopCancelSignIn`); every other channel gets `UNAUTHENTICATED` without its handler running. Signed in or not, platform mode refuses the eleven local-account channels and the two channels that connect to a server workspace with `FORBIDDEN`. On the gated object `handleOnce`, `on`, `once` and the other listener registrations throw. Besides the entry's `perf:interactive` milestone only `src/main/ipc/index.ts` holds the raw `ipcMain`, and `jobs.ts`/`debug.ts` only as the default value of their parameter.

**The admin config file.**

| System | File | Trusted when |
|---|---|---|
| Windows | `C:\ProgramData\VarLens\auth.json`, then `%ProgramData%\VarLens\auth.json` | file and folder owned by Administrators, SYSTEM or TrustedInstaller, and no allow entry for anyone else grants a right that changes or deletes the file, deletes entries in or renames the folder, or changes permissions or owner |
| macOS | `/Library/Application Support/VarLens/auth.json` | file and folder owned by root, not writable by group or others, no symbolic link |
| Linux | `/etc/varlens/auth.json` | as macOS |

It holds `mode: "platform"`, `issuer`, `clientId`, `audience`, `requiredAcr`, `requiredAmr` and `access` (`claim` and `value`, for example `groups` containing `/varlens-desktop`), optionally `idleLockMinutes` (15), `maxSessionMinutes` (480) and `requirePassphrase` (false). Unknown keys are refused. The issuer is HTTPS; plain HTTP to `localhost`, `127.0.0.1` or `[::1]` only in development builds, the one rule (`isTrustedIdpUrl`) the config, discovery and the browser sink share. Only "the file does not exist" means no sign-in: a path that cannot be checked, a file that cannot be trusted, read or parsed, an unexpected error, or `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres` next to the file give a provider that never unlocks, with the reason on the sign-in screen and in the log. `VARLENS_DESKTOP_AUTH_CONFIG` names a file in development builds only, and only when no machine-wide file exists. The file I/O is in `desktop-auth-config-source.ts`: opened once without following links; on Windows one PowerShell call reads the security descriptor and the content through the same handle (`windows-acl.ts` checks the SDDL; reparse points, conditional or object entries and anything after the access list fail closed).

**Signing in** (`platform-sign-in.ts`, `oidc-provider.ts`, `loopback-callback.ts`). RFC 8252 through the system browser: discovery and keys fetched fresh, a one-shot listener on `127.0.0.1` that answers only the expected `state`, code flow with PKCE S256, `nonce`, `acr_values`, `prompt=login`, `max_age=600`. Both tokens are checked with `platform-jwt`: the ID token for client, nonce, acr, every amr and a fresh `auth_time`; the access token for the audience, `azp`, the same subject and the access claim. No token is kept. Outcomes: `signed-in` (the session opens, the default database opens unless `requirePassphrase`, the window reloads into the app), `enrolled` (the first sign-in only set the authenticator up), `no-access`, `cancelled`, `failed`. The log says what happened, never who. A TLS failure is named as such.

**Binding** (`database-binding.ts`). The guard binds a database to the first identity that opens it while signed in (issuer and subject) and refuses every other one with `FORBIDDEN`; a refused switch restores the previous database, a refused open leaves none, and the refused session is closed with its key dropped. The binding is read after the schema checks, so a refused database may have been migrated, but never becomes current. Nobody signed in refuses everything. A server-workspace session is refused before it becomes current. The guard is installed on the manager whenever `DesktopAuth` touches it, starting with the startup that opens nothing.

**Lock** (`session-lock.ts`, `DesktopAuth.lock`). After `idleLockMinutes` without input, after `maxSessionMinutes`, on screen lock and suspend, on the idle state `locked`, and by the toolbar button. The provider locks first, so the gate refuses at once; running jobs are cancelled; the window reloads into the sign-in screen; `DatabaseManager.lock()` is retried every second until no job or background worker runs, then closes and drops the key; finished jobs are forgotten. The next sign-in waits up to five seconds for that close and otherwise fails with a message, rather than hang or hand the next account the last one's data; work that never ends keeps the data closed behind the gate.

**Passphrase only.** `requirePassphrase` stops new OS key wraps (new databases, the plaintext migration and a key recovered from its sidecar then need or keep only a passphrase), keeps the default database closed after sign-in, and makes the guard refuse a plaintext database or one whose key the OS credential store holds, before the file is touched. To leave the key store untouched, VarLens takes the paths it has for a system without a keyring: the create dialog, and the encrypt dialog once submitted, say secure key storage is not available, and the key store logs a warning for each refused wrap.

## PR plan

1. **Move `platform-jwt` to `src/shared/auth/`**, without behaviour change.
2. **Auth mode, access gate and admin config file.** Deny-by-default IPC, the config file and its trust checks, local accounts off, the sign-in screen that says sign-in is required or why the file was refused. A configured desktop stays locked; without the file nothing changes. Carries the default-preservation evidence.
3. **Signing in, binding and lock.** The sign-in through the system browser, the open guard, the locks and `requirePassphrase`, server workspaces off, the lock button and the guide.

Separate from the feature: the database picker's password dialog does not show an error that the open throws (an unhandled rejection); a catch in `PasswordDialog.vue` fixes it for every such error, a refused open included.

## Verification

The tests of all three PRs; each arrives with its PR.

| Level | What | Where |
|---|---|---|
| L5 E2E | built app, windows hidden: startup smoke, interaction gates, the sign-in screen and refusals; opt-in against a real Keycloak: enrolment, sign-in, lock, a second account kept off the first one's database, an account outside the group refused | `tests/e2e/desktop-sign-in.e2e.ts`, `tests/e2e/desktop-sign-in-keycloak.e2e.ts` |
| L4 Artifacts | `out/` hashed file by file against `main` | evidence run |
| L3 Suite | full Vitest run on `main` and the branch, compared test by test | evidence run |
| L2 Integration | every channel the real `registerIpcHandlers` registers is refused while locked except the allowlist, and only `jobs`/`debug` answer before the database opens; the registrars against `main`'s composition over generated channels, arguments, results and errors; binding, passphrase-only and lock against a real `DatabaseManager` and `DbKeyStore`; open failures wrapped without a guard as before; the key-wrap switch on the real instance | `tests/main/ipc/ipc-access.test.ts`, `tests/main/ipc/registrars.test.ts`, `tests/main/auth/desktop-data-binding.test.ts`, `tests/main/auth/database-manager-guard.test.ts`, `tests/main/auth/os-key-wrap.test.ts` |
| L1 Unit | gate, config file, Windows ACL, sign-in against a simulated provider with real keys and a real loopback port, session lock, `DesktopAuth` with faked dependencies, renderer store and screens | `tests/main/auth/`, `tests/main/ipc/handlers/desktop-auth.test.ts`, `tests/renderer/` |
| L0 Structure | the only holders of the raw `ipcMain`; no `webContents.ipc` | `tests/main/ipc/ipc-raw-holders.test.ts` |

## Evidence

Recorded on 2026-10-24 on macOS (arm64), Node 24.15.0, Electron 43, against `main` at `779a6d25` (v0.91.0), with Electron windows hidden (`VARLENS_E2E_HIDE_WINDOW=1`).

| | PR 1 | PR 2 | PR 3 |
|---|---|---|---|
| L3 Vitest, `main` and `renderer` projects, compared test by test with `main` | no test changes status | no test changes status; 66 new tests pass | no test changes status; 136 new tests pass (six `DbPool` tests skip in a checkout without a built `out/`, on `main` too) |
| L4 `out/`, SHA-256 per file; differing files compared with chunk hashes masked | identical: 55 of 55 files in `out/main`, 1 of 1 in `out/preload`, 114 of 114 in `out/renderer` | `out/main`: only `index.js` carries changed code, 8 shared chunks are only renamed. `out/preload`: the new method. `out/renderer`: new lazy chunks `SignInApp` and `VContainer`; the other chunks differ only in the minified aliases of the names they import from the shared index chunk | as PR 2; in `out/main` also the shared chunk with the auth write operations (the write worker runs `bindPlatformIdentity` too) and one chunk whose `require` lines of Node built-ins change order and gain `http` |
| L5 E2E | | startup smoke, the four interaction gates, the sign-in screen and its refusals: pass | as PR 2, and the Keycloak flow against a local Keycloak: pass |

`make lint-check`, `make format-check`, `make typecheck` and `make agent-check` pass on PR 2 and PR 3; `make web-gate-static` gives 1131 passed and 1 expected failure on both, as recorded for `main`.

## Not covered yet

- The Windows ACL check and the PowerShell read have run against recorded descriptors only, not on a Windows host; owed before release, including the `icacls` steps of the guide and Constrained Language mode, where the script is likely refused and the desktop stays locked (fail closed).
- Fail closed has a price on Windows: a standard user who creates `C:\ProgramData\VarLens` or the file before an administrator does keeps VarLens locked for everyone on that computer. Treating an untrusted file as absent would instead let a mistake in an administrator's permissions switch the sign-in off, so this stays accepted and documented.
- Settings shared by one computer account are not tied to the identity yet: the renderer's last database path and annotation author name, and the recent-databases list, which shows the next account the names and paths of the last one's databases (VarLens still refuses to open them) and prefills the last one's name as annotation author.
- Two Windows paths come from environment variables a user controls: `%ProgramData%` (the second config path, needed on a Windows installed to another drive) and `%SystemRoot%` (where the PowerShell for the check is found). With either, a user can start VarLens without the sign-in or with a config of their choosing; the computer account could unwrap its own OS-wrapped keys anyway, so the guide recommends `requirePassphrase` there.
- A re-key already queued when a lock starts can hand the read pool its new key for the moment until the pool ends.
- A handler that passed the gate before a lock and waits on a native dialog (save or open file) continues when the dialog returns, against whatever database is current then.
- A refusal of the default database after sign-in is logged, not shown.
- A binding cannot be handed over: a re-created account or a changed issuer is a new identity; an administrator opens the database without the config file.
