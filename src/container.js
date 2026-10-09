/**
 * Dependency-injection container.
 *
 * Wires every module together so that individual services never import
 * singletons directly.  All instances are created lazily on first access.
 *
 * @module container
 */

const { env } = require('./config/env');
const { prisma } = require('./lib/prisma');
const { createSheetsClient } = require('./lib/google-sheets');
const { chatCompletion } = require('./lib/openrouter');
const logger = require('./lib/logger');

const { ConversationRepository, MessageRepository, LeadRepository } = require('./repositories');

const { createMessageService } = require('./services/message.service');
const { createLeadService } = require('./services/lead.service');
const { createAssignmentService } = require('./services/assignment.service');
const { createSheetSync } = require('./services/sheet-sync.service');
const { createExtractor } = require('./integrations/ai/extractor');
const { createConversationProcessor } = require('./services/conversation-processor.service');
const { createRetryWorker } = require('./services/retry-worker.service');
const { createEventHandler } = require('./integrations/whatsapp/events');
const { createWhatsAppClient } = require('./integrations/whatsapp/client');
const inactivityTimer = require('./services/inactivity-timer');

/** Lazy singleton container — access via `container.<name>`. */
const container = {};

/** @returns {import('@prisma/client').PrismaClient} */
Object.defineProperty(container, 'prisma', {
  get() { return prisma; },
});

/** @returns {ConversationRepository} */
Object.defineProperty(container, 'conversationRepo', {
  get() { return (this._conversationRepo ??= new ConversationRepository(prisma)); },
});

/** @returns {MessageRepository} */
Object.defineProperty(container, 'messageRepo', {
  get() { return (this._messageRepo ??= new MessageRepository(prisma)); },
});

/** @returns {LeadRepository} */
Object.defineProperty(container, 'leadRepo', {
  get() { return (this._leadRepo ??= new LeadRepository(prisma)); },
});

/** @returns {ReturnType<typeof createSheetSync>} */
Object.defineProperty(container, 'sheetSync', {
  get() {
    return (this._sheetSync ??= createSheetSync({
      sheets: createSheetsClient({ credentialsPath: env.GOOGLE_SHEETS_CREDENTIALS_PATH }),
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
      logger,
    }));
  },
});

/** @returns {ReturnType<typeof createExtractor>} */
Object.defineProperty(container, 'extractor', {
  get() {
    return (this._extractor ??= createExtractor({
      chatCompletion,
      config: { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL },
      logger,
    }));
  },
});

/** @returns {ReturnType<typeof createAssignmentService>} */
Object.defineProperty(container, 'assignmentService', {
  get() {
    return (this._assignmentService ??= createAssignmentService({
      leadRepo: this.leadRepo, sheetSync: this.sheetSync, logger,
    }));
  },
});

/** @returns {ReturnType<typeof createLeadService>} */
Object.defineProperty(container, 'leadService', {
  get() {
    return (this._leadService ??= createLeadService({
      leadRepo: this.leadRepo,
      sheetSync: this.sheetSync,
      assignmentService: this.assignmentService,
      logger,
    }));
  },
});

/** @returns {ReturnType<typeof createMessageService>} */
Object.defineProperty(container, 'messageService', {
  get() {
    return (this._messageService ??= createMessageService({
      conversationRepo: this.conversationRepo,
      messageRepo: this.messageRepo,
      inactivityTimer,
      logger,
    }));
  },
});

/** @returns {ReturnType<typeof createConversationProcessor>} */
Object.defineProperty(container, 'conversationProcessor', {
  get() {
    return (this._conversationProcessor ??= createConversationProcessor({
      conversationRepo: this.conversationRepo,
      messageRepo: this.messageRepo,
      leadService: this.leadService,
      extractor: this.extractor,
      logger,
    }));
  },
});

/** @returns {ReturnType<typeof createRetryWorker>} */
Object.defineProperty(container, 'retryWorker', {
  get() {
    return (this._retryWorker ??= createRetryWorker({
      leadRepo: this.leadRepo,
      messageRepo: this.messageRepo,
      leadService: this.leadService,
      extractor: this.extractor,
      assignmentService: this.assignmentService,
      logger,
      config: { retrySchedule: env.CRON_SCHEDULE },
    }));
  },
});

/** @returns {ReturnType<typeof createEventHandler>} */
Object.defineProperty(container, 'eventHandler', {
  get() {
    return (this._eventHandler ??= createEventHandler({
      messageService: this.messageService,
      logger,
    }));
  },
});

/** @returns {ReturnType<typeof createWhatsAppClient>} */
Object.defineProperty(container, 'whatsapp', {
  get() {
    return (this._whatsapp ??= createWhatsAppClient({
      config: {
        dataPath: env.WHATSAPP_SESSION_DATA_PATH,
        mongoUri: env.WHATSAPP_MONGODB_URI,
        clientId: env.WHATSAPP_CLIENT_ID,
        backupIntervalMs: env.WHATSAPP_BACKUP_INTERVAL_MS,
      },
      logger,
      createEventHandler: () => this.eventHandler,
    }));
  },
});

module.exports = container;
