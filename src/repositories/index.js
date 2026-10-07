/**
 * Barrel export for all repositories.
 *
 * @module repositories
 */

const ConversationRepository = require('./conversation.repository');
const MessageRepository = require('./message.repository');
const LeadRepository = require('./lead.repository');

module.exports = { ConversationRepository, MessageRepository, LeadRepository };
