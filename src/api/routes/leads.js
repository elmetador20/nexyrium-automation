/**
 * Leads & Conversations API routes.
 *
 * @module api/routes/leads
 */

const { Router } = require('express');
const container = require('../../container');
const { requireAdmin } = require('../admin-auth');

const router = Router();

function withExtractedData(lead) {
  let parsedExtractedData = null;
  try {
    parsedExtractedData = lead.extractedData ? JSON.parse(lead.extractedData) : null;
  } catch {
    // A malformed legacy payload should not prevent displaying the lead.
  }
  return { ...lead, parsedExtractedData };
}

router.get('/', async (req, res, next) => {
  try {
    const { prisma } = container;
    const {
      page = '1',
      limit = '20',
      search = '',
      status = '',
      sort = 'createdAt',
      order = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phoneNumber: { contains: search } },
        { email: { contains: search } },
        { extractedData: { contains: search } },
        { assignedSalesperson: { contains: search } },
      ];
    }

    const allowedSorts = ['createdAt', 'updatedAt', 'name', 'phoneNumber', 'status'];
    const sortField = allowedSorts.includes(sort) ? sort : 'createdAt';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortField]: sortOrder },
        include: { conversation: { select: { id: true, status: true, phone: true } } },
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({
      leads: (await container.assignmentService.refreshFromSheet(leads)).map(withExtractedData),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Register before /:id so "salespeople" is not treated as a lead ID.
router.get('/salespeople', async (_req, res, next) => {
  try {
    res.json({ salespeople: await container.sheetSync.getSalespeople({ refresh: true }) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/assignment', requireAdmin, async (req, res, next) => {
  const name = req.body?.assignedSalesperson;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 191) {
    return res.status(400).json({ error: 'A valid salesperson name is required' });
  }
  try {
    const lead = await container.assignmentService.reassign(req.params.id, name);
    res.json({ lead: withExtractedData(lead), synced: !lead.assignmentSyncPending });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { prisma } = container;
    const { id } = req.params;

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        conversation: {
          include: {
            messages: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [refreshed] = await container.assignmentService.refreshFromSheet([lead]);
    res.json(withExtractedData(refreshed));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/conversation', async (req, res, next) => {
  try {
    const { prisma } = container;
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        lead: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const { prisma } = container;
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        lead: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
