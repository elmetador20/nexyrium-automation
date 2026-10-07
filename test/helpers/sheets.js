const { createSheetSync } = require('../../src/services/sheet-sync.service');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function sheetFixture(initialRows = [], { missing = false, failAppend = false, rule = null, rangeValues = [] } = {}) {
  let rows = structuredClone(initialRows);
  let properties = missing ? null : { title: 'Leads', sheetId: 1, gridProperties: { columnCount: 26 } };
  let validation = rule;
  let sourceNames = rangeValues;
  let failAssignment = false;
  const archives = [];
  const writes = [];
  const sheets = {
    spreadsheets: {
      async get(request) {
        if (request.ranges) return { data: { sheets: [{ data: [{ rowData: [{ values: [{ dataValidation: validation }] }] }] }] } };
        return { data: { sheets: properties ? [{ properties }] : [] } };
      },
      async batchUpdate(request) {
        writes.push(request);
        const replies = [];
        for (const operation of request.requestBody.requests) {
          if (operation.addSheet) {
            properties = { ...operation.addSheet.properties, sheetId: 1 };
            replies.push({ addSheet: { properties } });
          }
          if (operation.duplicateSheet) archives.push({ title: operation.duplicateSheet.newSheetName, rows: structuredClone(rows) });
          if (operation.updateCells) rows = operation.updateCells.rows.map((row) => row.values.map((cell) => cell.userEnteredValue.stringValue));
          if (operation.setDataValidation) validation = structuredClone(operation.setDataValidation.rule);
        }
        return { data: { replies } };
      },
      values: {
        async get(request) {
          return { data: { values: structuredClone(request.range.startsWith('Leads!') ? rows : sourceNames) } };
        },
        async update(request) {
          writes.push(request);
          const [, column, number] = request.range.match(/!([A-Z]+)(\d+)/);
          const rowIndex = Number(number) - 1;
          const colIndex = column.charCodeAt(0) - 65;
          if (colIndex >= 4 && rowIndex > 0 && failAssignment) {
            failAssignment = false;
            throw new Error('Temporary assignment write error');
          }
          rows[rowIndex] ??= [];
          const values = request.requestBody.values[0];
          for (let i = 0; i < values.length; i++) rows[rowIndex][colIndex + i] = values[i];
          return { data: {} };
        },
        async append(request) {
          if (failAppend) { failAppend = false; throw new Error('Temporary sheet error'); }
          writes.push(request);
          rows.push([...request.requestBody.values[0]]);
          return { data: { updates: { updatedRange: `Leads!A${rows.length}:D${rows.length}` } } };
        },
      },
    },
  };
  return {
    sync: createSheetSync({ sheets, spreadsheetId: 'test-sheet', logger }),
    rows: () => structuredClone(rows),
    setRule(value) { validation = value; },
    setRangeValues(value) { sourceNames = value; },
    editCell(rowIndex, colIndex, value) { rows[rowIndex][colIndex] = value; },
    failNextAssignment() { failAssignment = true; },
    archives, writes,
  };
}

module.exports = { sheetFixture, logger };
