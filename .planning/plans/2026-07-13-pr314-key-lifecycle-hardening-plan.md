# PR 314 key-lifecycle hardening implementation plan

1. Add focused failing tests for `basic_text`, deferred recovery enrollment, initial sidecar failure, verified-session passphrase rotation, managed deletion cleanup/recreate, sidecar bounds, and renderer semantics.
2. Harden `DbKeyStore` capability detection and add the verified-DEK passphrase replacement seam.
3. Defer lifecycle recovery mutations until database verification and fail passphrase-only provisioning closed.
4. Clean key artifacts during deletion and validate sidecar input bounds.
5. Align mock API and renderer recovery controls with the backend contract.
6. Run focused Vitest suites, typecheck, agent-check, review the diff for secret handling and crash durability, then commit without pushing.
7. Add failing tests for pending migration reconciliation, post-swap reopen failure, optional-sidecar visibility, streaming content hashes, and backup/delete durability.
8. Implement pending-key activation/removal at verified open boundaries, stream content hashing, and harden migration durability and result reporting.
