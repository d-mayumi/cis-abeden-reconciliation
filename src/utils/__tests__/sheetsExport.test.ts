import { describe, expect, it } from 'vitest';
import { buildSheetsWritePayload, TARGET_SHEET_GID, TARGET_SPREADSHEET_ID } from '../sheetsExport';
import { reconcileBillingRows, type AbedenRow, type CisRow } from '../cisAbedenReconciliation';

const abeden = (): AbedenRow => ({
  sourceRowNumber: 3,
  cells: ['INV-1', 'BILL-1', 'CON-1', 'khope0079', '矢本海浜緑地パークゴルフ場', '202606', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', '43,489'],
  customerId: 'khope0079',
  customerName: '矢本海浜緑地パークゴルフ場',
  targetMonth: '202606',
  billingAmount: '43,489',
});

const cis = (): CisRow => ({
  sourceFileName: 'cis.csv',
  sourceRowNumber: 2,
  billingMonth: '202606',
  customerNumber: 'khope0079',
  customerName: '東松島市 矢本海浜緑地パークゴルフ場',
  billingAmount: '43490',
  issueDate: '2026/06/30',
});

describe('Google Sheets書き込みペイロード', () => {
  it('指定スプレッドシートID/gidへ、3行目以降へ追記する突合結果行だけを送る', () => {
    const result = reconcileBillingRows([cis()], [abeden()]);
    const payload = buildSheetsWritePayload(result);

    expect(TARGET_SPREADSHEET_ID).toBe('1AHwU-UA3llo9ex52-obkbROLqrWq514nekXMtdkDl3g');
    expect(TARGET_SHEET_GID).toBe(54789944);
    expect(payload.spreadsheetId).toBe(TARGET_SPREADSHEET_ID);
    expect(payload.sheetGid).toBe(TARGET_SHEET_GID);
    expect(payload.values).toHaveLength(1);
    expect(payload.values[0]).toHaveLength(236);
    expect(payload.values[0][4]).toBe('khope0079');
    expect(payload.values[0][8]).toContain('東松島市');
    expect(payload.values[0][20]).toBe(true);
    expect(payload.format.headerRowCount).toBe(2);
    expect(payload.format.columnCount).toBe(236);
    expect(payload.format.rowFormats[0].rowIndex).toBe(0);
    expect(payload.format.rowFormats[0].okColumns).toContain(20);
    expect(payload.format.rowFormats[0].ngColumns).toContain(19);
  });
});
