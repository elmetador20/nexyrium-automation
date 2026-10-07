/**
 * Logs API routes.
 *
 * Provides activity logs derived from lead state changes and errors.
 *
 * @module api/routes/logs
 */

const { Router } = require('express');
const container = require('../../container');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { prisma } = container;
    const {
      page = '1',
      limit = '50',
      level = '',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const leadsWithErrors = await prisma.lead.findMany({
      where: {
        OR: [
          { lastError: { not: null } },
          { status: { in: ['AI_PENDING', 'SYNC_PENDING', 'LOST'] } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limitNum,
      select: {
        id: true,
        phoneNumber: true,
        status: true,
        retryCount: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const total = await prisma.lead.count({
      where: {
        OR: [
          { lastError: { not: null } },
          { status: { in: ['AI_PENDING', 'SYNC_PENDING', 'LOST'] } },
        ],
      },
    });

    const logs = leadsWithErrors.map((lead) => ({
      id: lead.id,
      type: lead.status === 'LOST' ? 'error' : lead.status === 'AI_PENDING' ? 'warning' : 'info',
      message: lead.lastError || `Lead status: ${lead.status}`,
      phone: lead.phoneNumber,
      status: lead.status,
      retryCount: lead.retryCount,
      timestamp: lead.updatedAt,
    }));

    if (level) {
      const filtered = logs.filter((l) => l.type === level);
      res.json({ logs: filtered, total: filtered.length, page: pageNum, limit: limitNum });
    } else {
      res.json({ logs, total, page: pageNum, limit: limitNum });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
