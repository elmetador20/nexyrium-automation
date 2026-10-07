/**
 * Conversation processor — the core pipeline that runs after the
 * inactivity timer fires for a phone number.
 *
 * Pipeline: fetch messages → build transcript → AI extract → save lead → sync sheets.
 *
 * @module services/conversation-processor.service
 */

const { normalizePhone } = require('../lib/phone');

/**
 * @param {object} deps
 * @param {import('../repositories/conversation.repository')} deps.conversationRepo
 * @param {import('../repositories/message.repository')} deps.messageRepo
 * @param {import('./lead.service').createLeadService} deps.leadService
 * @param {import('../integrations/ai/extractor').createExtractor} deps.extractor
 * @param {import('../lib/logger')} deps.logger
 */
function createConversationProcessor({ conversationRepo, messageRepo, leadService, extractor, logger }) {
  /**
   * Build a plain-text transcript from a list of Message records.
   *
   * @param {Array<{ direction: string, sender: string, content: string }>} messages
   * @returns {string}
   */
  function buildTranscript(messages) {
    return messages.map((m) => `[${m.direction}] ${m.sender}: ${m.content}`).join('\n');
  }

  /**
   * Process a conversation after inactivity timeout.
   *
   * @param {string} phone
   * @returns {Promise<import('@prisma/client').Lead | null>}
   */
  async function processConversation(phone) {
    logger.info('Processing conversation', { phone });

    const conversation = await conversationRepo.findByPhone(phone);
    if (!conversation) {
      logger.warn('No conversation found', { phone });
      return null;
    }

    const messages = await messageRepo.findByConversationId(conversation.id);
    if (messages.length === 0) {
      logger.warn('No messages found', { phone, conversationId: conversation.id });
      return null;
    }

    const transcript = buildTranscript(messages);

    let extractedData;

    try {
      extractedData = await extractor.extractLeadData(transcript);
    } catch (error) {
      logger.error('AI extraction threw', { phone, error: error.message });
      await leadService.markAiPending(phone, conversation.id, error.message);
      return null;
    }

    if (extractedData) {
      // WhatsApp contact metadata is authoritative; the customer needn't type their number.
      extractedData.phone = normalizePhone(conversation.phone) || normalizePhone(extractedData.phone);
    }

    if (!extractedData || !extractedData.phone) {
      const errorMsg = 'AI returned null or missing phone';
      logger.error(errorMsg, { phone });
      await leadService.markAiPending(phone, conversation.id, errorMsg);
      return null;
    }

    return leadService.saveAndSync(extractedData, conversation.id, transcript);
  }

  return { processConversation, buildTranscript };
}

module.exports = { createConversationProcessor };
