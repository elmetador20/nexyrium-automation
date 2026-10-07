const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createExtractor } = require('../src/integrations/ai/extractor');
const { createEventHandler } = require('../src/integrations/whatsapp/events');
const { createMessageService } = require('../src/services/message.service');
const { createConversationProcessor } = require('../src/services/conversation-processor.service');
const { createLeadService } = require('../src/services/lead.service');
const { sheetFixture } = require('./helpers/sheets');
const { SHEET_COLUMNS, WELCOME_MESSAGE } = require('../src/config/constants');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const legacyHeader = ['Phone', 'Name', 'Email', 'Course', 'City', 'State', 'Notes', 'Status', 'Context'];

function makeLead(phone = '919876543210@c.us', requirements = 'Tech') {
  return {
    id: 'lead-1', phoneNumber: phone, createdAt: new Date('2026-10-06T09:30:00Z'),
    extractedData: JSON.stringify({ requirements }),
  };
}

function extractorFor(response) {
  return createExtractor({ chatCompletion: async () => response, config: {}, logger });
}

test('AI output is normalized and braces inside requirement descriptions remain valid', async () => {
  const data = await extractorFor('```json\n' + JSON.stringify({
    name: ' Riya ', phone: '+91 98765 43210', requirements: 'pitch deck',
    requirementDetails: 'Brochure with the heading "Our work {2026}"', email: null,
  }) + '\n```').extractLeadData('[INBOUND] Customer: I want to design my brochuer');
  assert.equal(data.requirements, 'Pitch Deck');
  assert.equal(data.phone, '919876543210');
  assert.equal(data.name, 'Riya');
  assert.equal(data.requirementDetails, 'Brochure with the heading "Our work {2026}"');
  assert.equal(data.course, undefined);
});

test('unsupported categories, education-format responses, and broken AI JSON are retried', async () => {
  for (const response of ['{"requirements":"MBBS"}', '{"course":"BTech"}', '{"requirements":"Tech"', 'unavailable']) {
    assert.equal(await extractorFor(response).extractLeadData('conversation'), null);
  }
});

test('an unclassified greeting has no service summary or guessed phone number', async () => {
  const data = await extractorFor(JSON.stringify({
    requirements: null, phone: '123456789@lid', requirementDetails: 'Website from our welcome reply',
  })).extractLeadData('[INBOUND] Customer: Hi');
  assert.equal(data.requirements, null);
  assert.equal(data.requirementDetails, null);
  assert.equal(data.phone, null);
});

test('new or empty spreadsheets get lead headers and unique sequential client numbers', async () => {
  const fixture = sheetFixture([], { missing: true });
  await Promise.all([
    fixture.sync.appendLead(makeLead()),
    fixture.sync.appendLead(makeLead('919876543211@c.us', 'Pitch Deck')),
  ]);
  assert.deepEqual(fixture.rows(), [
    SHEET_COLUMNS,
    ['1', '2026-10-06', '919876543210', 'Tech', ''],
    ['2', '2026-10-06', '919876543211', 'Pitch Deck', ''],
  ]);
  for (const write of fixture.writes.filter((request) => request.valueInputOption)) {
    assert.equal(write.valueInputOption, 'RAW');
  }
});

test('phone lookup uses column C and updates preserve client number and original date', async () => {
  const fixture = sheetFixture([SHEET_COLUMNS, ['42', '2026-09-01', '+91 98765 43210', '']]);
  const found = await fixture.sync.findLeadByPhone('919876543210@c.us');
  assert.equal(found.rowIndex, 2);
  await fixture.sync.updateLead(makeLead(undefined, 'Pitch Deck'));
  assert.deepEqual(fixture.rows()[1], ['42', '2026-09-01', '919876543210', 'Pitch Deck', '']);
  assert.equal(fixture.rows().length, 2);
  await fixture.sync.appendLead(makeLead('919876543211', 'Tech'));
  assert.equal(fixture.rows()[2][0], '43');
});

test('legacy sheet conversion archives every old field before replacing the layout', async () => {
  const oldRows = [legacyHeader, ['919876543210@c.us', 'Riya', '', 'MBBS', 'Delhi', '', 'old note', 'NEW', 'old context']];
  const fixture = sheetFixture(oldRows);
  await fixture.sync.appendLead(makeLead());
  assert.equal(fixture.archives.length, 1);
  assert.deepEqual(fixture.archives[0].rows, oldRows);
  assert.match(fixture.archives[0].title, /^Leads archive /);
  assert.deepEqual(fixture.rows(), [SHEET_COLUMNS, ['1', '2026-10-06', '919876543210', 'Tech', '']]);
  const migration = fixture.writes.find((request) => request.requestBody.requests?.[0]?.duplicateSheet);
  assert.equal(migration.requestBody.requests[1].updateCells.fields, 'userEnteredValue');
});

test('the old headerless writer is recognized and education data is never used as requirements', async () => {
  const fixture = sheetFixture([['919876543210@c.us', 'Riya', '', 'BTech', '', '', '', 'NEW']]);
  await fixture.sync.appendLead(makeLead('919876543211', 'Pitch Deck'));
  assert.deepEqual(fixture.rows(), [
    SHEET_COLUMNS,
    ['1', '', '919876543210', '', ''],
    ['2', '2026-10-06', '919876543211', 'Pitch Deck', ''],
  ]);
});

test('unknown spreadsheet layouts are left intact and report a sync error', async () => {
  const original = [['Name', 'Budget'], ['Customer', '1000']];
  const fixture = sheetFixture(original);
  await assert.rejects(fixture.sync.appendLead(makeLead()), /Unrecognized Leads sheet layout/);
  assert.deepEqual(fixture.rows(), original);
  assert.equal(fixture.writes.length, 0);
});

test('a failed sheet append can be retried without consuming a client number or duplicating rows', async () => {
  const fixture = sheetFixture([SHEET_COLUMNS], { failAppend: true });
  await assert.rejects(fixture.sync.appendLead(makeLead()), /Temporary sheet error/);
  await fixture.sync.appendLead(makeLead());
  await fixture.sync.appendLead(makeLead());
  assert.deepEqual(fixture.rows(), [SHEET_COLUMNS, ['1', '2026-10-06', '919876543210', 'Tech', '']]);
});

test('WhatsApp sends one greeting for concurrent first messages and ignores group/status/self messages', async () => {
  const conversations = new Map();
  const messages = [];
  const timers = [];
  const sent = [];
  const messageService = createMessageService({
    conversationRepo: {
      async findByChatId(chatId) { return conversations.get(chatId); },
      async create(data) {
        const conversation = { ...data, id: 'conversation-1' };
        conversations.set(data.chatId, conversation);
        return conversation;
      },
    },
    messageRepo: { async create(data) { messages.push(data); return { ...data, id: `message-${messages.length}` }; } },
    inactivityTimer: { resetTimer(phone) { timers.push(phone); } },
    logger,
  });
  const client = new EventEmitter();
  client.sendMessage = async (chatId, content) => { sent.push({ chatId, content }); return {}; };
  createEventHandler({ messageService, logger }).register(client);
  const receive = client.listeners('message')[0];
  await Promise.all([
    receive({ from: '919876543210@c.us', body: 'Hi' }),
    receive({ from: '919876543210@c.us', body: 'I need a website' }),
    receive({ from: 'group@g.us', body: 'Hi' }),
    receive({ from: 'status@broadcast', body: 'Hi', isStatus: true }),
    receive({ from: '919876543210@c.us', body: 'sent by me', fromMe: true }),
  ]);
  assert.deepEqual(sent, [{ chatId: '919876543210@c.us', content: WELCOME_MESSAGE }]);
  assert.deepEqual(messages.map((message) => message.direction), ['INBOUND', 'OUTBOUND', 'INBOUND']);
  assert.deepEqual(timers, ['919876543210', '919876543210']);
});

test('WhatsApp LIDs are resolved to real phone numbers before lead capture', async () => {
  const client = new EventEmitter();
  client.getContactLidAndPhone = async () => [{ lid: '12345@lid', pn: '919876543210@c.us' }];
  let options;
  createEventHandler({ messageService: { async handleIncomingMessage(_msg, opts) { options = opts; } }, logger }).register(client);
  await client.listeners('message')[0]({ from: '12345@lid', body: 'I need an app' });
  assert.equal(options.phoneNumber, '919876543210');
});

test('conversation processing uses the WhatsApp number even when the AI omits or guesses it', async () => {
  let saved;
  const processor = createConversationProcessor({
    conversationRepo: { async findByPhone() { return { id: 'conversation-1', phone: '919876543210@c.us' }; } },
    messageRepo: { async findByConversationId() { return [{ direction: 'INBOUND', sender: 'customer', content: 'I need an app' }]; } },
    extractor: { async extractLeadData() { return { requirements: 'Tech', phone: '1234567890' }; } },
    leadService: {
      async saveAndSync(data, conversationId, transcript) { saved = { data, conversationId, transcript }; return data; },
      async markAiPending() { assert.fail('Should not mark a valid contact AI_PENDING'); },
    },
    logger,
  });
  await processor.processConversation('919876543210');
  assert.equal(saved.data.phone, '919876543210');
  assert.equal(saved.conversationId, 'conversation-1');
  assert.match(saved.transcript, /I need an app/);
});

test('a NEW lead created from a greeting is reclassified from a later brochure request in the same row', async () => {
  const fixture = sheetFixture();
  let stored = null;
  const leadService = createLeadService({
    leadRepo: {
      async findByPhoneNumber(phone) { return stored?.phoneNumber === phone ? stored : null; },
      async findByConversationId(id) { return stored?.conversationId === id ? stored : null; },
      async create(data) { stored = { ...data, id: 'lead-1', retryCount: 0, createdAt: new Date('2026-10-06T09:30:00Z') }; return stored; },
      async update(_id, data) { stored = { ...stored, ...data }; return stored; },
    },
    sheetSync: fixture.sync,
    logger,
  });
  await leadService.saveAndSync({ phone: '919876543210', requirements: null }, 'conversation-1', 'Hi');
  await leadService.saveAndSync({ phone: '919876543210', requirements: 'Pitch Deck', requirementDetails: 'Brochure design' }, 'conversation-1', 'Hi\nI need a brochure');
  assert.equal(stored.status, 'NEW');
  assert.equal(JSON.parse(stored.extractedData).requirements, 'Pitch Deck');
  assert.equal(stored.context, 'Hi\nI need a brochure');
  assert.deepEqual(fixture.rows(), [SHEET_COLUMNS, ['1', '2026-10-06', '919876543210', 'Pitch Deck', '']]);
});
