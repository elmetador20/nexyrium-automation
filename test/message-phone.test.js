const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageService } = require('../src/services/message.service');

test('a temporary LID resolution failure retains the known phone and processes the follow-up', async () => {
  let timerPhone;
  let saved;
  const service = createMessageService({
    conversationRepo: {
      async findByChatId() { return { id: 'conversation-1', chatId: '12345@lid', phone: '919876543210' }; },
      async updatePhone() { assert.fail('Should retain the existing resolved phone'); },
    },
    messageRepo: { async create(data) { saved = data; return data; } },
    inactivityTimer: { resetTimer(phone) { timerPhone = phone; } },
    logger: { info() {}, error() {} },
  });
  await service.handleIncomingMessage({ from: '12345@lid', body: 'I want a brochure' }, { phoneNumber: null });
  assert.equal(saved.content, 'I want a brochure');
  assert.equal(saved.conversationId, 'conversation-1');
  assert.equal(timerPhone, '919876543210');
});
