# PR 314 key-lifecycle hardening

## Goal

Close the key-lifecycle and recovery-sidecar security gaps found during PR 314 review without broadening the encryption architecture.

## Invariants

- Electron `safeStorage` is usable for managed keys only when encryption is available and the selected backend is not Linux `basic_text`.
- Password resolution is read-only. Registry enrollment or path repointing happens only after SQLite accepts the recovered DEK.
- A passphrase-only create or plaintext migration succeeds only when both registry and portable recovery sidecar are durable.
- Recovery-passphrase replacement uses the DEK from the already-open, verified database session and reports a sidecar replacement failure explicitly.
- Deleting a managed database removes its registry mapping and recovery sidecar after the database file is deleted, allowing the path to be recreated.
- Recovery sidecars are bounded and every decoded cryptographic field has its exact expected size.
- Renderer visibility and error states reflect whether a database is actually key-managed and whether portable recovery was written.
- Plaintext migration keys remain `pending` until the encrypted file is reopened successfully. A later verified encrypted open activates the entry; a later verified plaintext open removes the abandoned pending entry.
- Migration verification streams table rows instead of materializing WGS-sized tables in memory.
- Once the encrypted swap has completed, an application reopen failure never attempts to reinterpret the encrypted file as plaintext.
- Plaintext backups and their deletion receive the same file/directory durability treatment as key-registry and sidecar writes.

## Design

Keep the existing `DbKeyStore` and handler boundaries. Add a single secure-storage capability check, represent sidecar recovery as a deferred action returned by password resolution, and add a narrowly named key-store method that writes a new passphrase wrap for a caller-supplied verified DEK. The lifecycle handler is the authority for that DEK because it obtains it from the current open `DatabaseService`.

Passphrase-only provisioning is transactional at the orchestration boundary: if sidecar persistence fails, remove the new registry entry and sidecar and do not create or migrate the database. Existing managed databases remain usable if a replacement sidecar write fails, so that operation returns partial failure and the UI keeps the dialog open with a recovery warning.

Migration provisioning uses pending registry entries. The low-level migration removes them on any pre-swap/rollback failure. A successful encrypted reopen activates the entry. On a later launch/open, plaintext detection proves a pending migration never swapped and permits safe removal; encrypted verification proves the swap completed and permits activation. Legacy registry entries without a state field are active.

Deletion cleanup occurs only after the primary database unlink succeeds. Sidecar parsing rejects files larger than 64 KiB, noncanonical base64, and decoded fields whose sizes differ from the encryption format.
