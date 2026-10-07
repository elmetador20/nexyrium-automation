/**
 * Lead repository — Prisma data access for the leads table.
 *
 * @module repositories/lead.repository
 */

class LeadRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  /** @param {object} data */
  async create(data) {
    return this.prisma.lead.create({ data });
  }

  /** @param {string} id */
  async findById(id) {
    return this.prisma.lead.findUnique({ where: { id } });
  }

  /** @param {string} phoneNumber */
  async findByPhoneNumber(phoneNumber) {
    return this.prisma.lead.findUnique({ where: { phoneNumber } });
  }

  /** @param {string} conversationId */
  async findByConversationId(conversationId) {
    return this.prisma.lead.findUnique({ where: { conversationId } });
  }

  /** @param {Record<string,unknown>} [filter] */
  async findMany(filter = {}) {
    return this.prisma.lead.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** @param {string} status */
  async findByStatus(status) {
    return this.prisma.lead.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Fetch up to `limit` leads stuck in a given status (oldest first).
   * Used by the retry worker.
   *
   * @param {string} status
   * @param {number} [limit=10]
   */
  async findPendingWithRetry(status, limit = 10) {
    return this.prisma.lead.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** @param {string} id @param {object} data */
  async update(id, data) {
    return this.prisma.lead.update({ where: { id }, data });
  }

  /** Allocate once under a database lock, persisting the rotation across restarts. */
  async assignRoundRobin(id, salespeople, preferred = null) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT IGNORE INTO lead_assignment_state (id) VALUES ('default')`;
      const [state] = await tx.$queryRaw`SELECT last_salesperson FROM lead_assignment_state WHERE id = 'default' FOR UPDATE`;
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead || lead.assignedSalesperson) return lead;
      if (!preferred && salespeople.length === 0) throw new Error('The salesperson dropdown has no names');
      const previous = salespeople.findIndex((name) => name.toLowerCase() === state.last_salesperson?.toLowerCase());
      const assignedSalesperson = preferred || salespeople[(previous + 1) % salespeople.length];
      const assigned = await tx.lead.update({
        where: { id },
        data: { assignedSalesperson, assignmentSyncPending: !preferred, assignmentError: null },
      });
      if (!preferred) {
        await tx.leadAssignmentState.update({ where: { id: 'default' }, data: { lastSalesperson: assignedSalesperson } });
      }
      return assigned;
    });
  }

  async findAssignmentPending(limit = 10) {
    return this.prisma.lead.findMany({
      where: {
        status: { not: 'SYNC_PENDING' },
        OR: [
          { assignmentSyncPending: true },
          { assignedSalesperson: null, extractedData: { not: null }, status: { notIn: ['AI_PENDING', 'LOST'] } },
        ],
      },
      orderBy: { updatedAt: 'asc' }, take: limit,
    });
  }

  /** Do not overwrite an assignment that changed after a sheet request started. */
  async completeAssignmentSync(lead, assignedSalesperson) {
    await this.prisma.lead.updateMany({
      where: { id: lead.id, assignedSalesperson: lead.assignedSalesperson, updatedAt: lead.updatedAt },
      data: { assignedSalesperson, assignmentSyncPending: false, assignmentError: null },
    });
    return this.findById(lead.id);
  }

  /** @param {string} id */
  async delete(id) {
    return this.prisma.lead.delete({ where: { id } });
  }

  /** @param {Record<string,unknown>} [filter] */
  async count(filter = {}) {
    return this.prisma.lead.count({ where: filter });
  }
}

module.exports = LeadRepository;
