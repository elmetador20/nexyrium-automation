/** Return a phone number without WhatsApp addressing suffixes or formatting. */
function normalizePhone(value) {
  if (value == null) return null;
  const phone = String(value).trim().replace(/@(?:c\.us|s\.whatsapp\.net)$/, '');
  // A WhatsApp LID is an internal identifier, not a customer's phone number.
  if (!/^\+?[\d\s().-]+$/.test(phone)) return null;
  return phone.replace(/\D/g, '') || null;
}

module.exports = { normalizePhone };
