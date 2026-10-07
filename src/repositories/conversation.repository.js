/**
 * Conversation repository — Prisma data access for the conversations table.
 *
 * @module repositories/conversation.repository
 */

class ConversationRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * @param {{ chatId: string, phone: string, status?: string }} data
   * @returns {Promise<import('@prisma/client').Conversation>}
   */
  async create(data) {
    return this.prisma.conversation.create({ data });
  }

  /** @param {string} id */
  async findById(id) {
    return this.prisma.conversation.findUnique({ where: { id } });
  }

  /** @param {string} chatId */
  async findByChatId(chatId) {
    return this.prisma.conversation.findUnique({ where: { chatId } });
  }

  /** @param {string} phone */
  async findByPhone(phone) {
    return this.prisma.conversation.findFirst({ where: { phone } });
  }

  /** @param {string} id @returns {Promise<Conversation & { messages: Message[] }>} */
  async findByIdWithMessages(id) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /** @param {string} id */
  async findByIdWithLead(id) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: { lead: true },
    });
  }

  /** @param {string} id */
  async findByIdWithAll(id) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        lead: true,
      },
    });
  }

  /** @param {Record<string,unknown>} [filter] */
  async findMany(filter = {}) {
    return this.prisma.conversation.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActive() {
    return this.prisma.conversation.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** @param {string} id @param {string} status */
  async updateStatus(id, status) {
    return this.prisma.conversation.update({
      where: { id },
      data: { status },
    });
  }

  /** @param {string} id @param {string} phone */
  async updatePhone(id, phone) {
    return this.prisma.conversation.update({ where: { id }, data: { phone } });
  }

  /** @param {string} id */
  async delete(id) {
    return this.prisma.conversation.delete({ where: { id } });
  }

  /** @param {Record<string,unknown>} [filter] */
  async count(filter = {}) {
    return this.prisma.conversation.count({ where: filter });
  }
}

module.exports = ConversationRepository;
