const test = require('node:test');
const assert = require('node:assert/strict');
const LeadRepository = require('../src/repositories/lead.repository');
const { createAssignmentService } = require('../src/services/assignment.service');
const { SHEET_COLUMNS, DEFAULT_SALESPEOPLE } = require('../src/config/constants');
const { sheetFixture, logger } = require('./helpers/sheets');

const listRule = (names) => ({ condition: { type: 'ONE_OF_LIST', values: names.map((name) => ({ userEnteredValue: name })) }, strict: true, showCustomUi: true });

/** In-memory Prisma boundary; executes the real repository's transactional allocation. */
function databaseFixture(count = 1) {
  let clock = 0;
  const leads = new Map(Array.from({ length: count }, (_, index) => [`lead-${index}`, {
    id: `lead-${index}`, phoneNumber: `9198765432${String(index).padStart(2, '0')}`,
    assignedSalesperson: null, assignmentSyncPending: false, assignmentError: null,
    createdAt: new Date('2026-10-07T10:00:00Z'), updatedAt: new Date(clock++),
    status: 'QUALIFIED', extractedData: JSON.stringify({ requirements: 'Tech' }),
  }]));
  const state = { lastSalesperson: null };
  let transactions = Promise.resolve();
  const prisma = {
    lead: {
      async findUnique({ where }) { return structuredClone(leads.get(where.id) || null); },
      async update({ where, data }) {
        const updated = { ...leads.get(where.id), ...data, updatedAt: new Date(clock++) };
        leads.set(where.id, updated);
        return structuredClone(updated);
      },
      async updateMany({ where, data }) {
        const current = leads.get(where.id);
        if (current?.assignedSalesperson !== where.assignedSalesperson
          || current?.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        await this.update({ where: { id: where.id }, data });
        return { count: 1 };
      },
    },
    leadAssignmentState: {
      async update({ data }) { Object.assign(state, data); },
    },
    async $executeRaw() {},
    async $queryRaw() { return [{ last_salesperson: state.lastSalesperson }]; },
    $transaction(operation) {
      const pending = transactions.then(() => operation(prisma));
      transactions = pending.catch(() => {});
      return pending;
    },
  };
  return { repo: new LeadRepository(prisma), leads, state };
}

test('automatic assignments rotate fairly, survive service recreation, and are stable on follow-up sync', async () => {
  const db = databaseFixture(6);
  const sheet = sheetFixture();
  const create = () => createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  let assignment = create();
  await Promise.all(Array.from(db.leads.values()).slice(0, 4).map((lead) => assignment.syncLead(lead)));
  assert.deepEqual(sheet.rows().slice(1).map((row) => row[4]), DEFAULT_SALESPEOPLE);
  assignment = create();
  await assignment.syncLead(db.leads.get('lead-4'));
  await assignment.syncLead(db.leads.get('lead-0'));
  await assignment.syncLead(db.leads.get('lead-5'));
  assert.deepEqual(sheet.rows().slice(1).map((row) => row[4]), [...DEFAULT_SALESPEOPLE, 'Sharique', 'Arshan']);
  assert.equal(db.leads.get('lead-0').assignmentSyncPending, false);
});

test('existing sheet dropdown selections are imported rather than reassigned', async () => {
  const db = databaseFixture();
  const sheet = sheetFixture([SHEET_COLUMNS, ['20', '2026-09-01', db.leads.get('lead-0').phoneNumber, 'Tech', 'Aryan']]);
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  const lead = await assignment.syncLead(db.leads.get('lead-0'));
  assert.equal(lead.assignedSalesperson, 'Aryan');
  assert.equal(db.state.lastSalesperson, null);
  assert.equal(sheet.rows()[1][0], '20');
});

test('dashboard reassignment updates the dropdown and does not reset lead status or advance rotation', async () => {
  const db = databaseFixture(2);
  const sheet = sheetFixture();
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  await assignment.syncLead(db.leads.get('lead-0'));
  const lead = await assignment.reassign('lead-0', '  aRyAn ');
  assert.equal(lead.assignedSalesperson, 'Aryan');
  assert.equal(lead.status, 'QUALIFIED');
  assert.equal(sheet.rows()[1][4], 'Aryan');
  assert.equal(db.state.lastSalesperson, 'Sharique');
  await assignment.syncLead(db.leads.get('lead-1'));
  assert.equal(sheet.rows()[2][4], 'Arshan');
});

test('failed assignment writes stay saved and retry to the latest assignee without duplicate rows', async () => {
  const db = databaseFixture();
  const sheet = sheetFixture();
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  await assignment.syncLead(db.leads.get('lead-0'));
  sheet.failNextAssignment();
  const failed = await assignment.reassign('lead-0', 'Ashutosh');
  assert.equal(failed.assignedSalesperson, 'Ashutosh');
  assert.equal(failed.assignmentSyncPending, true);
  assert.match(failed.assignmentError, /Temporary assignment write error/);
  await assignment.reassign('lead-0', 'Aryan');
  await assignment.syncLead(failed); // A stale worker snapshot must not restore Ashutosh.
  assert.equal(sheet.rows().length, 2);
  assert.equal(sheet.rows()[1][4], 'Aryan');
  assert.equal(db.leads.get('lead-0').assignmentSyncPending, false);
});

test('spreadsheet reassignment is visible in the dashboard and survives later customer messages', async () => {
  const db = databaseFixture();
  const sheet = sheetFixture();
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  await assignment.syncLead(db.leads.get('lead-0'));
  sheet.editCell(1, 4, 'Arshan');
  const [refreshed] = await assignment.refreshFromSheet([db.leads.get('lead-0')]);
  assert.equal(refreshed.assignedSalesperson, 'Arshan');
  await assignment.syncLead(refreshed);
  assert.equal(sheet.rows()[1][4], 'Arshan');
  await db.repo.update('lead-0', { assignedSalesperson: 'Aryan', assignmentSyncPending: true });
  const [pending] = await assignment.refreshFromSheet([db.leads.get('lead-0')]);
  assert.equal(pending.assignedSalesperson, 'Aryan');
});

test('new salesperson names and exact lowercase dropdown labels are discovered on refresh', async () => {
  const sheet = sheetFixture([SHEET_COLUMNS], { rule: listRule(['sharique', 'arshan', 'ashutosh', 'aryan']) });
  assert.deepEqual(await sheet.sync.getSalespeople(), ['sharique', 'arshan', 'ashutosh', 'aryan']);
  sheet.setRule(listRule(['sharique', 'arshan', 'ashutosh', 'aryan', 'new colleague', 'NEW COLLEAGUE', '']));
  assert.deepEqual(await sheet.sync.getSalespeople({ refresh: true }), ['sharique', 'arshan', 'ashutosh', 'aryan', 'new colleague']);
  const db = databaseFixture();
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  await assignment.reassign('lead-0', 'New Colleague');
  assert.equal(sheet.rows()[1][4], 'new colleague');
});

test('dropdown-from-range supports additions without rewriting its range-based validation', async () => {
  const rule = { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Team!A2:A' }] }, strict: true, showCustomUi: true };
  const sheet = sheetFixture([SHEET_COLUMNS], { rule, rangeValues: [['Sharique'], ['Arshan'], ['Aryan']] });
  assert.deepEqual(await sheet.sync.getSalespeople(), ['Sharique', 'Arshan', 'Aryan']);
  sheet.setRangeValues([['Sharique'], ['Arshan'], ['Aryan'], ['Meera']]);
  assert.deepEqual(await sheet.sync.getSalespeople({ refresh: true }), ['Sharique', 'Arshan', 'Aryan', 'Meera']);
  const db = databaseFixture();
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  await assignment.reassign('lead-0', 'Meera');
  assert.equal(sheet.rows()[1][4], 'Meera');
  const applied = sheet.writes.find((write) => write.requestBody.requests?.[0]?.setDataValidation);
  assert.deepEqual(applied.requestBody.requests[0].setDataValidation.rule, rule);
});

test('a salesperson column after unrelated columns is detected without overwriting them', async () => {
  const headers = [...SHEET_COLUMNS.slice(0, 4), 'Budget', 'Sales Person'];
  const db = databaseFixture();
  const sheet = sheetFixture([headers, ['1', '2026-10-07', db.leads.get('lead-0').phoneNumber, 'Tech', '25000', 'Aryan']]);
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  await assignment.reassign('lead-0', 'Arshan');
  assert.equal(sheet.rows()[1][4], '25000');
  assert.equal(sheet.rows()[1][5], 'Arshan');
  assert.equal(sheet.rows()[0][5], 'Sales Person');
});

test('unknown salesperson names and missing leads are rejected without changing assignment', async () => {
  const db = databaseFixture();
  const sheet = sheetFixture();
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  await assert.rejects(assignment.reassign('lead-0', 'Unlisted Person'), (error) => error.statusCode === 400);
  await assert.rejects(assignment.reassign('missing', 'Sharique'), (error) => error.statusCode === 404);
  assert.equal(db.leads.get('lead-0').assignedSalesperson, null);
});

test('a new colleague enters the persisted round-robin rotation', async () => {
  const db = databaseFixture(6);
  const sheet = sheetFixture();
  const assignment = createAssignmentService({ leadRepo: db.repo, sheetSync: sheet.sync, logger });
  for (let index = 0; index < 4; index++) await assignment.syncLead(db.leads.get(`lead-${index}`));
  sheet.setRule(listRule([...DEFAULT_SALESPEOPLE, 'Meera']));
  await sheet.sync.getSalespeople({ refresh: true });
  await assignment.syncLead(db.leads.get('lead-4'));
  await assignment.syncLead(db.leads.get('lead-5'));
  assert.equal(sheet.rows()[5][4], 'Meera');
  assert.equal(sheet.rows()[6][4], 'Sharique');
});
