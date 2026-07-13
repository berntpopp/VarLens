# Database Encryption

VarLens stores your variant data in a local SQLite database. **New databases are
encrypted at rest by default** so that a copy of the database file alone — on a
lost laptop, a stolen drive, or an unattended backup — cannot be read without the
key.

## What encryption protects against (and what it doesn't)

**Protects against — offline file theft.** If someone obtains only your database
file (`.db`), they cannot open it or read any case, variant, or phenotype data
without the encryption key. The database pages are protected by SQLite3 Multiple
Ciphers using its default `sqleet` cipher (ChaCha20-Poly1305).

**Does _not_ protect against** a running, unlocked VarLens on your machine, malware
running as your user account, or anyone who has both the database file **and** your
key (or your recovery passphrase). Encryption-at-rest is one layer, not a
substitute for OS-level account security.

## How the key is stored, per platform

By default VarLens generates a random per-database key and stores it using the
operating system's secure credential store (Electron `safeStorage`):

| Platform | Key protected by |
| --- | --- |
| **macOS** | Keychain |
| **Windows** | DPAPI (your Windows user account) |
| **Linux (desktop)** | GNOME Keyring / KDE Wallet (via libsecret / kwallet) |

When a secure store is available, encryption is fully transparent — you never see a
password prompt; VarLens unlocks the database automatically on your machine.

### The honest Linux caveat

On a Linux system **without** a desktop keyring (a headless server, a minimal
install, some container environments), the OS secure store is unavailable. VarLens
**detects this** — it never silently pretends to encrypt with a throw-away key.
Instead, when you create a database on such a system, VarLens asks you to **set a
database password**, and the key is derived from that password (via scrypt). Your
password is never stored insecurely; you enter it when opening the database.

## Recovery: set a passphrase before you move or back up a database

::: warning IMPORTANT — the transparent key does not travel
A transparently-managed key lives **only** in your machine's OS keyring. It is
**not** inside the database file and is **not** copied when you copy the `.db`
file. That means, unless you have set a recovery passphrase:

- **Reinstalling your OS, resetting your keychain, or wiping your user profile
  destroys the key — and the encrypted data becomes permanently unrecoverable.**
- **Copying the database to another computer** will fail to open there, because the
  new machine's keyring does not have the key.
:::

To keep your data recoverable and portable, **set a recovery passphrase**:

1. Open the database.
2. From the database menu, use **Set Recovery Passphrase...**.
3. Store that passphrase somewhere safe (a password manager).

A recovery passphrase wraps the same database key, so the database can then be
opened on any machine — or after a keyring loss — by entering the passphrase. Set
one **before** backing up or transferring a database.

Setting a recovery passphrase also writes a small `<db>.varlens-recovery.json`
sidecar file next to your database. Portability requires copying **both** the
`.db` file **and** its `.varlens-recovery.json` sidecar, plus knowing the
passphrase — copying the `.db` file alone is not enough, even with a recovery
passphrase set.

## Encrypting an existing (unencrypted) database

Databases created before encryption-by-default remain readable and are **not**
changed until you choose to encrypt them. When you open an unencrypted database,
VarLens offers a one-time **Encrypt this database** migration. The migration is
designed to be safe:

1. It builds a fully **encrypted copy** and verifies its integrity **before**
   touching your original.
2. It writes a **plaintext backup** of your original and verifies that backup can
   be opened.
3. Only then does it atomically swap the encrypted database into place.
4. If **any** step fails, it rolls back — you are never left without a working
   database.

You are prompted for consent first, and encouraged to set a recovery passphrase as
part of the migration.

::: warning Delete the plaintext backup when you're done
The migration keeps a `…plaintext-backup-…` file next to your database so you can
roll back if needed. That backup is **unencrypted** — it contains a full readable
copy of your data. Once you've confirmed the encrypted database opens correctly,
use **Delete plaintext backup** to remove it, or delete it yourself. Leaving it in
place defeats the purpose of encrypting.
:::

## Summary

- New databases are **encrypted at rest by default**.
- The key is protected by your OS keyring where available; otherwise VarLens asks
  you to set a password (and never fakes encryption).
- **Set a recovery passphrase** before moving or backing up a database — the
  transparent key does not travel with the file, and losing it means losing the
  data. Bring the `.varlens-recovery.json` sidecar along with the `.db` file.
- Existing unencrypted databases can be encrypted with a consented, backed-up,
  reversible migration; delete the plaintext backup afterward.
