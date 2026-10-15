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
    let active = true;
    const onMessage = async (msg) => {
      if (!active) return;
      if (msg.fromMe || msg.isStatus || !/@(?:c\.us|s\.whatsapp\.net|lid)$/.test(msg.from || '')) return;

      const previous = pendingChats.get(msg.from) || Promise.resolve();
      const pending = previous.then(async () => {
        if (!active) return;
        let phoneNumber = normalizePhone(msg.from);
        if (!phoneNumber && msg.from.endsWith('@lid')) {
          try {
            const contacts = await client.getContactLidAndPhone([msg.from]);
            phoneNumber = normalizePhone(contacts[0]?.pn);
          } catch (error) {
            logger.warn('Could not resolve WhatsApp phone number', { from: msg.from, error: error.message });
          }
        }
        if (!active) return;
        await messageService.handleIncomingMessage(msg, {
          phoneNumber,
          sendMessage: (chatId, content) => active ? client.sendMessage(chatId, content) : Promise.resolve(),
        });
      }).catch((error) => {
        logger.error('Failed to handle incoming message', { error: error.message, from: msg.from });
      });
      pendingChats.set(msg.from, pending);
      await pending;
      if (pendingChats.get(msg.from) === pending) {
        pendingChats.delete(msg.from);
      }
    };
    client.on('message', onMessage);

    const onMessageCreate = (msg) => {
      if (!active) return;
      if (msg.fromMe) {
        logger.debug('Outgoing message', {
          to: msg.to,
          message: msg.body.substring(0, 200),
        });
      }
    };
    client.on('message_create', onMessageCreate);

    const onMessageAck = (msg, ack) => {
      if (!active) return;
      // ack: 0=PENDING, 1=SERVER, 2=DEVICE, 3=READ, 4=PLAYED
      if (ack >= 3) {
        logger.debug('Message read', { to: msg.to, ack });
      }
    };
    client.on('message_ack', onMessageAck);

    const onLoadingScreen = (percent) => {
      if (!active) return;
      logger.debug('WhatsApp loading', { percent: Number(percent) || 0 });
    };
    client.on('loading_screen', onLoadingScreen);

    return () => {
      active = false;
      pendingChats.clear();
      client.removeListener('message', onMessage);
      client.removeListener('message_create', onMessageCreate);
      client.removeListener('message_ack', onMessageAck);
      client.removeListener('loading_screen', onLoadingScreen);
    };
  }

  return { register };
}

module.exports = { createEventHandler };
