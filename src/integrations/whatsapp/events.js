/**
 * WhatsApp event handler — binds whatsapp-web.js events to services.
 *
 * @module integrations/whatsapp/events
 */

const { normalizePhone } = require('../../lib/phone');

/**
 * @param {object} deps
 * @param {import('../../services/message.service').createMessageService} deps.messageService
 * @param {import('../../lib/logger')} deps.logger
 */
function createEventHandler({ messageService, logger }) {
  /**
   * Register event listeners on the WhatsApp client.
   *
   * @param {import('whatsapp-web.js').Client} client
   */
  function register(client) {
    // Keep first-message creation and greeting ordered when a customer sends a burst.
    const pendingChats = new Map();
    client.on('message', async (msg) => {
      if (msg.fromMe || msg.isStatus || !/@(?:c\.us|s\.whatsapp\.net|lid)$/.test(msg.from || '')) return;

      const previous = pendingChats.get(msg.from) || Promise.resolve();
      const pending = previous.then(async () => {
        let phoneNumber = normalizePhone(msg.from);
        if (!phoneNumber && msg.from.endsWith('@lid')) {
          try {
            const contacts = await client.getContactLidAndPhone([msg.from]);
            phoneNumber = normalizePhone(contacts[0]?.pn);
          } catch (error) {
            logger.warn('Could not resolve WhatsApp phone number', { from: msg.from, error: error.message });
          }
        }
        await messageService.handleIncomingMessage(msg, {
          phoneNumber,
          sendMessage: (chatId, content) => client.sendMessage(chatId, content),
        });
      }).catch((error) => {
        logger.error('Failed to handle incoming message', { error: error.message, from: msg.from });
      });
      pendingChats.set(msg.from, pending);
      await pending;
      if (pendingChats.get(msg.from) === pending) {
        pendingChats.delete(msg.from);
      }
    });

    client.on('message_create', (msg) => {
      if (msg.fromMe) {
        logger.debug('Outgoing message', {
          to: msg.to,
          message: msg.body.substring(0, 200),
        });
      }
    });

    client.on('message_ack', (msg, ack) => {
      // ack: 0=PENDING, 1=SERVER, 2=DEVICE, 3=READ, 4=PLAYED
      if (ack >= 3) {
        logger.debug('Message read', { to: msg.to, ack });
      }
    });

    client.on('loading_screen', (percent) => {
      logger.debug('WhatsApp loading', { percent: Number(percent) || 0 });
    });
  }

  return { register };
}

module.exports = { createEventHandler };
