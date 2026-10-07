/**
 * Message repository — Prisma data access for the messages table.
 *
 * @module repositories/message.repository
 */

class MessageRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * @param {{ content: string, direction: string, sender: string, chatId: string, timestamp: Date, conversationId: string }} data
   */
  async create(data) {
    return this.prisma.message.create({ data });
  }

  /** @param {Array<object>} messages */
  async createMany(messages) {
    return this.prisma.message.createMany({ data: messages });
  }

  /** @param {string} id */
  async findById(id) {
    return this.prisma.message.findUnique({ where: { id } });
  }

  /** @param {string} chatId */
  async findByChatId(chatId) {
    return this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** @param {string} conversationId */
  async findByConversationId(conversationId) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** @param {Record<string,unknown>} [filter] */
  async findMany(filter = {}) {
    return this.prisma.message.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** @param {string} conversationId */
  async countByConversationId(conversationId) {
    return this.prisma.message.count({ where: { conversationId } });
  }

  /** @param {string} conversationId */
  async deleteByConversationId(conversationId) {
    return this.prisma.message.deleteMany({ where: { conversationId } });
  }
}

module.exports = MessageRepository;
