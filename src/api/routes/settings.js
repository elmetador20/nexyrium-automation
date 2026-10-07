/**
 * Settings API routes.
 *
 * @module api/routes/settings
 */

const { Router } = require('express');
const container = require('../../container');
const { requireAdmin } = require('../admin-auth');

const router = Router();
router.use(requireAdmin);

router.get('/', (_req, res) => {
  res.json({
    openrouter: {
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo',
      hasApiKey: !!process.env.OPENROUTER_API_KEY,
    },
    googleSheets: {
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
      hasCredentials: !!process.env.GOOGLE_SHEETS_CREDENTIALS_PATH,
    },
    whatsapp: {
      sessionPath: process.env.WHATSAPP_SESSION_DATA_PATH || null,
    },
    worker: {
      cronSchedule: process.env.CRON_SCHEDULE || '*/5 * * * *',
      maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 5,
      retryDelayMs: parseInt(process.env.RETRY_DELAY_MS, 10) || 5000,
    },
  });
});

router.post('/test-ai', async (_req, res, next) => {
  try {
    const { extractor } = container;
    const testResult = await extractor.extractLeadData(
      '[INBOUND] Customer: Hi Nexyrium, I need a website and mobile app for my business. My name is John and my number is 1234567890.'
    );
    res.json(testResult
      ? { success: true, result: testResult }
      : { success: false, error: 'AI did not return valid Nexyrium lead data' });
  } catch (err) {
    res.json({ success: false, error: 'AI connection test failed; check the configured service' });
  }
});

router.post('/sync-sheets', async (_req, res, next) => {
  try {
    const { prisma } = container;
    const pendingLeads = await prisma.lead.findMany({
      where: { OR: [
        { status: 'SYNC_PENDING' },
        { assignmentSyncPending: true },
        { assignedSalesperson: null, extractedData: { not: null }, status: { notIn: ['AI_PENDING', 'LOST'] } },
      ] },
      take: 10,
    });

    let synced = 0;
    for (const lead of pendingLeads) {
      try {
        await container.assignmentService.syncLead(lead);
        if (lead.status === 'SYNC_PENDING') await container.leadService.markResolved(lead.id);
        synced++;
      } catch {}
    }

    res.json({ success: true, synced, total: pendingLeads.length });
  } catch (err) {
    next(err);
  }
});

router.post('/reconnect-whatsapp', async (_req, res, next) => {
  try {
    await container.whatsapp.reconnect();
    res.json({ success: true, message: 'WhatsApp reconnection started' });
  } catch (err) {
    next(err);
  }
});

router.post('/restart-worker', async (_req, res, next) => {
  try {
    container.retryWorker.stop();
    container.retryWorker.start();
    res.json({ success: true, message: 'Worker restarted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
