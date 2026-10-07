/**
 * Retry worker — cron-driven service that re-processes leads stuck
 * in AI_PENDING or SYNC_PENDING status.
 *
 * @module services/retry-worker.service
 */

const cron = require('node-cron');
const { LEAD_STATUS, MAX_RETRIES } = require('../config/constants');
const { normalizePhone } = require('../lib/phone');

/**
 * @param {object} deps
 * @param {import('../repositories/lead.repository')} deps.leadRepo
 * @param {import('../repositories/message.repository')} deps.messageRepo
 * @param {import('./lead.service').createLeadService} deps.leadService
 * @param {import('../integrations/ai/extractor').createExtractor} deps.extractor
 * @param {import('./assignment.service').createAssignmentService} deps.assignmentService
 * @param {import('../lib/logger')} deps.logger
 * @param {{ retrySchedule: string }} deps.config
 */
function createRetryWorker({ leadRepo, messageRepo, leadService, extractor, assignmentService, logger, config }) {
  const BATCH_SIZE = 10;

  /**
   * Build a plain-text transcript from Message records.
   *
   * @param {Array<{ direction: string, sender: string, content: string }>} messages
   * @returns {string}
   */
  function buildTranscript(messages) {
    return messages.map((m) => `[${m.direction}] ${m.sender}: ${m.content}`).join('\n');
  }

  /**
   * Re-process leads stuck in AI_PENDING.
   *
   * @returns {Promise<void>}
   */
  async function retryAiPending() {
    const leads = await leadRepo.findPendingWithRetry(LEAD_STATUS.AI_PENDING, BATCH_SIZE);
    if (leads.length === 0) return;

    logger.info(`Retrying ${leads.length} AI_PENDING leads`);

    for (const lead of leads) {
      try {
        if (lead.retryCount >= MAX_RETRIES) {
          await leadRepo.update(lead.id, { status: LEAD_STATUS.LOST });
          logger.warn('Lead exceeded max retries, marking LOST', { leadId: lead.id, phone: lead.phoneNumber });
          continue;
        }

        if (!lead.conversationId) {
          await leadRepo.update(lead.id, { status: LEAD_STATUS.LOST });
          logger.warn('No conversation linked, marking LOST', { leadId: lead.id });
          continue;
        }

        const messages = await messageRepo.findByConversationId(lead.conversationId);
        if (messages.length === 0) {
          await leadRepo.update(lead.id, { status: LEAD_STATUS.LOST });
          logger.warn('No messages found for lead, marking LOST', { leadId: lead.id });
          continue;
        }

        const transcript = buildTranscript(messages);
        const extractedData = await extractor.extractLeadData(transcript);
        if (extractedData) {
          extractedData.phone = normalizePhone(lead.phoneNumber) || normalizePhone(extractedData.phone);
        }

        if (!extractedData || !extractedData.phone) {
          await leadRepo.update(lead.id, {
            retryCount: lead.retryCount + 1,
            lastError: 'AI returned null or missing phone',
          });
          logger.warn('AI retry returned null', { leadId: lead.id, attempt: lead.retryCount + 1 });
          continue;
        }

        await leadService.saveLead(extractedData, lead.conversationId, transcript);
        logger.info('AI retry succeeded', { leadId: lead.id, phone: lead.phoneNumber });

        // Attempt sheet sync for the freshly saved lead
        const refreshed = await leadRepo.findByConversationId(lead.conversationId);
        try {
          await assignmentService.syncLead(refreshed);
        } catch (sheetError) {
          await leadService.markSyncPending(refreshed.id, sheetError.message);
        }
      } catch (error) {
        await leadRepo.update(lead.id, {
          retryCount: lead.retryCount + 1,
          lastError: error.message,
        });
        logger.error('AI retry failed', { leadId: lead.id, error: error.message });
      }
    }
  }

  /**
   * Re-sync leads stuck in SYNC_PENDING.
   *
   * @returns {Promise<void>}
   */
  async function retrySyncPending() {
    const leads = await leadRepo.findPendingWithRetry(LEAD_STATUS.SYNC_PENDING, BATCH_SIZE);
    if (leads.length === 0) return;

    logger.info(`Retrying ${leads.length} SYNC_PENDING leads`);

    for (const lead of leads) {
      try {
        if (lead.retryCount >= MAX_RETRIES) {
          await leadRepo.update(lead.id, { status: LEAD_STATUS.LOST });
          logger.warn('Lead exceeded max retries, marking LOST', { leadId: lead.id, phone: lead.phoneNumber });
          continue;
        }

        await assignmentService.syncLead(lead);
        await leadService.markResolved(lead.id);
        logger.info('SYNC_RETRY succeeded', { leadId: lead.id, phone: lead.phoneNumber });
      } catch (error) {
        await leadRepo.update(lead.id, {
          retryCount: lead.retryCount + 1,
          lastError: error.message,
        });
        logger.error('Sheet retry failed', { leadId: lead.id, error: error.message });
      }
    }
  }

  async function retryAssignments() {
    const leads = await leadRepo.findAssignmentPending(BATCH_SIZE);
    for (const lead of leads) {
      try {
        await assignmentService.syncLead(lead);
      } catch (error) {
        await leadRepo.update(lead.id, { assignmentError: error.message });
        logger.error('Assignment sync retry failed', { leadId: lead.id, error: error.message });
      }
    }
  }

  /** @type {import('node-cron').ScheduledTask | null} */
  let scheduledTask = null;

  function start() {
    if (scheduledTask) return;
    scheduledTask = cron.schedule(config.retrySchedule, async () => {
      logger.debug('Retry worker tick');
      try {
        await retryAiPending();
        await retrySyncPending();
        await retryAssignments();
      } catch (error) {
        logger.error('Retry worker error', { error: error.message });
      }
    });
    logger.info('Retry worker started', { schedule: config.retrySchedule });
  }

  function stop() {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
      logger.info('Retry worker stopped');
    }
  }

  return { start, stop };
}

module.exports = { createRetryWorker };
