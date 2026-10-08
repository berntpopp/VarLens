# Web Runtime Contract

Status: Current for the web app branch

This app repository owns the web server, browser bundle, container image, and
database migrations. Infrastructure and operator automation live outside this
repository and consume the image as an immutable artifact.

## Image Contract

| Contract | Value |
| --- | --- |
| Image | `ghcr.io/<owner>/varlens-web:<tag>` or a pinned digest |
| Process | `node out/web/server.cjs` via `tini` |
| User | uid/gid `1001` (`varlens`) |
| Internal port | `8080` |
| Health endpoint | `GET /healthz` |
| Writable runtime path | `/data` by default |

Operators may remap the external port and route traffic through any reverse
proxy. The container's internal port and healthcheck remain fixed at `8080`.

## Required Runtime Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `VARLENS_PG_URL` | yes | PostgreSQL connection URL. Web mode refuses to boot without it. |
| `VARLENS_PG_SCHEMA` | no | PostgreSQL schema. Defaults to `public`. |
| `VARLENS_RECOVERY_KEY_DIR` | recommended | Absolute directory for session-secret material. Defaults to `/data`. |
| `VARLENS_SESSION_SECRET_HEX` | no | Optional 32-byte hex session secret. If absent, the server seals one in the recovery directory. |
| `VARLENS_WEB_UPLOAD_DIR` | no | Absolute directory for browser-upload staging. Defaults to `${VARLENS_RECOVERY_KEY_DIR}/uploads` (`/data/uploads` in the chart). |
| `VARLENS_WEB_MAX_UPLOAD_BYTES` | no | Maximum accepted browser upload size in bytes. Defaults to `1073741824` (1 GiB). |
| `VARLENS_WEB_UPLOAD_TTL_MS` | no | Staged upload lifetime before lazy cleanup. Defaults to `86400000` (24 hours). |
| `VARLENS_ADMIN_USERNAME` | first boot only | Optional one-shot admin bootstrap username. |
| `VARLENS_ADMIN_PASSWORD_HASH` | first boot only | Optional one-shot Argon2id admin bootstrap hash. Plaintext bootstrap is refused. |
| `VARLENS_ADMIN_DISPLAY_NAME` | first boot only | Optional display name for the bootstrap admin. |
| `VARLENS_LOG_LEVEL` | no | Pino log level. Defaults to `info`. |
| `VARLENS_WEB_TRUST_PROXY` | behind a proxy | Proxy hop count (e.g. `1`) or comma-separated proxy IPs/CIDRs whose `X-Forwarded-*` headers are trusted. Unset = none; the login rate limit is then keyed on the proxy's address for every user. |

Bootstrap variables are intentionally one-shot. After an admin exists, the
server logs that env-based rotation is ignored; password changes happen through
the authenticated app flow.

## Single Replica

Run exactly one server process per deployment. This is a hard requirement, not
a sizing hint: the following state lives in that process's memory and is not
shared.

| State | With a second replica |
| --- | --- |
| Upload staging index | upload on A, `import:start` on B → 404 |
| Download grants (signed with a per-process key) | a link prepared on A is rejected by B |
| Batch-import runs, job registry, SSE events | progress and cancel reach only the owning replica |
| Logout revocations | a logout on A is not honoured on B |
| Rate-limit counters | every limit is multiplied by the replica count |

Cookie affinity (sticky sessions) covers the first three rows only; revocation
and rate limits stay per replica, so affinity does not make multiple replicas
safe. A restart also clears all of the above: staged uploads are deleted at
boot, in-flight jobs stop, and revocation entries are forgotten (session
cookies expire server-side after 4 hours).

## URL Prefix Contract

The browser bundle and server redirects must agree on the public path prefix:

| Layer | Variable | Example |
| --- | --- | --- |
| Browser build | `VARLENS_WEB_BASE` | `/varlens/` |
| Server runtime | `APP_PATH_PREFIX` | `/varlens` |

`VARLENS_WEB_BASE` is build-time because Vite embeds asset and API paths into
the browser bundle. `APP_PATH_PREFIX` is runtime because the login wall and
redirects are rendered by the server. If the operator serves the app at `/`,
build with `VARLENS_WEB_BASE=/` and run with `APP_PATH_PREFIX=/`.

Reverse proxies that strip a prefix before forwarding to Fastify are supported,
provided browser-visible URLs still use the same prefix configured above.

## Deployment Boundary

The app repository does not own:

- cloud resources
- DNS/TLS automation
- production Compose files
- Caddy, uptime, log-viewer, or backup configuration
- OpenTofu/Terraform state
- operator credentials or recovery runbooks

The deploy repository should pin an image digest produced by the app repository
and provide the runtime environment described here.
