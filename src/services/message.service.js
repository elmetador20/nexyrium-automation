/**
 * Message service — persists incoming/outgoing WhatsApp messages and
 * manages the inactivity timer for each phone number.
 *
 * @module services/message.service
 */

const { MESSAGE_DIRECTION, WELCOME_MESSAGE } = require('../config/constants');
const { normalizePhone } = require('../lib/phone');

/**
 * @param {object} deps
 * @param {import('../repositories/conversation.repository')} deps.conversationRepo
 * @param {import('../repositories/message.repository')} deps.messageRepo
 * @param {typeof import('./inactivity-timer')} deps.inactivityTimer
 * @param {import('../lib/logger')} deps.logger
 */
function createMessageService({ conversationRepo, messageRepo, inactivityTimer, logger }) {
  /**
   * Extract structured fields from a raw whatsapp-web.js message object.
   *
   * @param {object} msg
   * @returns {{ phone: string, chatId: string, sender: string, content: string, timestamp: Date }}
   */
  function parseRawMessage(msg) {
    return {
      phone: normalizePhone(msg.from || msg.author) || msg.from || msg.author || 'unknown',
      chatId: msg.chatId?._serialized || msg.from,
      sender: msg.author || msg.from,
      content: msg.body || '',
      timestamp: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
    };
  }

  /**
   * Handle an incoming WhatsApp message: ensure a conversation exists,
   * persist the message, and reset the inactivity timer.
   *
   * @param {object} msg  Raw whatsapp-web.js message.
   * @param {{ phoneNumber?: string, sendMessage?: Function }} [options]
   * @returns {Promise<import('@prisma/client').Message>}
   */
  async function handleIncomingMessage(msg, options = {}) {
    const parsed = parseRawMessage(msg);
    const { chatId, sender, content, timestamp } = parsed;
    let phone = normalizePhone(options.phoneNumber) || parsed.phone;

    let conversation = await conversationRepo.findByChatId(chatId);
    const isNewConversation = !conversation;
    if (conversation && !normalizePhone(phone)) {
      // A temporary LID lookup failure must not discard a previously resolved number.
      phone = normalizePhone(conversation.phone) || phone;
    }

    if (!conversation) {
      conversation = await conversationRepo.create({
        chatId,
        phone,
        status: 'ACTIVE',
      });
      logger.info('Created new conversation', { chatId, phone });
    } else if (conversation.phone !== phone && normalizePhone(phone)) {
      conversation = await conversationRepo.updatePhone(conversation.id, phone);
    }

    const message = await messageRepo.create({
      content,
      direction: MESSAGE_DIRECTION.INBOUND,
      sender,
      chatId,
      timestamp,
      conversationId: conversation.id,
    });

    logger.info('Message saved', { messageId: message.id, chatId, phone });

    if (isNewConversation && options.sendMessage) {
      try {
        const sent = await options.sendMessage(chatId, WELCOME_MESSAGE);
        await messageRepo.create({
          content: WELCOME_MESSAGE,
          direction: MESSAGE_DIRECTION.OUTBOUND,
          sender: 'Nexyrium',
          chatId,
          timestamp: sent?.timestamp ? new Date(sent.timestamp * 1000) : new Date(),
          conversationId: conversation.id,
        });
        logger.info('Nexyrium welcome message sent', { chatId });
      } catch (error) {
        logger.error('Failed to send or save welcome message', { chatId, error: error.message });
      }
    }

    inactivityTimer.resetTimer(phone);

    return message;
  }

  return { handleIncomingMessage };
}

module.exports = { createMessageService };
