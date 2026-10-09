# Render Free: audited persistent WhatsApp authentication

## Audit findings and chosen architecture

The installed and locked `whatsapp-web.js` is **1.34.7**, with Puppeteer **24.38.0**. It is pinned to prevent an unreviewed authentication API change. Existing Prisma and adapter packages are **7.9.0**. They require Node `^20.19`, `^22.12`, or `>=24`; use a Render Node version in that supported range.

Original issues:

1. `LocalAuth` wrote to `WHATSAPP_SESSION_DATA_PATH/session` (normally `.wwebjs_auth/session`). Render Free's filesystem cannot preserve this across restarts, redeploys, or sleep.
2. `initialize()` could create another client every time it was called. Both reconnect APIs could race with startup.
3. Disconnection events were logged without a recovery strategy. `client.info` could report a stale connected state.
4. QR contents were printed with `qrcode-terminal`, exposing authentication material in Render logs.
5. HTTP startup waited on SQL connectivity; a SQL outage prevented health checks from responding.
6. The normal Node service must install Puppeteer's matching Chrome during the Render build; a missing browser otherwise appears only as a generic WhatsApp retry.
7. Production env examples were missing required AI/Sheets variables and used `SESSION_DATA_PATH`, which the application does not read.
8. The MySQL URL parser treated query text as part of the database name and did not decode escaped credentials.
9. No root `.gitignore`, `.dockerignore`, or Render blueprint protected session files and credentials.
10. The root Google API import loaded every Google API at startup. The Sheets-only entry point of the installed package now provides the same client/auth API with less cold-start work and memory use.

### Persistent storage decision

Use the supported **RemoteAuth + wwebjs-mongo 1.1.0 + Mongoose 8.24.5** architecture with external MongoDB (Atlas Free is suitable for testing). MySQL remains the database for leads, messages, and assignments. No bot commands or lead-classification/assignment logic were replaced.

MongoDB stores the standard RemoteAuth ZIP as GridFS files/chunks. Local profile directories and ZIPs are temporary/private staging, never the persistence guarantee. No authentication archive is stored in GitHub, an env variable, a public directory, or logs.

Switching the existing LocalAuth installation to RemoteAuth requires one initial remote pairing. Existing local files are left intact, but are not uploaded blindly as if they were a validated RemoteAuth snapshot.

The inspected versions need small compatibility/reliability wrappers:

- WhatsApp 1.34.7 creates `<dataPath>/<session>.zip`, whereas MongoStore 1.1.0 reads `<working-directory>/<session>.zip`. A private temporary file bridge calls the supported store's `save()` and removes the bridge afterward.
- Published MongoStore extraction does not catch source-stream errors, and its `delete()` starts unawaited deletions. The adapter uses the same MongoDB GridFS bucket/filename format with `pipeline()` for extraction and awaited deletion. It does not invent a new session format.
- Upstream `RemoteAuth.disconnect()` deletes the archive even for some connection-state errors. Our reviewed subclass retains it on generic disconnect and deletes it only on actual logout or the explicit admin reset endpoint.
- Upstream backup callbacks can reject without a handler. Backups are caught, retried periodically, and serialized to prevent two compressions writing the same ZIP.
- A real ZIP round-trip test exposed upstream extraction resolving on `finish` before restored files were closed. The subclass waits for unzipper's documented extraction completion promise before launching Chromium.
- A MongoDB lease prevents two Node processes for the same client ID from opening browsers/writing archives during Render's deploy overlap. The old process releases it after cleanup; after abrupt death it expires in 90 seconds. An unavailable lease/storage stops the client rather than starting a second one.
- A heartbeat can renew only an unexpired lease. A late heartbeat failure from a stopped lifecycle cannot stop the next client after it reacquires the lease.

## Exact Render configuration

Use **New → Web Service**, GitHub repository, **Node** runtime, **Free** plan.

| Setting | Value |
| --- | --- |
| Repository | Whole project, not only `dashboard` |
| Branch | The branch containing the backend files above, normally `main` |
| Root directory | Blank (repository root) |
| Node version | A version supported by `package.json` engines (`22.12+` or `24.x`) |
| Build command | `npm ci && PUPPETEER_SKIP_DOWNLOAD=false npx puppeteer browsers install chrome && node scripts/verify-puppeteer-install.js` |
| Start command | `npm start` |
| Health check path | `/health` |
| HTTP port/host | `process.env.PORT || 10000`, `0.0.0.0` |
| Persistent disk | Not needed for authentication; Free does not support one |
| Instances | One bot instance per `WHATSAPP_CLIENT_ID` |

You can also use **New → Blueprint** with the included `render.yaml`. Render prompts for values marked `sync: false` and generates the admin token. Add the Google Secret File manually afterward. Do not deploy a second service with the same client ID and MongoDB URI except as the ordinary old/new overlap of one deployment.

The Node build keeps optional RemoteAuth dependencies, installs the exact Chrome revision selected by Puppeteer 24.38.0, and verifies that the executable exists before deployment. Leave `PUPPETEER_EXECUTABLE_PATH` and `PUPPETEER_SKIP_DOWNLOAD` unset; the build command overrides download skipping only for the explicit browser installation. The service uses the project-relative `./.wwebjs_auth` staging path because `/app` is a Docker-only path.

## Every backend environment variable

Paste actual values in **Render → service → Environment**, not source code. Do not include quotes when entering an individual value in the UI.

| Variable | Example / purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Do not set manually; Render injects the HTTP port |
| `DATABASE_URL` | `mysql://lead_user:URL_ENCODED_PASSWORD@public-db.example.com:3306/nexyrium?ssl=true` |
| `WHATSAPP_MONGODB_URI` | `mongodb+srv://wa_user:URL_ENCODED_PASSWORD@cluster.example.mongodb.net/whatsapp_auth?retryWrites=true&w=majority` |
| `WHATSAPP_CLIENT_ID` | `nexyrium` — keep this identical across restarts/redeploys |
| `WHATSAPP_SESSION_DATA_PATH` | `./.wwebjs_auth` — private temporary staging, not persistent storage |
| `WHATSAPP_BACKUP_INTERVAL_MS` | `300000` — periodic backups every 5 minutes; minimum `60000` |
| `ADMIN_API_TOKEN` | A random secret at least 32 characters long (generated by blueprint, or generate below) |
| `OPENROUTER_API_KEY` | Your existing OpenRouter API key |
| `OPENROUTER_MODEL` | Your existing model, e.g. `openai/gpt-3.5-turbo` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Your existing spreadsheet ID |
| `GOOGLE_SHEETS_CREDENTIALS_PATH` | `/etc/secrets/credentials.json` |
| `CRON_SCHEDULE` | `*/5 * * * *` — existing lead retry worker |
| `MAX_RETRIES` | `5` |
| `RETRY_DELAY_MS` | `5000` |
| `LOG_LEVEL` | `info` |
| `PUPPETEER_CACHE_DIR` | `./.cache/puppeteer` — keeps the build-installed browser with the Node service |
| `PUPPETEER_EXECUTABLE_PATH` | Leave unset; use Puppeteer's installed Chrome |
| `PUPPETEER_SKIP_DOWNLOAD` | Leave unset; the Render build explicitly enables the browser download |

Generate an admin token locally (this is an app-control token, not the WhatsApp archive):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Only copy it to Render's env settings and your private password manager. Do not build it into any `NEXT_PUBLIC_*` variable. **All `/api/*` dashboard, lead, status, QR, and control requests require this token**, except `/api/health`. The existing dashboard prompts for it and keeps it only in browser session storage. Concurrent initial requests share one prompt. If you cancel, reload the page to enter it; an incorrect token is removed so a later request can prompt again.

For the existing dashboard's deployment, set `NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.onrender.com` **without `/api`**. The actual `dashboard/src/lib/api.ts` already appends `/api/...`. The earlier instruction to append `/api` was incorrect for this codebase. Changing this value requires rebuilding that frontend. Your frontend is preserved; no extra frontend is required for first QR pairing.

If you deploy that existing frontend with its Dockerfile, its `NEXT_PUBLIC_API_URL` build argument must receive this value. Render makes service env values available as Docker build arguments; the frontend Dockerfile now declares/uses this argument. For local Compose, use `docker compose --env-file .env.production up -d --build` so the value is also interpolated into the frontend build. Compose mounts your existing `./credentials.json` read-only for the backend. Neither Docker context includes private `.env` files or local browser profiles.

## 1. Create external MongoDB storage

1. Open MongoDB Atlas and create a project and a Free cluster (if available in your selected region/account).
2. Under **Database Access**, create a dedicated password-authenticated database user, e.g. `wa_user`.
3. Grant `readWrite` on the database **`whatsapp_auth`**. Do not grant access to other application databases unnecessarily.
4. Under **Network Access**, allow your Render service's documented outbound IP ranges (available in Render service settings). Add all ranges for that service, including deployment traffic. If the connection times out, verify these entries and the chosen cluster region.
5. Choose **Connect → Drivers → Node.js** and copy the `mongodb+srv://` URI.
6. Replace the password placeholder with a URL-encoded password and put **`whatsapp_auth`** between the final hostname slash and `?retryWrites=...`.
7. Add that URI to Render as `WHATSAPP_MONGODB_URI`.

RemoteAuth creates GridFS collections after first save; do not insert session documents manually. For client ID `nexyrium`, the database will contain:

```text
whatsapp-RemoteAuth-nexyrium.files
whatsapp-RemoteAuth-nexyrium.chunks
whatsapp_session_leases
```

The file record should have filename `RemoteAuth-nexyrium.zip`, a nonzero length, and an upload date. Inspect only metadata. Do not download, expose, or print archive chunks/cookies/keys.

## 2. Keep/provision external MySQL for business data

The existing Prisma schema uses MySQL/MariaDB, not MongoDB or Postgres. MongoDB is solely the WhatsApp session store. Use a public, persistent MySQL service and its credentials for `DATABASE_URL`; Render's free managed Postgres is not a drop-in replacement.

Use an encrypted MySQL connection when required by your provider (`?ssl=true` is supported; certificate validation remains enabled). Percent-encode special characters in user/password. The backend pool replaces lost connections; an initial connectivity monitor retries every 30 seconds. SQL outages do not prevent HTTP liveness, but bot startup waits for SQL so first inbound messages are not knowingly consumed without storage. Do not assume messages during a later database outage are durably buffered; the existing capture flow has no durable inbound queue.

Apply schema changes from your Windows machine against the **external database**, before deploying:

```powershell
Set-Location "D:\watsappLeadAutomation - Copy"
$env:DATABASE_URL = "mysql://USER:URL_ENCODED_PASSWORD@PUBLIC_HOST:3306/DATABASE"
npx prisma migrate deploy
```

For an already-populated database created with `db push`, resolve/baseline its migrations first. On a disposable development database you can use `npm run db:push` to synchronize the schema. Do not reset production data. MySQL migrations are separate from MongoDB session storage.

## 3. Add the Google service-account Secret File

In **Render → Environment → Secret Files**, add:

- Filename: `credentials.json`
- Contents: your existing Google service-account JSON
- Matching env: `GOOGLE_SHEETS_CREDENTIALS_PATH=/etc/secrets/credentials.json`

Share the spreadsheet with the service-account email as an editor. Do not commit the JSON or paste its private key into logs.

## 4. Deploy from GitHub

1. Include the project root, `src`, Prisma schema/migrations, root package files, Dockerfile, blueprint, and docs in the repository. Previously only `dashboard` was a Git repo in this checkout; Render needs the backend files too.
2. The new root `.gitignore` and `.dockerignore` exclude `.env*`, credentials, local authentication directories, ZIPs, and installed dependencies. Exclusions do not remove secrets already tracked in Git; check tracked paths before uploading. If a key was published, rotate it.
3. Dependencies were added with:

   ```text
   npm install --save-exact mongoose@8.24.5 wwebjs-mongo@1.1.0
   ```

   Both package files are updated. For a clean checkout simply use `npm ci --include=optional`. The existing WhatsApp package is now pinned to `1.34.7`; no WhatsApp/Puppeteer/Prisma upgrade was performed.
4. Create the Docker Web Service with the exact table settings and env above.
5. Add the Secret File and deploy. Logs should show HTTP startup, lead database connectivity, session database connectivity, and WhatsApp initialization. No QR content is printed.
6. Open `https://YOUR-BACKEND.onrender.com/health` and confirm HTTP 200. This is liveness, not a guarantee that WhatsApp or SQL is ready. Use `/api/whatsapp/status` with the bearer token for WhatsApp state.

## 5. First QR scan (without exposing it in logs)

Use the existing dashboard's **Connections** page and enter `ADMIN_API_TOKEN` when prompted. Alternatively, retrieve a private PNG in PowerShell:

```powershell
$base = "https://YOUR-BACKEND.onrender.com"
$secureToken = Read-Host "Render ADMIN_API_TOKEN" -AsSecureString
$token = [System.Net.NetworkCredential]::new("", $secureToken).Password
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Uri "$base/api/whatsapp/status" -Headers $headers
$qrPath = Join-Path $env:TEMP "nexyrium-whatsapp-qr.png"
Invoke-WebRequest -Uri "$base/api/whatsapp/qr-image" -Headers $headers -OutFile $qrPath
Start-Process $qrPath
```

If the PNG endpoint returns 404, poll `/api/whatsapp/status` with `$headers`; it may still show initializing/restoring. Wait for `qrRequired: true` and retry. A restored valid session should not produce a QR. A browser address-bar visit to the status endpoint without a bearer token correctly returns 401.

On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**, then scan the private image. Remove the image afterward:

```powershell
Remove-Item $qrPath
```

## 6. First-save sequence and verification

The actual sequence is:

```text
First deploy
  → HTTP starts
  → MySQL succeeds (otherwise retry)
  → MongoDB connects and the session lease is acquired
  → RemoteAuth checks for a saved GridFS archive
  → no archive: create a temporary browser profile
  → qr event: retain QR only in memory/protected API
  → you scan
  → authenticated
  → ready (bot can receive messages)
  → wait at least 60 seconds for the profile to stabilize
  → compress required profile folders into the standard ZIP
  → upload through MongoStore to GridFS
  → remote_session_saved event
  → continue periodic backups every 300000 ms
```

**`ready` does not mean the first archive is saved.** Do not restart until logs show both:

```text
WhatsApp session saved remotely
WhatsApp first remote session backup confirmed
```

Also check `/api/whatsapp/status` for a non-null `remoteSessionSavedAt`, and Atlas **Browse Collections** for the file metadata above. The initial save can take longer than one minute; if MongoDB fails, the initial save is retried at the configured backup interval while the previous archive, if any, is kept.

## 7. Exact restart/redeploy test

1. Complete the first scan and verify the remote save in both logs and Atlas.
2. Send a message from another phone and confirm the existing lead capture/reply/Sheets flow works.
3. In Render, use **Manual Deploy → Deploy latest commit**. This exercises a fresh ephemeral container even if a restart button is unavailable on your account.
4. Keep `WHATSAPP_CLIENT_ID` and MongoDB URI/database identical. The new process may wait/retry while the old process owns the lease; an abrupt old-process death can cause a delay up to about 90 seconds plus retry backoff.
5. Watch for:

   ```text
   Initializing WhatsApp
   Restoring WhatsApp session from remote storage if available
   WhatsApp remote session archive downloaded
   WhatsApp session profile prepared
   WhatsApp authenticated
   WhatsApp ready
   ```

6. Verify `/api/whatsapp/status` reports `connected: true`, `qrRequired: false`, and `authStrategy: "RemoteAuth"`. The protected `/api/whatsapp/qr` should return `available: false`.
7. Send another message and confirm the bot handles it. Repeat with **Restart service** if Render offers it, then with another redeploy. Do not click reset-session during this test.

Expected restart sequence:

```text
Render restarts; old local files disappear
  → application starts; HTTP responds
  → Mongo lease acquired
  → standard archive is retrieved from external GridFS
  → unpack to a fresh temporary Chromium profile
  → launch browser and reconnect to WhatsApp
  → authenticated and ready
  → no QR, provided WhatsApp still accepts the saved credentials
```

The automated tests simulate lifecycle, archive restoration, startup outages, and races. A live phone, live MongoDB, real Chromium container, and actual Render deployment are needed to complete this end-to-end proof; those external resources are not supplied by this checkout.

## Recovery behavior and explicit invalidation

| Situation | Implemented behavior |
| --- | --- |
| Temporary WhatsApp disconnect | Retain archive, close old client, retry with exponential backoff (5s to 60s) |
| `TIMEOUT` / `OPENING` that doesn't recover | Allow 120s, then restart client from archive |
| Browser crash | Stop old lifecycle and reacquire lease before restoring |
| Initial Mongo failure | No blank client/QR fallback; retry storage and initialization |
| Mongo failure after startup | Driver reconnects; backup fails safely; lease loss stops browser and retries |
| Backup upload failure | Keep previous saved archive, retry next interval |
| SQL unavailable at startup | HTTP stays alive; probe every 30s before starting bot/worker |
| Normal manual disconnect API | Pause client and cancel automatic retries; keep remote authentication |
| Normal reconnect API | Serialized restart, returning promptly while QR/ready events occur asynchronously |
| Node crash / Render redeploy | Recover latest committed archive after lease expiry/release |
| WhatsApp actual logout/invalidation | New pairing may be required; do not promise a QR-free login |

If WhatsApp requests a new QR, pair again and wait for the remote-save confirmation. If a known invalid/corrupt archive keeps blocking recovery, use the protected explicit reset endpoint:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/whatsapp/reset-session" -Headers $headers
```

This deletes the archive intentionally and starts fresh pairing. Ordinary reconnect/disconnect does **not** delete the archive. For lost database credentials, update Render env/network access; do not reset the WhatsApp archive to fix a database connection error.

## 8. Configure a genuinely free external ping

Use [cron-job.org](https://cron-job.org/). Its current [FAQ](https://cron-job.org/en/faq/) says the service is entirely free and supports execution every minute, so both 5-minute and 10-minute schedules are available without a paid plan.

1. Sign up, verify your email, and open **Cronjobs → Create cronjob** in its console.
2. Title: `Nexyrium backend health`.
3. URL: **`https://YOUR-BACKEND.onrender.com/health`**, using the backend service URL exactly. Keep `/health`; do not use `/`, `/robots.txt`, the frontend URL, or a protected API route.
4. Enable the job. Under its schedule, choose **every 5 minutes**. For 10 minutes choose that interval instead. In the custom schedule, this means minute values `0,5,10,...,55` (or `0,10,20,...,50`) and every hour/day/month/day-of-week; standard cron equivalents are `*/5 * * * *` and `*/10 * * * *`.
5. Under request settings use **GET**, no body, no basic authentication, and no custom authorization header. The public health route needs no secret.
6. Save, use the console's test/manual execution, then open job execution history. Expect **HTTP 200** with a small JSON body whose `status` is `ok`. Confirm later scheduled executions actually occur; a one-time test is insufficient.
7. Enable notifications for repeated failures/recovery and automatic job deactivation. Check your email and history if pings stop.

The service has a **30-second execution timeout** and a **64 KB response limit**. Our small health JSON meets the size limit. Render documents cold starts of about a minute, so a first wake-up request can time out at cron-job.org even though Render is starting. Let the next scheduled request retry, or warm the URL once in your browser and rerun the test. Do not assume a longer timeout is available on this free service. Repeated failures can automatically deactivate a job (the FAQ gives more than 25 consecutive failures as an example); fix the cause and re-enable it.

These are external inbound HTTP requests. The bot's `CRON_SCHEDULE` is an unrelated business-data retry worker; it cannot ping a process while that process is asleep. Render's internal health check also does not replace the external job. This setup supplies best-effort traffic under Render's current idle policy; it does not prevent forced restarts, resource exhaustion, quota suspension, or provider/monitor outages.

## 9. Verification commands

### Clean locked installation, schema generation, and regression tests

Use Node 22 LTS (at least 22.12) or supported Node 24. These helpers build in new temporary directories, copy only allowlisted source/configuration, and leave your real `.env`, Google key, local profile, and installed project dependencies alone:

```powershell
Set-Location "D:\watsappLeadAutomation - Copy"
node --version
node scripts/verify-render-install.js
node scripts/verify-dashboard-install.js
```

The backend helper runs a clean optional-dependency install with Puppeteer browser download enabled, verifies the browser executable, runs `npm run db:generate`, Prisma schema validation, and `npm test`. It uses dummy database endpoints for verification. Tests include the real production entry point, public health with unreachable databases, authorization, lease races/expiry, reconnects, and a real ZIP round-trip after deleting local profile files. The frontend helper runs a clean locked install, lint, production build, TypeScript, and concurrency/invalid-token/cancellation checks for the actual API helper. The temporary build directories are printed for inspection and can be removed after verification. Next's build can require internet access for its Google fonts.

On a normal clean checkout the equivalent backend commands are:

```powershell
npm ci --omit=dev --include=optional
npx puppeteer browsers install chrome
npm run db:generate
npx prisma validate
npm test
```

Use the isolated helper if shared Windows/WSL `node_modules` permissions prevent `npm ci`, or if Windows-mounted dependency reads cause test/lint timeouts. Do not infer a Linux deployment failure from those local filesystem issues. Generation/validation do not apply database migrations; follow section 2 for that separate step.

### Build/start the Node service locally

Use a private `.env` and run the same dependency/browser steps as Render:

```powershell
npm ci --include=optional
$env:PUPPETEER_SKIP_DOWNLOAD = "false"
npx puppeteer browsers install chrome
node scripts/verify-puppeteer-install.js
npm start
```

The local service uses the project-relative `./.wwebjs_auth` staging path. The real deployment retains `WHATSAPP_CLIENT_ID=nexyrium`.

### Check the deployed service and saved session

```powershell
$base = "https://YOUR-BACKEND.onrender.com"
curl.exe --fail --max-time 120 "$base/health"
curl.exe --fail --max-time 120 "$base/api/health"
$secureToken = Read-Host "Render ADMIN_API_TOKEN" -AsSecureString
$token = [System.Net.NetworkCredential]::new("", $secureToken).Password
$headers = @{ Authorization = "Bearer $token" }
$status = Invoke-RestMethod -Uri "$base/api/whatsapp/status" -Headers $headers
$status | Select-Object state, connected, qrRequired, authStrategy, remoteSessionSavedAt
Invoke-RestMethod -Uri "$base/api/whatsapp/qr" -Headers $headers |
  Select-Object available
```

After first pairing/upload, expect `connected: true`, `qrRequired: false`, `authStrategy: RemoteAuth`, and a non-null `remoteSessionSavedAt`. After a fresh redeploy, repeat these commands and the section 7 message test. Inspect Atlas file metadata and Render's restore logs as well; health 200 alone does not prove authentication or business processing.

## 10. Troubleshooting

| Symptom | Check and fix |
| --- | --- |
| QR on every restart | Confirm the first upload completed before restarting, unchanged client ID/URI/database, correct GridFS filename and nonzero file length, Atlas network access, and `RemoteAuth` in protected status. If restored credentials are actually revoked, pair again and wait for the new confirmed backup. |
| Render sleeps | Inspect cron-job.org history for successful scheduled requests to the exact backend `/health` at 5/10-minute intervals. Check whether the job was disabled and whether Render suspended the service for quotas. Wake the URL and confirm restore; pings cannot override suspension or forced restarts. |
| Chromium launch failure / OOM | Check the build log for the Puppeteer browser verification line, leave `PUPPETEER_EXECUTABLE_PATH` and `PUPPETEER_SKIP_DOWNLOAD` unset, and verify the service can write `./.wwebjs_auth`. The configured sandbox/shared-memory flags are present. Inspect Render memory/exit logs; Free's 512 MB may still be insufficient during browser startup or compression. |
| Google Secret File `ENOENT`/`EACCES` | Confirm the filename is exactly `credentials.json`, `GOOGLE_SHEETS_CREDENTIALS_PATH=/etc/secrets/credentials.json`, and that the service was rebuilt after saving the file. |
| MongoDB connection error | Verify Atlas cluster is running, URI includes the intended database, password is URL-encoded, user has `readWrite`, and Render outbound ranges are allowed. The bot retries storage rather than silently starting a blank profile. Do not delete a valid archive to fix credentials/network access. |
| Bot disconnected | Check protected status and restore/backoff logs. Temporary errors automatically recover. A manual disconnect intentionally pauses retries: send authenticated `POST /api/whatsapp/reconnect`. Actual logout/revocation can require a new QR. |
| Health returns 503 | Our live health handler returns 200 independently of dependencies. Check Render cold start/loading, failed deployment, missing required env/Secret File, wrong service/port configuration, suspension, and process crash. Wait for cold start and retry; do not change health to depend on SQL/WhatsApp. |
| Repeated restart loop | Read the first startup/build failure, not only subsequent restarts. Check required env, token length, Secret File JSON/path, permissions, Chromium memory, and exit signals. Repeated reconnect messages without a process exit are lifecycle retries, not necessarily Render restarts. |
| Remote restore fails | Confirm an actual saved file exists in the same database/client bucket and lease ownership can recover after about 90 seconds. Check Mongo download/unzip/profile-ready logs. For a confirmed corrupt/invalid archive, use authenticated reset-session once and re-pair; ordinary reconnect preserves the archive. |
| Monitor doesn't wake the service | Verify the job is enabled, execution times/method/URL, DNS, timeout history, and Render quotas. The first cold request may exceed the fixed 30-second monitor timeout; test after warming and allow the next scheduled retry. `/robots.txt` does not wake sleeping Render Free services. |
| Dashboard/status returns 401 | Enter the backend's `ADMIN_API_TOKEN`; private API requests require a bearer header. Confirm `NEXT_PUBLIC_API_URL` contains only the backend origin and rebuild after changing it. Never put the admin token in a public build-time variable. |
| HTTP 200 but no lead handling | Check protected WhatsApp state, SQL connectivity/schema, AI key/model, Sheets editor sharing, and business retry logs. Public liveness confirms HTTP availability only. |

## Current verification and verdict

The clean Linux locked install, Puppeteer browser verification, Prisma 7.9.0 generation/schema validation, and **51 backend test-runner checks** pass, including the real production startup/health smoke test and installed RemoteAuth archive round-trip. The clean frontend install, production build, and TypeScript check pass; lint has zero errors and one existing QR-image `<img>` warning. Browser-API checks verify the shared token prompt, invalid-token retry, and cancellation.

Profiling showed Windows-mounted dependency imports alone taking about 40 seconds before HTTP startup; the initial 30-second smoke deadline was too short there. The startup test now allows those slow local reads and passes while still asserting public health with both databases unreachable. Direct mounted-Windows frontend lint timed out, whereas the clean Linux checks pass; use the isolated helpers for reproducible checks.

A live phone → Mongo upload → actual Render fresh-service restore has **not** been completed here. The code is ready for the documented native Node deployment trial; persistent-login/continuous-uptime claims remain conditional on the live test and free-tier limits below.

## Render Free limits that remote authentication cannot remove

- Render Free sleeps after 15 minutes of no inbound traffic, can restart at any time, and has an ephemeral filesystem. Authentication now survives through external storage, but the bot still cannot receive/process live events while the process is asleep.
- Free web-service memory/CPU can be too small for Chromium plus Node plus ZIP compression; OOM can terminate a first scan before its first save. No code can guarantee survival of that event.
- A crash before the first completed remote upload can require another scan. A later hard kill restores the **last completed** backup, not unsaved profile updates. There is no guarantee that every Chromium database snapshot is accepted by WhatsApp.
- WhatsApp can revoke linked devices, invalidate credentials, or change Web behavior. RemoteAuth cannot force WhatsApp to accept revoked login data.
- External MongoDB/MySQL availability, network rules, and account limits affect recovery. Atlas Free may pause an idle cluster or enforce quotas. Check provider terms and storage usage.
- Render currently supplies **750 free instance hours per workspace/month**, shared across services. A continuously running service can use up to 744 hours in a 31-day month; keeping a second free web service awake can exhaust the shared allowance. Pings consume running hours, and suspension, build/bandwidth limits, cold starts, and high service-initiated traffic limits remain. HTTP traffic can reduce idle sleep under the current policy; MongoDB backups provide persistence across interruptions.
- The existing bot does not have a durable inbound message queue. SQL outage/sleep can mean processing gaps; preserved auth is not an exactly-once message-delivery guarantee.
- Docker image build and real QR/Mongo/Render restart must be validated in your environment. A locally passing test suite alone is not a live session-persistence claim.

Sources checked October 7, 2026: Render docs for [free services](https://render.com/docs/free), [web services](https://render.com/docs/web-services), [Docker environment/build arguments](https://render.com/docs/docker#environment-variable-translation), and [secret files](https://render.com/docs/configure-environment-variables#secret-files); [cron-job.org FAQ](https://cron-job.org/en/faq/); the actual installed RemoteAuth/Client/MongoStore source.

## Complete final code handoff

Run `npm run session:export` to generate `RENDER_CHANGED_FILES.md` containing the full final content of every changed/new file, including the dependency lockfile and tests. The export uses an explicit source-file allowlist and never reads your real `.env`, Google JSON, or WhatsApp profiles/ZIPs. The generated document is ignored by Git and Docker; the individual source files are the deployed code.
