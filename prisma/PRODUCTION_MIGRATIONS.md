# Production schema repair: `leads.context`

## Confirmed repository cause

`Lead.context` in `schema.prisma` is `String? @db.Text`: a real nullable MySQL
`TEXT` column, with no explicit default. The lead service writes the conversation
transcript there; it also retains a context value inside `extracted_data` JSON.
The retry worker's `findPendingWithRetry()` uses `lead.findMany()` with Prisma's
default scalar selection, which includes `context`.

`20260724121159_init_schema` never created this column.
`20261007120000_add_salesperson_assignment` does not add it either. Even a database
with both migrations fully applied is missing `context`. Do not edit those
historical migrations or remove the field from application queries.

The forward migration `20261009120000_add_lead_context` contains only:

```sql
ALTER TABLE `leads` ADD COLUMN `context` TEXT NULL;
```

Existing rows receive NULL. There is no required backfill: application reads and
writes already allow null. Existing `extracted_data`, messages, and other column
values are preserved. Do not automatically copy arbitrary JSON into TEXT: legacy
payload validity, text length, and the intended transcript need separate review
if a historical backfill is ever requested.

## 1. Read-only preflight against the production database

Run from this backend checkout using the **existing production environment** on
a trusted deployment/admin machine. Do not put the URL on the command line or
paste credentials into logs. These commands use `prisma.config.ts` and the
existing environment; dotenv does not override exported Render settings.

```bash
npx --no-install prisma validate
npm run db:generate
node scripts/inspect-database-schema.js
npx --no-install prisma migrate status
npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

The inspection script uses only SELECTs against `information_schema` and selected
migration-ledger metadata. It prints no customer rows or migration `logs` column.
It reports every application column, physical type/nullability/default, indexes,
foreign keys, missing columns, pending/failed migrations, and checksum mismatches.
Regenerate the client first so the column-presence comparison uses this checkout's
schema. Exit 2 means there are differences/pending history to review; exit 1 means
inspection failed. The Prisma diff also returns 2 for a nonempty diff.

The script's column check is not a complete schema-equivalence check: use the
Prisma diff plus the reported types/defaults/indexes/foreign keys for that. A
successful `migrate status` alone does not rule out drift.

**Verification limitation in this checkout:** the local URL selected the Aiven
`defaultdb` endpoint but had no SSL option, and the read-only connection attempt
failed with `ER_CANNOT_RETRIEVE_RSA_KEY`. No connection settings were changed.
The production error confirms the missing column; the rest of the live schema
and ledger still need the above preflight in the working production environment.

### Review all pending history before deploying

| Migration | Expected effects |
| --- | --- |
| `20260724121159_init_schema` | Creates `conversations`, `messages`, `leads`, their indexes, and two foreign keys. No `context`. |
| `20261007120000_add_salesperson_assignment` | Adds nullable `assigned_salesperson VARCHAR(191)`, `assignment_error TEXT`, and `assignment_sync_pending BOOLEAN NOT NULL DEFAULT false`; adds `leads_assignment_sync_pending_idx`; creates `lead_assignment_state(id VARCHAR(191) PRIMARY KEY, last_salesperson VARCHAR(191) NULL)`. |
| `20261009120000_add_lead_context` | Adds nullable `context TEXT` to `leads`. |

The assignment migration is additive and safe for existing leads if **all** of
its objects are absent. Its missing columns/table/index would cause later retry
or assignment failures. `migrate deploy` applies **all** pending migrations, not
only the newest one. Review unknown, failed, partially applied, or edited history
before running it.

- **Normal migrated database:** initial/assignment migrations are applied with
  matching checksums and `context` is missing. Deploy the new migration.
- **Assignment migration pending and none of its objects exist:** deploy it and
  the context migration in order after reviewing the diff.
- **Existing tables but no matching ledger/baseline:** do not run initial CREATE
  statements against them. Verify the complete initial schema (types, defaults,
  keys and relations), then record only migrations whose effects already exist.
  The conditional baseline commands are:

  ```bash
  # ONLY after proving all objects from this migration already exist correctly:
  npx --no-install prisma migrate resolve --applied 20260724121159_init_schema
  # ONLY if the complete assignment migration is already represented as well:
  npx --no-install prisma migrate resolve --applied 20261007120000_add_salesperson_assignment
  ```

- **`context` already exists in another environment:** verify it is nullable
  `TEXT` with no non-null default. Only then, if this new migration is pending,
  mark it applied instead of trying to add a duplicate column:

  ```bash
  npx --no-install prisma migrate resolve --applied 20261009120000_add_lead_context
  ```

- **Partial assignment migration, wrong types, failed migrations, or other drift:**
  stop and reconcile the specific mismatch from the metadata. Do not blindly
  baseline or run the entire generated diff; it may contain destructive changes.

Prisma CLI connectivity is separate from the app's MariaDB adapter. If a CLI
command fails TLS/authentication, stop: do not change the working application's
URL/TLS settings or conclude that migrations are applied from the app's connection
success. Use the trusted environment/provider CA configuration for that command.

## 2. Apply the reviewed migration explicitly

1. Take an Aiven backup/snapshot and schedule a short maintenance window. Pause
   bot/worker writes during schema maintenance. MySQL DDL can wait for a metadata
   lock and is not transactionally rolled back like normal application writes.
2. Use the same reviewed commit and database/environment as the preflight.
3. Run this once as a manual deployment operation:

   ```bash
   npx --no-install prisma migrate deploy
   ```

There are no migration commands added to startup, the retry worker, postinstall,
or the Render build. `prisma generate` produces client code; it does not update
the database. Do not use `migrate dev`, `migrate reset`, or a forced `db push` on
production.

## 3. Verify and resume

```bash
node scripts/inspect-database-schema.js
npx --no-install prisma migrate status
npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Expected: `leads.context` is `text`, nullable `YES`, default NULL; the three local
migrations are applied with no failed/unknown/checksum-mismatched records; no
missing columns; and a zero-exit, empty Prisma schema diff. Resume the service
and observe the next retry-worker tick (normally every five minutes) for the
absence of the missing-column error. Existing application query code is retained.

If DDL fails, inspect schema/history again before retrying. Do not remove a
successfully added column as a rollback: the old code tolerates this additive
nullable column, and dropping it could destroy newly captured transcripts.
