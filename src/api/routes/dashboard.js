/**
 * Dashboard API routes.
 *
 * @module api/routes/dashboard
 */

const { Router } = require('express');
const container = require('../../container');

const router = Router();

router.get('/stats', async (_req, res, next) => {
  try {
    const { prisma } = container;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());

    const [totalLeads, todayLeads, weekLeads, statusCounts, totalConversations, activeConversations, totalMessages] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.lead.count({ where: { createdAt: { gte: startOfWeek } } }),
      prisma.lead.groupBy({ by: ['status'], _count: true }),
      prisma.conversation.count(),
      prisma.conversation.count({ where: { status: 'ACTIVE' } }),
      prisma.message.count(),
    ]);

    const leadsByStatus = {};
    for (const item of statusCounts) {
      leadsByStatus[item.status] = item._count;
    }

    res.json({
      totalLeads,
      todayLeads,
      weekLeads,
      totalConversations,
      activeConversations,
      totalMessages,
      leadsByStatus,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/status', async (_req, res, next) => {
  try {
    const { prisma } = container;

    let whatsappStatus = 'disconnected';
    let phoneNumber = null;
    try {
      const client = container.whatsapp.getClient();
      const info = client.info;
      if (container.whatsapp.getStatus().connected && info && info.wid) {
        whatsappStatus = 'connected';
        phoneNumber = info.wid.user || null;
      }
    } catch {
      whatsappStatus = 'disconnected';
    }

    let dbStatus = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    let sheetsStatus = 'ok';
    try {
      await container.sheetSync.findLeadByPhone('__ping__');
      sheetsStatus = 'ok';
    } catch (err) {
      if (err.message && err.message.includes('credentials')) {
        sheetsStatus = 'error';
      } else {
        sheetsStatus = 'ok';
      }
    }

    res.json({
      whatsapp: { status: whatsappStatus, phoneNumber },
      database: { status: dbStatus },
      sheets: { status: sheetsStatus },
      ai: { status: 'ok', model: process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo' },
      lastSync: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
