ALTER TABLE `leads`
    ADD COLUMN `assigned_salesperson` VARCHAR(191) NULL,
    ADD COLUMN `assignment_sync_pending` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `assignment_error` TEXT NULL;

CREATE INDEX `leads_assignment_sync_pending_idx` ON `leads`(`assignment_sync_pending`);

CREATE TABLE `lead_assignment_state` (
    `id` VARCHAR(191) NOT NULL,
    `last_salesperson` VARCHAR(191) NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
