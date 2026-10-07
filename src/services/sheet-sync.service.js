/**
 * Google Sheets sync service — maintains the Nexyrium lead layout,
 * assigns sequential client numbers, and upserts rows by phone number.
 *
 * @module services/sheet-sync.service
 */

const { SHEET_COLUMNS, REQUIREMENT_CATEGORY, LEAD_STATUS, DEFAULT_SALESPEOPLE } = require('../config/constants');
const { normalizePhone } = require('../lib/phone');

const BASE_COLUMNS = SHEET_COLUMNS.slice(0, 4);
const LEGACY_COLUMNS = ['Phone', 'Name', 'Email', 'Course', 'City', 'State', 'Notes', 'Status', 'Context'];
const phoneKey = (value) => normalizePhone(value) || String(value ?? '').trim();
const salespersonHeader = (value) => /^(salespersons?|salespersonname|salespeople|salesexecutive|assignedto|assignedsalesperson|assignee|owner)$/i.test(
  String(value ?? '').replace(/[^a-z]/gi, '')
);

/**
 * @param {object} deps
 * @param {import('googleapis').sheets_v4.Sheets} deps.sheets
 * @param {string} deps.spreadsheetId
 * @param {import('../lib/logger')} deps.logger
 */
function createSheetSync({ sheets, spreadsheetId, logger }) {
  let initialized = false;
  let queue = Promise.resolve();
  let sheetProperties;
  let salespersonColumn = 4;
  let rosterCache = null;
  const columnLetter = () => String.fromCharCode(65 + salespersonColumn);
  const sheetRange = () => `Leads!A:${columnLetter()}`;

  // Serialize reads/writes so simultaneous conversations cannot share a client number.
  function enqueue(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }

  async function readRows(range = sheetRange()) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return response.data.values || [];
  }

  /** Set headers, or convert the known education layout after making a full backup. */
  async function ensureLayout() {
    if (initialized) return;

    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
    let properties = metadata.data.sheets?.find((sheet) => sheet.properties.title === 'Leads')?.properties;
    if (!properties) {
      const added = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: 'Leads', gridProperties: { frozenRowCount: 1 } } } }] },
      });
      properties = added.data.replies[0].addSheet.properties;
    }

    sheetProperties = properties;
    const lastColumn = String.fromCharCode(64 + Math.min(26, properties.gridProperties?.columnCount || 26));
    const rows = await readRows(`Leads!A:${lastColumn}`);
    const first = rows[0] || [];
    const matchesHeader = (columns) => columns.every(
      (column, index) => String(first[index] ?? '').trim().toLowerCase() === column.toLowerCase()
    );

    if (!rows.some((row) => row.some((cell) => String(cell).trim()))) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Leads!A1:E1',
        valueInputOption: 'RAW',
        requestBody: { values: [SHEET_COLUMNS] },
      });
    } else if (matchesHeader(BASE_COLUMNS)) {
      const existingColumn = first.findIndex((header, index) => index >= 4 && salespersonHeader(header));
      if (existingColumn !== -1) salespersonColumn = existingColumn;
      else {
        salespersonColumn = Math.max(4, first.length);
        // Blank E with dropdowns/data is the natural fifth column.
        if (!first[4]) salespersonColumn = 4;
        if (salespersonColumn >= 26) throw new Error('Add a Salesperson column within columns E:Z');
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: `Leads!${columnLetter()}1`, valueInputOption: 'RAW',
          requestBody: { values: [['Salesperson']] },
        });
      }
    } else {
      const hasLegacyHeader = matchesHeader(LEGACY_COLUMNS);
      const legacyRows = hasLegacyHeader ? rows.slice(1) : rows;
      const nonEmpty = legacyRows.filter((row) => row.some((cell) => String(cell).trim()));
      const isHeaderlessLegacy = !hasLegacyHeader && nonEmpty.length > 0 && nonEmpty.every(
        (row) => phoneKey(row[0]) && Object.values(LEAD_STATUS).includes(row[7])
      );
      if (!hasLegacyHeader && !isHeaderlessLegacy) {
        throw new Error(`Unrecognized Leads sheet layout. Expected: ${SHEET_COLUMNS.join(', ')}`);
      }

      // Old rows have no capture date or service category; leave those cells empty.
      // Preserve all original fields, formulas, and formatting in a duplicated tab.
      const converted = [SHEET_COLUMNS, ...nonEmpty.map((row, index) => [String(index + 1), '', phoneKey(row[0]), '', ''])];
      const archiveTitle = `Leads archive ${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            { duplicateSheet: { sourceSheetId: properties.sheetId, newSheetName: archiveTitle } },
            {
              updateCells: {
                range: { sheetId: properties.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: LEGACY_COLUMNS.length },
                rows: converted.map((row) => ({ values: row.map((cell) => ({ userEnteredValue: { stringValue: cell } })) })),
                fields: 'userEnteredValue',
              },
            },
          ],
        },
      });
      logger.info('Converted legacy Leads sheet to Nexyrium layout', { archiveTitle, leads: nonEmpty.length });
    }

    initialized = true;
  }

  /** Read the existing dropdown, preserving its labels and range-based configuration. */
  async function loadSalespeople(refresh = false) {
    if (!refresh && rosterCache && Date.now() - rosterCache.loadedAt < 60_000) return rosterCache;
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`Leads!${columnLetter()}2:${columnLetter()}`],
      fields: 'sheets(data(rowData(values(dataValidation))))',
    });
    const cells = response.data.sheets?.flatMap((sheet) => sheet.data || [])
      .flatMap((grid) => grid.rowData || []).flatMap((row) => row.values || []) || [];
    let rule = cells.find((cell) => cell.dataValidation?.condition)?.dataValidation;
    if (!rule) {
      rule = {
        condition: { type: 'ONE_OF_LIST', values: DEFAULT_SALESPEOPLE.map((name) => ({ userEnteredValue: name })) },
        strict: true, showCustomUi: true,
      };
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ setDataValidation: {
          range: { sheetId: sheetProperties.sheetId, startRowIndex: 1,
            startColumnIndex: salespersonColumn, endColumnIndex: salespersonColumn + 1 },
          rule,
        } }] },
      });
    }
    let values;
    if (rule.condition.type === 'ONE_OF_LIST') {
      values = rule.condition.values?.map((value) => value.userEnteredValue) || [];
    } else if (rule.condition.type === 'ONE_OF_RANGE') {
      const range = rule.condition.values?.[0]?.userEnteredValue?.replace(/^=/, '');
      if (!range) throw new Error('Salesperson dropdown range is missing');
      values = (await readRows(range)).flat();
    } else {
      throw new Error('Salesperson cells must use a dropdown list or dropdown from a range');
    }
    const names = [];
    for (const value of values) {
      const name = String(value ?? '').trim();
      if (name && name.length <= 191 && !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    rosterCache = { names, rule, loadedAt: Date.now() };
    return rosterCache;
  }

  function getSalespeople({ refresh = false } = {}) {
    return enqueue(async () => {
      await ensureLayout();
      return [...(await loadSalespeople(refresh)).names];
    });
  }

  function getAssignments() {
    return enqueue(async () => {
      await ensureLayout();
      const rows = await readRows();
      return new Map(rows.slice(1).filter((row) => row[2]).map((row) => [phoneKey(row[2]), String(row[salespersonColumn] || '').trim()]));
    });
  }

  /**
   * Map a lead DB row to a flat array matching SHEET_COLUMNS.
   *
   * @param {object} lead
   * @returns {string[]}
   */
  function toRow(lead, clientNumber, date) {
    const data = lead.extractedData ? JSON.parse(lead.extractedData) : {};
    return [
      String(clientNumber),
      date || (lead.createdAt ? new Date(lead.createdAt).toISOString().slice(0, 10) : ''),
      phoneKey(lead.phoneNumber),
      Object.values(REQUIREMENT_CATEGORY).includes(data.requirements) ? data.requirements : '',
    ];
  }

  function findInRows(rows, phone) {
    const index = rows.findIndex((row, i) => i > 0 && phoneKey(row[2]) === phoneKey(phone));
    return index === -1 ? null : {
      rowIndex: index + 1, row: rows[index], salesperson: String(rows[index][salespersonColumn] || '').trim() || null,
    };
  }

  /**
   * Find a lead row by phone number.
   *
   * @param {string} phone
   * @returns {Promise<{ rowIndex: number, row: string[] } | null>}
   */
  async function findLeadByPhone(phone) {
    return enqueue(async () => {
      await ensureLayout();
      return findInRows(await readRows(), phone);
    });
  }

  /**
   * Append a new lead or refresh its existing row after a customer clarifies their request.
   * Client number and original capture date remain stable across updates and retries.
   *
   * @param {object} lead
   */
  function appendLead(lead) {
    return enqueue(async () => {
      await ensureLayout();
      const rows = await readRows();
      const existing = findInRows(rows, lead.phoneNumber);
      const nextNumber = rows.slice(1).reduce((max, row) => {
        const number = Number(row[0]);
        return Number.isSafeInteger(number) && number > max ? number : max;
      }, 0) + 1;
      const row = toRow(lead, existing?.row[0] || nextNumber, existing?.row[1]);
      let salesperson = (!lead.assignmentSyncPending && existing?.salesperson)
        || lead.assignedSalesperson || '';
      const { rule, names } = await loadSalespeople();
      if (lead.assignmentSyncPending && salesperson) {
        const selected = names.find((name) => name.toLowerCase() === salesperson.toLowerCase());
        // A name may have been removed while a dashboard change was waiting to sync.
        if (!selected) throw new Error(`Assigned salesperson is no longer in the dropdown: ${salesperson}`);
        salesperson = selected;
      }

      let rowIndex = existing?.rowIndex;
      if (existing) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Leads!A${existing.rowIndex}:D${existing.rowIndex}`,
          valueInputOption: 'RAW',
          requestBody: { values: [row] },
        });
        logger.info('Lead updated in sheet', { phone: lead.phoneNumber, rowIndex: existing.rowIndex });
      } else {
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Leads!A:D',
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] },
        });
        rowIndex = Number(response.data.updates?.updatedRange?.match(/![A-Z]+(\d+)/)?.[1]);
        if (!rowIndex) rowIndex = (await readRows()).findIndex((entry) => phoneKey(entry[2]) === phoneKey(lead.phoneNumber)) + 1;
        if (rowIndex < 2) throw new Error('Cannot locate appended lead for salesperson assignment');
        logger.info('Lead appended to sheet', { phone: lead.phoneNumber, clientNumber: row[0] });
      }
      if (!existing || lead.assignmentSyncPending) {
        // Copy the template for new rows and pending/retried assignments.
        // Other cells' validation and formatting stays intact.
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ setDataValidation: {
            range: { sheetId: sheetProperties.sheetId, startRowIndex: rowIndex - 1, endRowIndex: rowIndex,
              startColumnIndex: salespersonColumn, endColumnIndex: salespersonColumn + 1 },
            rule,
          } }] },
        });
      }
      if (!existing?.salesperson || lead.assignmentSyncPending) {
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: `Leads!${columnLetter()}${rowIndex}`, valueInputOption: 'RAW',
          requestBody: { values: [[salesperson]] },
        });
      }
      return { rowIndex, row, salesperson: salesperson || null };
    });
  }

  /**
   * Update an existing row.  Falls back to append if the phone is not found.
   *
   * @param {object} lead
   */
  function updateLead(lead) {
    return appendLead(lead);
  }

  return { appendLead, updateLead, findLeadByPhone, getSalespeople, getAssignments, phoneKey };
}

module.exports = { createSheetSync };
