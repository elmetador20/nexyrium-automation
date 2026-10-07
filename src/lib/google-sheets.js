/**
 * Lazy-initialised Google Sheets v4 client (Service Account).
 *
 * @module lib/google-sheets
 */

const fs = require('node:fs');
// Load only the installed Sheets API entry point. Importing googleapis' root
// eagerly loads every Google API, wasting cold-start time and Render Free RAM.
const { sheets, auth: googleAuth } = require('googleapis/build/src/apis/sheets');
const logger = require('./logger');

/** @type {import('googleapis').sheets_v4.Sheets | null} */
let sheetsClient = null;

/**
 * Returns the cached Google Sheets client, creating it on first call.
 *
 * @param {{ credentialsPath: string }} options
 * @returns {import('googleapis').sheets_v4.Sheets}
 */
function createSheetsClient({ credentialsPath }) {
  if (sheetsClient) return sheetsClient;

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

  const auth = new googleAuth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = sheets({ version: 'v4', auth });
  logger.info('Google Sheets client initialized');
  return sheetsClient;
}

module.exports = { createSheetsClient };
