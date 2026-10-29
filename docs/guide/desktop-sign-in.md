# Desktop Sign-in

By default VarLens Desktop has no sign-in: whoever uses your computer account
uses VarLens. An administrator can require a sign-in through your organisation's
identity provider instead. VarLens then shows no data until you sign in.

## Three setups

| Setup | Sign-in | Switched on by |
| --- | --- | --- |
| **Desktop** (default) | none | nothing to configure |
| **Desktop with sign-in** | your organisation's identity provider, in your browser | an administrator's config file on the computer |
| **Web** | the web server's login | the server operator |

Without the config file, nothing changes: VarLens works offline and opens your
databases as it always has.

## Signing in

VarLens shows **Sign in with your browser**. Your browser opens your
organisation's sign-in page; sign in there with your password and the code from
your authenticator app. VarLens then opens your data.

The first time, the sign-in page asks you to set a new password and to set up an
authenticator app. That first sign-in only sets the app up, so VarLens asks you
to sign in once more with your password and a code.

If your account may not use VarLens Desktop, VarLens says so; ask your
administrator for access.

## Configure the sign-in (administrators)

Put this file on the computer:

| System | File |
| --- | --- |
| **Windows** | `C:\ProgramData\VarLens\auth.json` |
| **macOS** | `/Library/Application Support/VarLens/auth.json` |
| **Linux** | `/etc/varlens/auth.json` |

```json
{
  "mode": "platform",
  "issuer": "https://identity.example.org/realms/varlens",
  "clientId": "varlens-desktop",
  "audience": "varlens-desktop",
  "requiredAcr": "urn:varlens:acr:password-plus-totp",
  "requiredAmr": ["pwd", "otp"],
  "access": { "claim": "groups", "value": "/varlens-desktop" }
}
```

| Key | Meaning |
| --- | --- |
| `issuer` | Your identity provider's OpenID Connect issuer, exactly as it appears in its tokens. Must use HTTPS, with a certificate the computer trusts: VarLens and the system browser check it against the trust store (the operating system's; on Linux the NSS database `~/.pki/nssdb`, per user; Firefox keeps its own). Otherwise the sign-in screen says a secure connection could not be made. |
| `clientId` | The public client VarLens Desktop signs in as. |
| `audience` | The audience the access token must carry. |
| `requiredAcr`, `requiredAmr` | The authentication level and methods every sign-in must prove, for example a password plus an authenticator-app code. |
| `access` | Who may use VarLens: the access-token claim that must contain the value, for example membership in a group. |
| `idleLockMinutes` | Optional, default 15: lock after this many minutes without input (1 to 240). |
| `maxSessionMinutes` | Optional, default 480: sign in again after this many minutes at the latest (15 to 1440). |
| `requirePassphrase` | Optional, default `false`: open only databases protected by a passphrase. Use it when several people share one computer account. |

**Only administrators may be able to change the file and its folder.** VarLens
checks that and refuses the file otherwise:

- **macOS and Linux:** file and folder owned by `root`, not writable by group
  or others, no symbolic link. The file must be readable by every user.
- **Windows:** file and folder owned by Administrators, SYSTEM or
  TrustedInstaller, and nobody else may change or delete them. Create the folder
  yourself; never use a `VarLens` folder you did not create, since standard
  users may create folders under `C:\ProgramData` and then own them. Replace the
  inherited permissions, which would give your own account full control, and
  make Administrators the owner. Run this in an elevated Command Prompt, and
  stop if `mkdir` reports that the folder already exists:

  ```bat
  mkdir C:\ProgramData\VarLens
  icacls C:\ProgramData\VarLens /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX"
  icacls C:\ProgramData\VarLens /setowner *S-1-5-32-544
  rem Now write auth.json into the folder, then:
  icacls C:\ProgramData\VarLens\auth.json /reset
  icacls C:\ProgramData\VarLens\auth.json /setowner *S-1-5-32-544
  ```

  The check uses Windows PowerShell; it must be allowed to run for every user,
  in Full Language mode (not restricted by AppLocker or WDAC script rules).
  On a Windows installed to another drive, VarLens finds the file through
  `%ProgramData%`. A user can point that variable elsewhere before starting
  VarLens and so start it without the sign-in; on such computers also set
  `requirePassphrase`, so the data stays behind a passphrase either way.

A file or folder that cannot be checked, or a file that cannot be read or
parsed, keeps VarLens locked and shows why. Fix it and start VarLens again.
This also means that on Windows a standard user who creates
`C:\ProgramData\VarLens` before you do can keep VarLens locked for everyone on
that computer; VarLens never falls back to running without sign-in.

The identity provider needs a public client for a native app (RFC 8252): the
authorization code flow with PKCE (S256), redirects to `http://127.0.0.1/callback`
on any port, and no client secret. Tokens are signed with RS256, carry a key id
(`kid`), and carry `iat` and `exp`. The ID token carries `sub`, `nonce`, `acr`, `amr` and `auth_time`;
the access token carries the audience, `azp` (the client), the same `sub` and
the access claim. VarLens asks for a fresh login every time, checks all of
this, and keeps no token after the check.

## What the sign-in means for you

- **No data without signing in.** Your databases, recent files and settings stay
  closed until you sign in.
- **VarLens locks itself.** After the idle time, at the latest after the maximum
  session length, and when your computer locks its screen or goes to sleep,
  VarLens closes your data and asks you to sign in again. The lock button in the
  toolbar locks it at once. Running imports, exports and other jobs are
  cancelled; background work such as a summary rebuild finishes first. On Linux
  the screen lock is detected where the desktop reports it (often not under
  Wayland), and under Wayland the idle time may not be reported either; the
  maximum session length applies everywhere.
- **Your databases belong to you.** The first account that opens a database in
  VarLens owns it; VarLens refuses to open it for anyone else, even on the same
  computer. When several people share one computer account, the second person
  therefore starts without the default database. The binding is permanent: an
  account deleted and re-created at your identity provider, or a changed
  issuer, counts as a new account. The binding cannot be moved; a VarLens
  without the config file still opens the database, so an administrator can
  get the data out of it.
- **Passphrases on shared computers.** With `requirePassphrase`, VarLens opens
  only databases protected by a passphrase, and new databases need one, so
  people who share a computer account cannot open each other's data. VarLens
  then stores no new key with the operating system, as on a computer without
  secure key storage, so creating or encrypting a database asks for a
  passphrase. Databases that the computer account could already unlock stay
  closed once the option is on; create new ones with a passphrase.
- **No server workspaces.** PostgreSQL workspaces cannot be opened while the
  sign-in is configured: VarLens can bind only databases on this computer to
  an account. A config file together with
  `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres` keeps VarLens locked.
- **Shared computer accounts share some settings.** The next person sees the
  list of recent databases and the database the previous one opened last,
  though VarLens refuses to open them for anyone else, and the annotation
  author name the previous person entered, until they change it.
- **Local accounts are off.** Accounts that a database may hold for the
  built-in login are not used while the sign-in is configured.
