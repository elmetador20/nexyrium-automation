/**
 * Application-wide constants.
 *
 * @module config/constants
 */

module.exports = Object.freeze({
  /** @enum {string} Lead lifecycle statuses. */
  LEAD_STATUS: {
    NEW: 'NEW',
    AI_PENDING: 'AI_PENDING',
    SYNC_PENDING: 'SYNC_PENDING',
    QUALIFIED: 'QUALIFIED',
    CONTACTED: 'CONTACTED',
    CONVERTED: 'CONVERTED',
    LOST: 'LOST',
  },

  /** @enum {string} Conversation statuses. */
  CONVERSATION_STATUS: {
    ACTIVE: 'ACTIVE',
    CLOSED: 'CLOSED',
    ARCHIVED: 'ARCHIVED',
  },

  /** @enum {string} Message direction. */
  MESSAGE_DIRECTION: {
    INBOUND: 'INBOUND',
    OUTBOUND: 'OUTBOUND',
  },

  /** Nexyrium service categories. */
  REQUIREMENT_CATEGORY: {
    TECH: 'Tech',
    PITCH_DECK: 'Pitch Deck',
  },

  /** Sent once when a customer starts a new conversation. */
  WELCOME_MESSAGE: 'Hi, thanks for reaching out to Nexyrium. Are you currently looking to build a website, mobile app, SaaS/product, or custom software solution, or do you need a pitch deck, brochure, or other design work?',

  /** Google Sheets column layout for the Leads sheet. */
  SHEET_COLUMNS: ['Client Number', 'Date', 'Phone No', 'REQUIREMENTS', 'Salesperson'],

  /** Used to initialize a dropdown when the sheet does not have one yet. */
  DEFAULT_SALESPEOPLE: ['Sharique', 'Arshan', 'Ashutosh', 'Aryan'],

  /** Inactivity timeout before processing a conversation (ms). */
  INACTIVITY_TIMEOUT_MS: 30_000,

  /** Maximum retry attempts before marking a lead LOST. */
  MAX_RETRIES: 5,
});
