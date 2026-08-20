import { buildOutputRows, type ReconciliationResult, type ReconciliationRow } from './cisAbedenReconciliation';

export const TARGET_SPREADSHEET_ID = '1AHwU-UA3llo9ex52-obkbROLqrWq514nekXMtdkDl3g';
export const TARGET_SHEET_GID = 54789944;
export const TARGET_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${TARGET_SPREADSHEET_ID}/edit?gid=${TARGET_SHEET_GID}#gid=${TARGET_SHEET_GID}`;

export interface SheetsWritePayload {
  spreadsheetId: string;
  sheetGid: number;
  values: unknown[][];
  format: SheetsWriteFormat;
}

export interface SheetsWriteFormat {
  headerRowCount: number;
  columnCount: number;
  rowFormats: Array<{
    rowIndex: number;
    okColumns: number[];
    ngColumns: number[];
  }>;
}

const finalOutputCellFormat = (row: ReconciliationRow, columnIndex: number): 'ok' | 'ng' | '' => {
  if (!row.matched && [4, 8, 18, 21].includes(columnIndex)) return 'ng';
  if (!row.nameOk && [8, 9].includes(columnIndex)) return 'ng';
  if (!row.amountExact && columnIndex === 19) return 'ng';
  if (!row.amountWithinOneYen && columnIndex === 20) return 'ng';
  if ([9, 19, 20].includes(columnIndex)) return 'ok';
  return '';
};

const buildSheetsWriteFormat = (rows: ReconciliationRow[]): SheetsWriteFormat => ({
  headerRowCount: 2,
  columnCount: 236,
  rowFormats: rows.map((row, rowIndex) => {
    const okColumns: number[] = [];
    const ngColumns: number[] = [];
    for (let columnIndex = 0; columnIndex < 236; columnIndex += 1) {
      const format = finalOutputCellFormat(row, columnIndex);
      if (format === 'ok') okColumns.push(columnIndex);
      if (format === 'ng') ngColumns.push(columnIndex);
    }
    return { rowIndex, okColumns, ngColumns };
  }),
});

export const buildSheetsWritePayload = (result: ReconciliationResult): SheetsWritePayload => {
  return {
    spreadsheetId: TARGET_SPREADSHEET_ID,
    sheetGid: TARGET_SHEET_GID,
    values: buildOutputRows(result.rows),
    format: buildSheetsWriteFormat(result.rows),
  };
};
