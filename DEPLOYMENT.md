# Complete Deployment Guide

Deploy the existing Nexyrium bot on **Render Free**, with **MongoDB RemoteAuth** for persistent WhatsApp login, **MySQL/MariaDB** for business data, the existing dashboard, and a free external health ping. Follow steps 1–12 in order for the first deployment.

| Component | Responsibility |
| --- | --- |
| Render backend | WhatsApp client, messaging, AI extraction, REST API, and retry worker |
| External MySQL/MariaDB | Leads, conversations, messages, and assignment state |
| External MongoDB | RemoteAuth archives and exclusive session leases |
| Google Sheets | Lead-sheet and salesperson synchronization |
| Existing Next.js dashboard | Connections, leads, settings, and logs |
| cron-job.org | External requests to the public backend health endpoint |

The local `.wwebjs_auth` directory is temporary browser staging. MongoDB is the persistent login store. After the first successful remote backup, a fresh container can normally restore without another QR scan, provided WhatsApp still accepts the saved credentials.

## Contents

- [1. Prepare your machine](#1-prepare-your-machine)
- [2. Prepare the GitHub repository](#2-prepare-the-github-repository)
- [3. Prepare the business database](#3-prepare-the-business-database)
- [4. Create MongoDB session storage](#4-create-mongodb-session-storage)
- [5. Prepare Google Sheets and OpenRouter](#5-prepare-google-sheets-and-openrouter)
- [6. Create the Render backend](#6-create-the-render-backend)
- [7. Verify backend startup](#7-verify-backend-startup)
- [8. Connect the existing dashboard](#8-connect-the-existing-dashboard)
- [9. Pair WhatsApp and confirm the first backup](#9-pair-whatsapp-and-confirm-the-first-backup)
- [10. Verify business processing and restart recovery](#10-verify-business-processing-and-restart-recovery)
- [11. Configure the free external health ping](#11-configure-the-free-external-health-ping)
- [12. Operate and update the deployment](#12-operate-and-update-the-deployment)
- [Troubleshooting](#render-troubleshooting)
- [Free-tier limits and verification status](#free-tier-limits-and-verification-status)
- [Alternative: VPS with Docker](#option-a-vps-with-docker)
- [Alternative: VPS with PM2](#option-b-vps-with-pm2-no-docker)

Replace `YOUR-ACCOUNT`, `YOUR-BACKEND`, database hosts/passwords, and `yourdomain.com` with your own values. Windows examples use **PowerShell** and `curl.exe`.

## 1. Prepare your machine

You need:

- Git and Node.js **22 LTS, at least 22.12**, or supported Node.js 24, for local checks and migrations. Render runs the backend as a normal Node.js service.
- GitHub and Render accounts.
- A persistent MySQL/MariaDB service reachable from your computer and Render.
- A MongoDB Atlas account/cluster or another external MongoDB service.
- An OpenRouter key/model and a Google service-account JSON key.
- The WhatsApp phone/account to link and another phone for an inbound-message test.
- A cron-job.org account for external pings.

Check local tools and run the clean verification helpers:

```powershell
Set-Location "D:\watsappLeadAutomation - Copy"
git --version
node --version
npm --version
node scripts/verify-render-install.js
node scripts/verify-dashboard-install.js
```

The helpers create isolated temporary directories and install locked dependencies. The backend helper uses dummy database addresses, generates/validates Prisma, and runs tests without changing a live database. The frontend helper checks the existing dashboard's build, types, lint, and token handling. Printed temporary directories can be removed afterward.

## 2. Prepare the GitHub repository

Render needs the **whole project**, with the backend package at the repository root:

```text
repository/
  package.json
  package-lock.json
  index.js
  Dockerfile.backend
  prisma.config.ts
  render.yaml
  .gitignore
  .dockerignore
  .env.production.example
  src/
  prisma/
  scripts/
  test/
  dashboard/
    package.json
    package-lock.json
    Dockerfile.frontend
    .dockerignore
    src/
    public/
```

A dashboard-only repository cannot deploy this backend. If copied Git metadata points to an old Windows folder, or `dashboard` is a nested Git repository, use a fresh project-root checkout. This sequence copies the source/configuration without copying old Git metadata, local env files, installed dependencies, Google credentials, or browser profiles:

1. Create a GitHub repository, for example `nexyrium-lead-automation`, and initialize it with a README so the default branch exists.
2. Choose an unused local destination, then run:

   ```powershell
   $source = "D:\watsappLeadAutomation - Copy"
   $deploy = "D:\nexyrium-render-deploy"
   git clone "https://github.com/YOUR-ACCOUNT/nexyrium-lead-automation.git" $deploy

   $rootItems = @(
     "package.json", "package-lock.json", "index.js", "src", "prisma",
     "prisma.config.ts", "scripts", "test", "Dockerfile.backend", "render.yaml",
     ".gitignore", ".dockerignore", ".env.production.example", "docker-compose.yml",
     "DEPLOYMENT.md", "RENDER_SESSION_GUIDE.md", "nginx.conf", "ecosystem.config.js"
   )
   foreach ($item in $rootItems) {
     Copy-Item -LiteralPath (Join-Path $source $item) -Destination $deploy -Recurse -Force
   }

   $dashboardDestination = Join-Path $deploy "dashboard"
   New-Item -ItemType Directory -Path $dashboardDestination -Force | Out-Null
   $dashboardItems = @(
     "package.json", "package-lock.json", "Dockerfile.frontend", ".dockerignore",
     ".gitignore", "AGENTS.md", "next.config.ts", "next-env.d.ts", "tsconfig.json",
     "postcss.config.mjs", "eslint.config.mjs", "src", "public"
   )
   foreach ($item in $dashboardItems) {
     Copy-Item -LiteralPath (Join-Path (Join-Path $source "dashboard") $item) `
       -Destination $dashboardDestination -Recurse -Force
   }

   Set-Location $deploy
   git status --short
   git add .
   git diff --cached --stat
   git diff --cached
   git commit -m "Prepare Render deployment"
   git push origin main
   ```

   Use your actual deployment branch if it is not `main`. If your repository already has the required structure, work in that checkout instead of creating another clone.

3. Confirm that GitHub contains both `src` and ordinary `dashboard/src` files, rather than a dashboard Git submodule pointer.
4. Keep real `.env` files, `credentials.json`, session ZIPs/profiles, and `node_modules` out of commits. Ignore rules do not remove previously tracked secrets; remove those from tracking and replace a published key.

Use this project-root checkout for subsequent local commands; the example below assumes `D:\nexyrium-render-deploy`.

## 3. Prepare the business database

The Prisma schema uses **MySQL/MariaDB**. MongoDB stores authentication only; Render Postgres cannot replace the business database without application changes.

1. Use your existing persistent database, or create one such as `nexyrium` and a database user.
2. Obtain its public hostname, port, database name, and credentials. In Render, `localhost` refers to the container, not your Windows machine.
3. Allow your computer's IP for migrations and the Render backend's outbound IP ranges for runtime access. Retrieve Render ranges after creating the service in step 6.
4. Use the provider's required TLS settings; `?ssl=true` enables certificate-validated TLS in this app.
5. Percent-encode special characters in the URI username/password. Example:

   ```text
   mysql://lead_user:URL_ENCODED_PASSWORD@public-db.example.com:3306/nexyrium?ssl=true
   ```

Install dependencies and inspect migrations. Enter the connection URI privately:

```powershell
Set-Location "D:\nexyrium-render-deploy"
$dbUri = Read-Host "External MySQL DATABASE_URL" -AsSecureString
$env:DATABASE_URL = [System.Net.NetworkCredential]::new("", $dbUri).Password
npm ci --omit=dev --include=optional
npx puppeteer browsers install chrome
npm run db:generate
npx prisma validate
npx prisma migrate status
```

For a **new empty database**, or one already managed by these migrations, apply pending changes:

```powershell
npx prisma migrate deploy
npx prisma migrate status
```

For a **populated database previously created with `db push`**, baseline migrations already represented by its schema first. Compare the existing schema with the SQL files in `prisma/migrations`. If the database matches the initial migration, record it as applied:

```powershell
npx prisma migrate resolve --applied 20260724121159_init_schema
```

If its schema also already includes every change from the assignment migration, record that migration too. Otherwise, leave it pending so `migrate deploy` creates the assignment columns/table/index:

```powershell
# Run only when this migration's schema changes already exist.
npx prisma migrate resolve --applied 20261007120000_add_salesperson_assignment
```

Then run `npx prisma migrate deploy` and `npx prisma migrate status`. Different legacy schemas need their own reconciliation; marking a migration applied does not create tables. Use the provider's backup procedure before changing a populated schema. Production uses `migrate deploy`, not the development `npm run db:migrate` or a database reset. Docker generates the client but does **not** apply migrations automatically.

## 4. Create MongoDB session storage

1. In [MongoDB Atlas](https://www.mongodb.com/atlas), create a project and a Free cluster if available for your account/region.
2. Under **Database Access**, create a dedicated password-authenticated user, e.g. `wa_user`.
3. Grant `readWrite` on **`whatsapp_auth`**.
4. Choose **Connect → Drivers → Node.js**, and copy the URI with a percent-encoded password and explicit database:

   ```text
   mongodb+srv://wa_user:URL_ENCODED_PASSWORD@cluster.example.mongodb.net/whatsapp_auth?retryWrites=true&w=majority
   ```

5. Use it as `WHATSAPP_MONGODB_URI` in step 6.
6. Under **Network Access**, allow all outbound IP ranges listed for the Render backend. Finish this when the service exists; storage initialization retries until access succeeds.

Keep the same URI/database and `WHATSAPP_CLIENT_ID=nexyrium` across redeploys. The first successful backup creates:

```text
whatsapp-RemoteAuth-nexyrium.files
whatsapp-RemoteAuth-nexyrium.chunks
whatsapp_session_leases
```

No manual session document is needed. Inspect file metadata rather than downloading authentication archives.

## 5. Prepare Google Sheets and OpenRouter

### Google Sheets

1. Select/create the Google Cloud project and enable the **Google Sheets API**.
2. Under **IAM & Admin → Service Accounts**, use/create the service account and obtain its JSON key. Reuse your existing valid `credentials.json`.
3. Open the spreadsheet, click **Share**, and grant the account's `client_email` **Editor** access.
4. Copy the spreadsheet ID: the part between `/d/` and `/edit` in its URL.
5. Keep the JSON key for the Render Secret File in step 6. Preserve existing lead headers and salesperson dropdown/range configuration.

### OpenRouter

Obtain your project's OpenRouter key and choose a model the account can access. Supply them as `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, with the necessary account credit/access. The example model is `openai/gpt-3.5-turbo`; use your working model if different.

### Admin token

Generate an application-control token and store it privately:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use it as `ADMIN_API_TOKEN`. Production requires at least 32 characters. Administrative APIs and the dashboard use it; health pings do not.

## 6. Create the Render backend

Choose **New → Web Service** in [Render](https://dashboard.render.com/), connect GitHub, and select the project-root repository.

| Setting | Value |
| --- | --- |
| Name | `nexyrium-backend`, or a chosen unique name |
| Branch | Backend deployment branch, normally `main` |
| Language/runtime | Node |
| Root directory | Blank; repository root |
| Region | Near your databases; the blueprint uses Singapore |
| Instance plan | Free |
| Build command | `npm run render:build` |
| Start command | `npm start` |
| Health check path | `/health` |
| Port / host | Render-injected `process.env.PORT` (local fallback `10000`), `0.0.0.0` |
| Persistent disk | None; authentication uses external MongoDB |

The Node build retains optional RemoteAuth dependencies, downloads the exact Chrome revision selected by Puppeteer 24.38.0, verifies the browser executable, and uses the package `postinstall` hook/Prisma configuration to generate the client. Do not set `PUPPETEER_SKIP_DOWNLOAD` or a local/system `PUPPETEER_EXECUTABLE_PATH` on this service.

### Backend environment variables

Enter individual values under **Environment**, without surrounding quotes:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Do not set manually; Render supplies the HTTP port |
| `DATABASE_URL` | External MySQL/MariaDB URI from step 3 |
| `WHATSAPP_MONGODB_URI` | MongoDB URI from step 4 |
| `WHATSAPP_CLIENT_ID` | `nexyrium` |
| `WHATSAPP_SESSION_DATA_PATH` | `./.wwebjs_auth` |
| `WHATSAPP_BACKUP_INTERVAL_MS` | `300000` |
| `ADMIN_API_TOKEN` | Random token from step 5 |
| `OPENROUTER_API_KEY` | Your key |
| `OPENROUTER_MODEL` | Your working model, e.g. `openai/gpt-3.5-turbo` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Spreadsheet ID |
| `GOOGLE_SHEETS_CREDENTIALS_PATH` | `/etc/secrets/credentials.json` |
| `CRON_SCHEDULE` | `*/5 * * * *` |
| `MAX_RETRIES` | `5` |
| `RETRY_DELAY_MS` | `5000` |
| `LOG_LEVEL` | `info` |

The service supplies `PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer` through the blueprint. Leave `PUPPETEER_EXECUTABLE_PATH` and `PUPPETEER_SKIP_DOWNLOAD` unset so the downloaded Puppeteer browser is used. Configure the dashboard's `NEXT_PUBLIC_API_URL` separately in step 8.

### Secret File and database access

1. Under **Environment → Secret Files**, add **`credentials.json`** with your Google service-account JSON. Runtime path: `/etc/secrets/credentials.json`.
2. Retrieve the backend's outbound IP addresses/ranges from Render; add them to Atlas and the MySQL provider's allowlists.
3. Save settings and choose **Save, rebuild, and deploy** / **Manual Deploy → Deploy latest commit**, as available.

If Secret Files are available only after service creation, add the file immediately afterward and rebuild. Initial startup without it can fail until configured.

### Blueprint setup

**New → Blueprint** with `render.yaml` creates the same backend. It supplies fixed values, prompts for `sync: false` values, and generates the admin token. Add the Secret File/allowlists manually afterward. The blueprint does not provision the external databases or dashboard.

## 7. Verify backend startup

Copy the actual backend origin from Render and check:

```powershell
$base = "https://YOUR-BACKEND.onrender.com"
curl.exe --fail --max-time 120 "$base/health"
curl.exe --fail --max-time 120 "$base/api/health"
```

Expect HTTP 200 with a small JSON body containing `"status":"ok"`. A cold start can take about a minute. Logs should show HTTP startup, SQL connectivity, MongoDB connectivity, and WhatsApp initialization. With SQL unavailable, HTTP stays live while the database monitor retries every 30 seconds; bot/worker startup waits for usable SQL.

Prepare authenticated requests in the same PowerShell session:

```powershell
$secureToken = Read-Host "Render ADMIN_API_TOKEN" -AsSecureString
$token = [System.Net.NetworkCredential]::new("", $secureToken).Password
$headers = @{ Authorization = "Bearer $token" }
$status = Invoke-RestMethod -Uri "$base/api/whatsapp/status" -Headers $headers
$status | Select-Object state, connected, qrRequired, authStrategy, remoteSessionSavedAt
```

Expect `RemoteAuth`; a first deployment normally reaches `qrRequired: true` after both databases become accessible. `/health` and `/api/health` are public; other `/api/*` requests require the bearer token. Visiting status in the browser address bar without the token correctly returns 401.

## 8. Connect the existing dashboard

Set the existing dashboard's build-time variable to the backend **origin**:

```text
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.onrender.com
```

Do not append `/api` or a trailing slash: the helper appends `/api/...`. Rebuild after changing the URL. Never put `ADMIN_API_TOKEN` in a `NEXT_PUBLIC_*` variable; the browser prompts for it and uses session storage.

To deploy this existing frontend on Render, create a Web Service from the same repository:

| Setting | Value |
| --- | --- |
| Runtime | Docker |
| Root directory | `dashboard` |
| Dockerfile path | `./Dockerfile.frontend` |
| Docker build context | `.` |
| Plan | Your selected plan, including Free if desired |
| Docker/start command | Leave blank; image CMD runs `node server.js` |
| Health check path | `/` |
| Environment | `NODE_ENV=production`, `PORT=3000`, `NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.onrender.com` |

Render makes service env values available as Docker build arguments; the frontend declares the public API URL argument. Open the dashboard, visit **Connections**, and enter the backend admin token. Concurrent requests share one prompt. Reload after cancelling it to enter a token.

For temporary local dashboard access, run this in a **separate PowerShell window**;
keep the authenticated window from step 7 open for subsequent checks:

```powershell
Set-Location "D:\nexyrium-render-deploy\dashboard"
npm ci --include=dev --include=optional
$base = "https://YOUR-BACKEND.onrender.com"
$env:NEXT_PUBLIC_API_URL = $base
npm run dev
```

Open the URL printed by Next.js. Step 9 also supports direct pairing without deploying the dashboard first.

## 9. Pair WhatsApp and confirm the first backup

When status reports `qrRequired: true`, scan the QR on **Connections**, or retrieve a private PNG using `$base`/`$headers` from step 7:

```powershell
$qrPath = Join-Path $env:TEMP "nexyrium-whatsapp-qr.png"
Invoke-WebRequest -Uri "$base/api/whatsapp/qr-image" -Headers $headers -OutFile $qrPath
Start-Process $qrPath
```

On your phone: **WhatsApp → Settings/menu → Linked Devices → Link a Device**, then scan. A 404 means QR is not currently available: poll authenticated status for initialization/restoration or an already connected session. Fetch a fresh image if the QR expires. Remove the image afterward:

```powershell
Remove-Item $qrPath
```

The first-save sequence is:

```text
QR scan → authenticated → ready → wait at least 60 seconds
→ compress stabilized profile → upload to MongoDB → remote backup confirmed
```

**Do not restart on `ready` alone.** Wait for both log entries:

```text
WhatsApp session saved remotely
WhatsApp first remote session backup confirmed
```

Then check:

```powershell
$status = Invoke-RestMethod -Uri "$base/api/whatsapp/status" -Headers $headers
$status | Select-Object state, connected, qrRequired, authStrategy, remoteSessionSavedAt
```

Expect `connected: true`, `qrRequired: false`, `authStrategy: RemoteAuth`, and a non-null `remoteSessionSavedAt`. In Atlas **Browse Collections**, confirm `whatsapp-RemoteAuth-nexyrium.files` has `RemoteAuth-nexyrium.zip`, nonzero length, and an upload date, plus the chunks collection.

The stabilization wait is a minimum; upload can take longer. Wait for a successful retry if it fails. Periodic backups default to five minutes; the minimum configurable interval is `60000` milliseconds.

## 10. Verify business processing and restart recovery

### Business flow

From a different phone, send a one-to-one message, for example:

```text
Hi Nexyrium, my name is Alex. I need a website and mobile app for my business.
```

Allow the existing conversation inactivity/processing window, then verify:

1. Welcome reply and message history work.
2. The lead appears in dashboard/MySQL.
3. Requirements use the existing `Tech` / `Pitch Deck` classification.
4. Sheets receives the row, client number, and available salesperson assignment.
5. Follow-up messages update the existing lead/row rather than duplicating it.

Group messages, status updates, and the account's own sent messages are intentionally excluded from ordinary inbound capture.

### Fresh-container recovery

1. Confirm the completed backup from step 9.
2. Choose **Manual Deploy → Deploy latest commit** in Render to exercise a fresh container.
3. Keep the MongoDB URI/database and client ID identical. The new client may wait for old-client cleanup; abrupt termination can require about 90 seconds for lease expiry plus retry backoff.
4. Look for:

   ```text
   Restoring WhatsApp session from remote storage if available
   WhatsApp remote session archive downloaded
   WhatsApp session profile prepared
   WhatsApp authenticated
   WhatsApp ready
   ```

5. Repeat authenticated status: expect `connected: true`, `qrRequired: false`. Inspect QR availability without printing its contents:

   ```powershell
   Invoke-RestMethod -Uri "$base/api/whatsapp/qr" -Headers $headers |
     Select-Object available
   ```

   Expect `available: false`.
6. Send another inbound message and verify reply/database/Sheets behavior again.
7. Repeat with **Restart service**, if offered, or another redeploy. Avoid reset-session during this test; it intentionally deletes authentication.

Record success after live message processing works. Health 200 alone does not prove WhatsApp login or business readiness.

## 11. Configure the free external health ping

Use [cron-job.org](https://cron-job.org/), whose FAQ describes a free service with intervals down to one minute.

1. Sign up, verify email, and open **Cronjobs → Create cronjob**.
2. Title: `Nexyrium backend health`.
3. URL: **`https://YOUR-BACKEND.onrender.com/health`**; use the backend, including `/health`.
4. Enable the job; choose **every 5 minutes** or **every 10 minutes**. Custom minute values: `0,5,10,...,55` or `0,10,20,...,50`, with every hour/day/month/day-of-week. Cron equivalents: `*/5 * * * *` / `*/10 * * * *`.
5. Method: **GET**. No body, authentication, or authorization header.
6. Save and test/manual execute; verify HTTP 200 and `status: ok` in history.
7. Confirm subsequent scheduled executions and enable repeated-failure, recovery, and job-deactivation notifications.

The service has a **30-second execution timeout** and **64 KB response limit**. The small health body fits, but Render cold starts can take about a minute. The first wake-up request may time out; allow the next scheduled retry or warm the URL once and test again. The FAQ gives more than 25 consecutive failures as an example of automatic job deactivation; fix the cause and re-enable the job.

The application's `CRON_SCHEDULE` is the business retry worker and cannot execute while the process is asleep. Render's internal health check does not replace the external job. `/robots.txt` does not wake a sleeping Render Free service; use `/health`.

## 12. Operate and update the deployment

Use `$base`/`$headers` from step 7. Run the desired control individually:

```powershell
# Public liveness
curl.exe --fail --max-time 120 "$base/health"

# Private WhatsApp state
Invoke-RestMethod -Uri "$base/api/whatsapp/status" -Headers $headers |
  Select-Object state, connected, qrRequired, authStrategy, remoteSessionSavedAt
```

Resume/restart while retaining the archive:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/whatsapp/reconnect" -Headers $headers
```

Intentionally pause the client and automatic retries while retaining the archive:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/whatsapp/disconnect" -Headers $headers
```

For a confirmed corrupt/invalid archive requiring fresh pairing:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/whatsapp/reset-session" -Headers $headers
```

Reset deletes the archive and starts fresh pairing; repeat step 9. Restore database access to fix a network/password failure instead of resetting a valid archive.

### Updates and backups

- Push reviewed changes to the configured branch and deploy; recheck status/message processing.
- Update runtime secrets in Render and deploy. After token rotation, use the new token in dashboard/PowerShell headers.
- Rebuild the dashboard whenever its public API URL changes.
- Keep one bot instance per MongoDB/client session. An independently deployed duplicate is not a standby service.
- Use MySQL backups for business data and the MongoDB provider's supported private backup procedure for authentication files/chunks/metadata. Local profile snapshots are not RemoteAuth's startup archive.
- Monitor logs/memory/usage, backup timestamps, database access, sync failures, and cron-job.org history.

### Local container verification

With Docker Desktop's **Linux engine** running, create a private `.env.production` from the example and place the Google key at `./credentials.json` in your project-root checkout. Fill real variables; set `NEXT_PUBLIC_API_URL=http://localhost:3001` for local access. Use a dedicated test client ID such as `nexyrium-container-check` if the Render bot is already active.

```powershell
docker info
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --build
docker compose ps
docker compose logs -f backend
```

Compose maps backend to `http://localhost:3001`, dashboard to `http://localhost:3000`, mounts the Google key read-only, and supplies the frontend build URL. Check `curl.exe --fail http://localhost:3001/health`. Follow the pairing/first-save sequence for this test client; stop the stack with `docker compose down` afterward.

## Render troubleshooting

| Symptom | Checks and fix |
| --- | --- |
| Build cannot find backend | Check root/branch, Dockerfile, package files, `src`, and `prisma`. Backend Root Directory should be blank. |
| Missing variables/startup loop | Compare step 6 values, token length, Secret File JSON/path/filename, group-1000 access, and first startup failure. |
| Health 503 | Check cold start, failed deploy, port/bind address, crash, or suspension. The running handler returns 200 independently of dependencies. |
| Health 200, no bot startup | Check SQL access/schema and provider allowlist. Bot startup waits for usable SQL, then initializes MongoDB/WhatsApp. |
| MongoDB unavailable | Check database/URI, encoded password, user permissions, cluster state, and all Render outbound ranges. No LocalAuth fallback is used. |
| Google Secret File `ENOENT`/`EACCES` | The file must be named exactly `credentials.json`, the variable must be `/etc/secrets/credentials.json`, and the service must be rebuilt after saving it. The Docker image adds runtime user `node` to group 1000. |
| QR after every restart | Confirm first upload, stable client ID/database, archive metadata, and restore logs. Revoked credentials require new pairing/backup. |
| QR image 404 | Poll private status for initialization, restoration, or an already connected session. |
| Dashboard/status 401 | Enter the backend token/use a bearer header. Reload after cancelling the prompt; check the API origin and rebuild after changing it. |
| Chromium launch/crash/OOM | Check executable/path, staging permissions, memory and exit logs. Configured browser flags cannot remove Free's memory limit. |
| Temporary disconnect | Inspect recovery/backoff. Manual disconnect pauses retries; use authenticated reconnect. |
| Restore blocked / lease unavailable | Wait for old-client cleanup/lease expiry plus backoff; verify one service owns that client ID. Explicitly reset only a confirmed corrupt/invalid archive. |
| AI/Sheets failure | Check model/key/account access, Sheets API, spreadsheet ID/editor sharing, SQL schema, and business retry logs. |
| Repeated process restarts | Inspect the first startup error/OOM/exit signal. Reconnect logs alone can be lifecycle retries. |
| Sleep/monitor does not wake | Check backend URL, enabled schedule, timeout history/deactivation, and Render usage/suspension. Retry after cold start. |
| Local install/lint timeout | Use isolated helpers rather than shared Windows/WSL dependencies; retain the lockfile/optional dependencies and retry failed downloads. |
| Docker CLI cannot reach engine | Start Docker Desktop with Linux containers and confirm `docker info` before build/start. |

## Free-tier limits and verification status

Render Free currently has 15-minute idle sleep, ephemeral filesystems, possible independent restarts, **512 MB RAM**, and **750 free instance hours per workspace/month**, shared across services. One continuously running service can use 744 hours in a 31-day month; keeping both backend/dashboard awake can exhaust the allowance. Bandwidth/build limits and high service-initiated traffic can also impose restrictions/suspension.

External pings provide best-effort inbound traffic. They cannot override restarts, OOM, quotas, database outages, or WhatsApp revocation. Recovery uses the last completed backup; a crash before first upload can need another scan. There is no durable inbound queue, so sleep/database outages can cause processing gaps.

Last verified **October 7, 2026**: clean locked backend install, Prisma generation, generated-client runtime import, schema validation, all **50 backend test-runner checks**, frontend production build/TypeScript, token-handling checks, and Compose syntax. Frontend lint has zero errors and one existing QR-image `<img>` warning. Docker execution was blocked by an unavailable local engine; complete the live phone/MongoDB/Render restart test in steps 9–10. The reported `/opt/render/project/src` stack path identifies a native Node Render service; a Docker service should run from the image's `/app` path and use `Dockerfile.backend`.

See [RENDER_SESSION_GUIDE.md](./RENDER_SESSION_GUIDE.md) for inspected authentication/lifecycle details. Run `npm run session:export` to refresh ignored `RENDER_CHANGED_FILES.md`, the full source handoff from an explicit source/example allowlist.

Sources: [Render Free](https://render.com/docs/free), [Render Docker build arguments](https://render.com/docs/docker#environment-variable-translation), [Render environment/Secret Files](https://render.com/docs/configure-environment-variables), [cron-job.org FAQ](https://cron-job.org/en/faq/).

---

## Other deployment environments

These options use the same databases, environment variables, pairing, backup, and restart-verification sequence above. Host paths and ports differ as noted.

## Option A: VPS with Docker

### 1. Provision a VPS

- **OS:** Ubuntu 22.04+ (minimum 2 GB RAM, 1 vCPU)
- Providers: DigitalOcean, Hetzner, Vultr, AWS Lightsail, etc.

### 2. Install Docker and Docker Compose

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### 3. Clone the Repo

```bash
git clone https://github.com/YOUR-ACCOUNT/nexyrium-lead-automation.git /opt/watsappLeadAutomation
cd /opt/watsappLeadAutomation
```

### 4. Configure Environment

```bash
cp .env.production.example .env.production
nano .env.production   # Fill in real values
```

Place the existing Google service-account key at `./credentials.json`; Compose
mounts it read-only at `/etc/secrets/credentials.json`. Set `NEXT_PUBLIC_API_URL`
to the backend's browser-accessible origin in `.env.production` before building.

### 5. Build and Start

```bash
docker compose --env-file .env.production up -d --build
docker compose logs -f   # Watch logs until services are healthy
```

Useful commands:
```bash
docker compose ps              # Status
docker compose restart         # Restart all
docker compose down            # Stop all
docker compose --env-file .env.production up -d --build   # Rebuild after code changes
```

### 6. Nginx Reverse Proxy

Edit `yourdomain.com` in the provided template first. When merging its directives
into an existing Nginx installation, keep top-level gzip directives only once if
the main `http` block already defines them.

```bash
sudo apt install nginx -y
sudo cp nginx.conf /etc/nginx/sites-available/wa
sudo ln -s /etc/nginx/sites-available/wa /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Replace `yourdomain.com` in `nginx.conf` with your actual domain.

### 7. SSL with Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
# Follow prompts. Certbot will auto-renew via systemd timer.
sudo systemctl status certbot.timer
```

Certbot's Nginx plugin configures HTTPS and redirects. Inspect the resulting
configuration and run `sudo nginx -t` before reloading; do not create a second
duplicate HTTPS server block from the commented example afterward.

### 8. Systemd Service (Optional, for extra reliability)

```bash
sudo nano /etc/systemd/system/wa-app.service
```

```ini
[Unit]
Description=WhatsApp Lead Automation
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/watsappLeadAutomation
ExecStart=/usr/bin/docker compose --env-file .env.production up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable wa-app
sudo systemctl start wa-app
```

---

## Option B: VPS with PM2 (No Docker)

### 1. Install Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # Should print v22.x (at least 22.12)
```

### 2. Install Chromium Dependencies (for Puppeteer)

```bash
sudo apt install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg \
    fonts-kacst fonts-freefont-ttf fonts-liberation \
    libxss1
```

Find the actual executable to use in the production `.env` below:
```bash
command -v chromium
chromium --version
```

### 3. Install PM2

```bash
sudo npm install -g pm2
```

### 4. Clone and Install

```bash
git clone https://github.com/YOUR-ACCOUNT/nexyrium-lead-automation.git /opt/watsappLeadAutomation
cd /opt/watsappLeadAutomation

cp .env.production.example .env
nano .env

# Alongside the real shared variables, use host paths/port for PM2:
# PORT=3001
# GOOGLE_SHEETS_CREDENTIALS_PATH=/opt/watsappLeadAutomation/credentials.json
# WHATSAPP_SESSION_DATA_PATH=/opt/watsappLeadAutomation/.wwebjs_auth
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium (or the path printed above)

# Backend deps
export PUPPETEER_SKIP_DOWNLOAD=true
npm ci --include=optional
npm run db:generate

# Frontend deps + build
npm --prefix dashboard ci --include=dev --include=optional
NEXT_PUBLIC_API_URL=https://yourdomain.com npm --prefix dashboard run build
```

The backend entry point loads the root **`.env`**, not `.env.production`; Prisma
also reads that root file. Place the Google JSON at the host path above and apply
database migrations as described in step 3. Port 3001 matches the provided Nginx
backend upstream; the PM2 frontend uses port 3000. Build with your actual public
origin, using `/api/health` for Nginx-fronted health monitoring.

### 5. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 list   # Verify both processes are online
```

### 6. PM2 Auto-Start on Reboot

```bash
pm2 startup systemd
# Run the command it outputs, then:
pm2 save
```

### 7. Nginx and SSL

Same as Option A, steps 6 and 7.

---

## Option C: Cloud PaaS (Docker-based)

### Railway

1. Push repo to GitHub
2. Go to [railway.app](https://railway.app), New Project → Deploy from GitHub
3. Add a **backend** service from `Dockerfile.backend`
4. Add a **frontend** service from `dashboard/Dockerfile.frontend`
5. Set environment variables in Railway dashboard
6. Configure `WHATSAPP_MONGODB_URI` for remote session storage
7. Railway provisions a public URL — add a custom domain for SSL

Set the backend service health check to:

```text
/health
```

Use the backend's public URL for the external keep-alive monitor, for example:
`https://your-backend.up.railway.app/health`.

### Render

Follow steps 1–12 at the top of this document. The backend health path is `/health`;
the existing dashboard is configured separately with the backend origin at build
time, as detailed in step 8.

### AWS ECS / Fargate

1. Push images to ECR
2. Create ECS cluster with Fargate launch type
3. Define two tasks (backend + frontend), wire networking
4. Use Application Load Balancer for routing `/api/*` and `/`
5. Configure external MongoDB for the RemoteAuth session archive

---

## Monitoring

```bash
# Docker logs
docker compose logs -f --tail=100

# PM2 monit
pm2 monit

# PM2 logs
pm2 logs wa-backend --lines=50
pm2 logs wa-frontend --lines=50

# Health check endpoints
curl http://localhost:3001/health
curl http://localhost:3001/api/health
```

### Free-tier keep-alive monitoring

The backend exposes `GET /health` and `GET /api/health`. The endpoint returns HTTP 200 and does not access the database, WhatsApp, or Google Sheets, so it is safe for a sleeping service's wake-up request.

Configure an external monitor because a sleeping service cannot reliably send a request to itself:

1. Create a free job in [cron-job.org](https://cron-job.org/) using step 11 above.
2. Monitor the **backend** URL, not the dashboard URL:
   `https://your-backend.onrender.com/health` or `https://your-backend.up.railway.app/health`.
3. Use a **5-minute interval**, method `GET`, and expect HTTP status `200`.
4. Deploy the backend first, confirm the URL in a browser, then enable the monitor.

Its request timeout is fixed at 30 seconds; a Render cold start can take about a
minute, so the first check can fail while waking the service. Check the next
scheduled request/history and re-enable jobs deactivated by repeated failures.
Pings do not override suspension, quotas, resource exhaustion, or forced restarts.

If the frontend and backend are separate services, monitor the backend URL directly. If Nginx fronts both services on a VPS, monitor `https://yourdomain.com/api/health`.

---

## Backup Strategy: WhatsApp Session

Persistent session archives are the MongoDB GridFS records created by RemoteAuth.
Use your provider's supported private backup procedure to preserve the files,
chunks, and metadata consistently; keep the archives private. Use separate MySQL
backups for business data. Restoring a local `.wwebjs_auth` folder alone does not
replace the remote archive used at startup. Repeat steps 9–10 after restoring a
backup and verify that WhatsApp still accepts the saved credentials.

---

## Common Issues and Fixes

| Issue | Fix |
|---|---|
| Puppeteer fails to launch in Docker | Ensure `--no-sandbox` flag is set and `chromium` is installed in the image. Check `PUPPETEER_EXECUTABLE_PATH`. |
| WhatsApp session expires / QR code loop | Check first remote upload, stable client ID/database, Atlas access, and linked-device validity. Follow the remote restore/reset procedure in `RENDER_SESSION_GUIDE.md`; a local folder alone is not the authoritative session. |
| 502 Bad Gateway from Nginx | Backend or frontend is down. Check `docker compose ps` or `pm2 list`. |
| Next.js build fails in Docker | Ensure `next.config.ts` has `output: "standalone"`. Delete `.next` and rebuild. |
| Database connection refused | Verify `DATABASE_URL` in `.env.production`. Ensure MariaDB is running and accessible from the VPS. |
| High memory usage | Inspect host/container memory and PM2 restart limits. Allocate enough memory for Node, Chromium, and archive compression. Render Free memory is controlled by its plan. |
| SSL not renewing | Run `sudo certbot renew --dry-run` to test. Ensure certbot timer is active. |
