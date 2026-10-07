/**
 * Lead service — single source of truth for lead persistence.
 *
 * Centralises DB writes and sheet-sync so that ConversationProcessor and
 * RetryWorker never duplicate persistence logic.
 *
 * @module services/lead.service
 */

const { LEAD_STATUS } = require('../config/constants');

/**
 * @param {object} deps
 * @param {import('../repositories/lead.repository')} deps.leadRepo
 * @param {typeof import('./sheet-sync.service').createSheetSync} deps.sheetSync
 * @param {typeof import('./assignment.service').createAssignmentService} deps.assignmentService
 * @param {import('../lib/logger')} deps.logger
 */
function createLeadService({ leadRepo, sheetSync, assignmentService, logger }) {
  /**
   * Build the JSON payload stored in the `extractedData` column.
   *
   * @param {object} extractedData
   * @returns {string}
   */
  function toJsonPayload(extractedData) {
    return JSON.stringify(extractedData);
  }

  /**
   * Save (upsert) a lead from AI-extracted data.
   *
   * - Creates a new row if the phone does not exist.
   * - Updates the existing row otherwise.
   *
   * @param {object} extractedData  Output of the AI extractor.
   * @param {string} [conversationId]
   * @param {string} [context]  Full conversation transcript.
   * @returns {Promise<import('@prisma/client').Lead>}
   */
  async function saveLead(extractedData, conversationId, context) {
    const { phone, name, email } = extractedData;

    if (!phone) {
      throw new Error('Cannot save lead: phone is required');
    }

    const payload = toJsonPayload({ ...extractedData, context: context || null });
    const existing = await leadRepo.findByPhoneNumber(phone)
      || (conversationId ? await leadRepo.findByConversationId(conversationId) : null);

    let lead;

    if (existing) {
      const shouldReset = existing.status !== LEAD_STATUS.NEW;
      lead = await leadRepo.update(existing.id, {
        phoneNumber: phone,
        name: name ?? existing.name,
        email: email ?? existing.email,
        context: context ?? existing.context,
        extractedData: payload,
        conversationId: conversationId ?? existing.conversationId,
        status: LEAD_STATUS.NEW,
        retryCount: shouldReset ? 0 : existing.retryCount,
        lastError: shouldReset ? null : existing.lastError,
      });
      logger.info('Lead updated in DB', { id: lead.id, phone });
    } else {
      lead = await leadRepo.create({
        phoneNumber: phone,
        name,
        email,
        context,
        extractedData: payload,
        conversationId,
        status: LEAD_STATUS.NEW,
      });
      logger.info('Lead created in DB', { id: lead.id, phone });
    }

    return lead;
  }

  /**
   * Persist a lead and sync to Google Sheets.  Sheet failures are caught
   * and the lead is marked SYNC_PENDING — never throws for sheet errors.
   *
   * @param {object} extractedData
   * @param {string} [conversationId]
   * @param {string} [context]  Full conversation transcript.
   * @returns {Promise<import('@prisma/client').Lead | null>}
   */
  async function saveAndSync(extractedData, conversationId, context) {
    let lead;

    try {
      lead = await saveLead(extractedData, conversationId, context);
    } catch (error) {
      logger.error('Failed to save lead', { error: error.message });
      return null;
    }

    try {
      if (assignmentService) lead = await assignmentService.syncLead(lead);
      else await sheetSync.appendLead(lead);
    } catch (error) {
      logger.error('Sheet sync failed', { phone: lead.phoneNumber, error: error.message });
      await leadRepo.update(lead.id, {
        status: LEAD_STATUS.SYNC_PENDING,
        lastError: error.message,
      });
    }

    return lead;
  }

  /**
   * Mark a lead as AI_PENDING for retry.
   *
   * @param {string} phone
   * @param {string} conversationId
   * @param {string} errorMessage
   */
  async function markAiPending(phone, conversationId, errorMessage) {
    const existing = await leadRepo.findByPhoneNumber(phone)
      || (conversationId ? await leadRepo.findByConversationId(conversationId) : null);

    if (existing) {
      await leadRepo.update(existing.id, {
        status: LEAD_STATUS.AI_PENDING,
        retryCount: existing.retryCount + 1,
        lastError: errorMessage,
      });
    } else {
      await leadRepo.create({
        phoneNumber: phone,
        conversationId,
        status: LEAD_STATUS.AI_PENDING,
        retryCount: 1,
        lastError: errorMessage,
      });
    }

    logger.info('Lead marked AI_PENDING', { phone });
  }

  /**
   * Mark a lead as SYNC_PENDING for retry.
   *
   * @param {string} leadId
   * @param {string} errorMessage
   */
  async function markSyncPending(leadId, errorMessage) {
    await leadRepo.update(leadId, {
      status: LEAD_STATUS.SYNC_PENDING,
      lastError: errorMessage,
    });
    logger.info('Lead marked SYNC_PENDING', { leadId });
  }

  /**
   * Reset retry counters after a successful operation.
   *
   * @param {string} leadId
   */
  async function markResolved(leadId) {
    await leadRepo.update(leadId, {
      status: LEAD_STATUS.NEW,
      retryCount: 0,
      lastError: null,
    });
  }

  return { saveLead, saveAndSync, markAiPending, markSyncPending, markResolved };
}

module.exports = { createLeadService };
