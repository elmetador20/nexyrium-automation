-- CreateTable
CREATE TABLE `conversations` (
    `id` VARCHAR(191) NOT NULL,
    `chat_id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `conversations_chat_id_key`(`chat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `sender` VARCHAR(191) NOT NULL,
    `chat_id` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `messages_conversation_id_idx`(`conversation_id`),
    INDEX `messages_chat_id_idx`(`chat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leads` (
    `id` VARCHAR(191) NOT NULL,
    `phone_number` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `extracted_data` TEXT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'whatsapp',
    `status` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `conversation_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leads_phone_number_key`(`phone_number`),
    UNIQUE INDEX `leads_conversation_id_key`(`conversation_id`),
    INDEX `leads_conversation_id_idx`(`conversation_id`),
    INDEX `leads_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
