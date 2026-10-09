-- Lead.context is String? @db.Text in schema.prisma but was omitted from
-- the initial migration. Existing leads keep NULL; no backfill is required.
ALTER TABLE `leads` ADD COLUMN `context` TEXT NULL;
