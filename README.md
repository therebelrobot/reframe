# Reframe

A self-hosted thought record journal for anxiety, built phone-first. Log the moment in six short steps (situation, feelings, body, thoughts, a balanced view, response), reuse tags for the things that keep coming up, and watch how strong the feelings are, and how much they shift, over time.

Everything you write is encrypted at rest with a key derived from your passphrase. The server cannot read your journal while it is locked, and a restart locks it.

## Run it

```sh
docker compose up -d
docker logs reframe   # prints the one-time setup token on first start
```

Put it behind Nginx Proxy Manager (or any TLS-terminating proxy) at something like `https://journal.example.com`, then open it on your phone and use **Add to Home Screen**. It must be served over HTTPS: the session cookie is `Secure`-only.

Proxy settings that matter:
- Forward to `<docker-host>:8787`, enable **Force SSL** and **HSTS**.
- Set `REFRAME_TRUST_PROXY=true` so rate limiting sees the real client IP (taken from the rightmost `X-Forwarded-For` hop, the one your proxy appends).
- Set `REFRAME_PUBLIC_ORIGIN` to the exact public origin; state-changing requests from any other `Origin` are refused.
- Consider restricting it to your LAN or VPN in the proxy (access list). There is no reason for a personal journal to be reachable from the whole internet.

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `REFRAME_PORT` | `8787` | Listen port |
| `REFRAME_DATA_DIR` | `./data` (`/app/data` in Docker) | Where `reframe.db` lives |
| `REFRAME_SETUP_TOKEN` | random, logged at start | Required to create the journal, so nobody else can claim a fresh instance |
| `REFRAME_TRUST_PROXY` | `false` | Read client IPs from `X-Forwarded-For` |
| `REFRAME_PUBLIC_ORIGIN` | from `Host` | Expected `Origin` for state-changing requests |
| `REFRAME_COOKIE_SECURE` | `true` | `false` only for local development over plain HTTP |
| `REFRAME_SESSION_IDLE_MINUTES` | `30` | Lock after this long without activity |
| `REFRAME_SESSION_MAX_HOURS` | `12` | Lock after this long regardless |
| `REFRAME_SCRYPT_N` | `131072` | scrypt cost for a new journal (fixed for the life of that journal) |

## Reports and Guava

**Insights → Make a report** (also under Settings → Export) builds a report for a therapist from a date range: a summary (averages, weekly trend, most common tags, which responses helped) and each record in full. You can leave out what you wrote and keep only ratings and tags, include or skip drafts, and untick individual records. **Print or save as PDF** uses the browser's own print dialog; on iPhone choose Print, then Share.

**Download CSV for Guava** exports the same selection as a long-format CSV, one row per measurement: `Date, Time, Timestamp, Metric, Value, Unit, Notes`. Each feeling is a metric rated 0–100 (`Anxious`), with its re-rating as `Anxious (after)`, plus one `Thought record` row per entry whose Notes carry a short summary (only when written text is included). In Guava, import it under Data Sources › Data Imports and map the columns, or upload the PDF under Data Sources › File Uploads. Guava hasn't published its CSV import format, so the column mapping may need adjusting once you see its import screen.

Both are built in the browser from the records you already have open; the server only logs that a report or export was made. The files themselves are not encrypted.

## How it protects your records

**Encryption at rest (envelope encryption).** At setup the server generates a random 256-bit data key. That key is stored only in wrapped form: AES-256-GCM encrypted under a key derived from your passphrase with scrypt (N=2^17, r=8, ~128 MiB), and a second copy under a key derived from a one-time recovery code. Every tag and entry is a single AES-256-GCM ciphertext whose authenticated data names its table and row id, so rows can't be swapped or replayed. The only plaintext in the database is random row ids, the key-wrapping material, and the access log (time, event, IP, user agent). SQLite runs with `secure_delete` so deleted records are overwritten.

**The key lives only in memory, only while unlocked.** Unlocking unwraps the data key into the server's memory for that session; locking, idling out, or restarting zero-fills it. A copied database file or backup is ciphertext without the passphrase.

**What that means for backups:** back up `reframe.db` (plus `-wal`/`-shm` if present, or stop the container first) as often as you like. They are useless without your passphrase or recovery code, and **if you lose both, the journal cannot be recovered by anyone.**

**Sign-in.** Passphrase (12+ characters), optional authenticator app code (TOTP, RFC 6238, replay-protected; its secret is itself encrypted with the data key). The recovery code resets the passphrase, turns off the authenticator, and is replaced with a new one on use. Changing the passphrase signs out every other device.

**Brute force.** scrypt makes each guess cost about a second of CPU. On top of that, after 5 failures an IP is locked out for 30 s, doubling to a 1-hour cap, and more than 30 failures in 15 minutes from anywhere locks everyone out for the window.

**Web hardening.** Session cookie is `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`; the token is random and only its SHA-256 is held server-side. Every state-changing request must carry a custom header (forcing a CORS preflight that is never granted) and a same-origin `Origin`. Strict CSP with no inline scripts or styles and no third-party origins, `frame-ancestors 'none'`, `no-referrer`, HSTS, `Cache-Control: no-store` on every API response, `noindex`. Static files are served from an allow-list built at startup, so there is no path traversal surface. Errors never echo request content into logs.

**In the browser.** Decrypted records live only in React state. Nothing is written to localStorage, IndexedDB or a service worker cache. The tab locks itself after the idle window even if you never touch it, and the page blurs while the app is in the background so app-switcher snapshots don't show your records. Exports (CSV, JSON, the Guava CSV and printed reports) are plaintext by design and are logged; CSV cells are neutralized against spreadsheet formula injection.

**Container.** Runs as the unprivileged `node` user from a read-only root filesystem with all capabilities dropped and `no-new-privileges`; the runtime image holds only Node and one bundled file, no `node_modules`.

### What it does not protect against

- Someone who can run code on the server **while the journal is unlocked** can read the key from memory. Keep the host patched and the idle timeout short.
- A compromised phone or browser sees what you see.
- Timing metadata: the access log records when you unlock, and row count reveals how many records exist.
- This is a personal tool, not a HIPAA-covered system. If you share exports with a clinician, choose the channel deliberately.

## Develop

```sh
npm install
npm run dev:server   # API on :8787, plain-HTTP cookies, ./data
npm run dev:client   # Vite on :5173, proxies /api
npm test             # crypto, API flows, insights math (node:test)
npm run typecheck
npm run build        # dist/public + dist/server.mjs
```

Stack: Hono on Node (24 in the image, 22.13+ works), `node:sqlite`, React 19 + Vite, zod for request validation. Five runtime dependencies; the server builds to a single esbuild bundle.

There is no ORM on purpose: every row is a ciphertext blob keyed by a random id, so there are no columns to model, query or migrate; the five SQL statements per table sit in `server/repositories.ts`.

Releases: `npm run release:patch` tags `vX.Y.Z` and pushes; `.github/workflows/release.yml` runs the tests, then calls the shared multi-arch workflow (amd64 + arm64 to `ghcr.io/therebelrobot/reframe`, with signed build provenance). Replace `REPLACE_WITH_COMMIT_SHA` with the shared workflow's commit before the first release, and pin the `actions/*` steps to SHAs.

## Manual checks worth doing on a real phone

Automated tests cover the server; these depend on the device:

- [ ] Add to Home Screen opens standalone, and the bottom bar clears the home indicator.
- [ ] Sliders drag smoothly with a thumb; the ghost mark sits under the original rating when re-rating.
- [ ] Switching apps blurs the journal in the app switcher.
- [ ] Leaving the app open past the idle window shows the unlock screen.
- [ ] The authenticator link opens your authenticator app on iOS.
- [ ] Password manager offers to fill the passphrase on the unlock screen.
- [ ] CSV export opens correctly in your spreadsheet app.

## License

Unlicense.
