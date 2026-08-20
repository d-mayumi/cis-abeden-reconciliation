import { describe, expect, it } from 'vitest';
import {
  reconcileBillingRows,
  normalizeCustomerName,
  buildOutputRows,
  mismatchItemLabel,
  type AbedenRow,
  type CisRow,
} from '../cisAbedenReconciliation';

const abeden = (overrides: Partial<AbedenRow> = {}): AbedenRow => ({
  sourceRowNumber: 3,
  cells: ['INV-1', 'BILL-1', 'CON-1', 'khope0079', '矢本海浜緑地パークゴルフ場', '202606', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', '43,489', 'tax'],
  customerId: 'khope0079',
  customerName: '矢本海浜緑地パークゴルフ場',
  targetMonth: '202606',
  billingAmount: '43,489',
  ...overrides,
});

const cis = (overrides: Partial<CisRow> = {}): CisRow => ({
  sourceFileName: 'cis1.csv',
  sourceRowNumber: 2,
  billingMonth: '202606',
  customerNumber: 'khope0079',
  customerName: '東松島市　矢本海浜緑地パークゴルフ場',
  billingAmount: '43490',
  issueDate: '2026/06/30',
  ...overrides,
});

describe('CIS・あべでん料金突合', () => {
  it('名称はNFKC・空白除去・大文字化で正規化する', () => {
    expect(normalizeCustomerName(' ｋｈｏｐｅ  ABC　ｱｲｳ\t')).toBe('KHOPEABCアイウ');
  });

  it('需要家IDと対象年月で突合し、接頭辞一致と±1円をOKにする', () => {
    const result = reconcileBillingRows([cis()], [abeden()]);

    expect(result.summary.total).toBe(1);
    expect(result.summary.okCount).toBe(1);
    expect(result.summary.amountMismatchCount).toBe(0);
    expect(result.summary.nameMismatchCount).toBe(0);
    expect(result.rows[0]).toMatchObject({
      key: 'khope0079__202606',
      nameJudge: 'prefix',
      nameOk: true,
      amountExact: false,
      amountWithinOneYen: true,
      issueDate: '2026/06/30',
    });
  });

  it('CIS重複は同値なら統合し、異値なら処理中断エラーにする', () => {
    const same = reconcileBillingRows([cis({ sourceFileName: 'cis1.csv' }), cis({ sourceFileName: 'cis2.csv' })], [abeden()]);
    expect(same.warnings.some((warning) => warning.includes('同値重複'))).toBe(true);

    expect(() => reconcileBillingRows([
      cis({ sourceFileName: 'cis1.csv', billingAmount: '100' }),
      cis({ sourceFileName: 'cis2.csv', billingAmount: '200' }),
    ], [abeden()])).toThrow('CIS重複キーに異なる値があります');
  });

  it('あべでんのみとCISのみのアンマッチを分けて集計する', () => {
    const result = reconcileBillingRows(
      [cis({ customerNumber: 'cis-only', billingAmount: '100' })],
      [abeden({ customerId: 'abeden-only', billingAmount: '100' })],
    );

    expect(result.summary.abedenOnlyCount).toBe(1);
    expect(result.summary.cisOnlyCount).toBe(1);
    expect(result.summary.okCount).toBe(0);
    expect(result.rows[0].matched).toBe(false);
    expect(result.cisOnlyRows[0].customerNumber).toBe('cis-only');
  });

  it('既存互換の236列へE/F/G/I/J/S/T/U/Vを挿入する', () => {
    const result = reconcileBillingRows([cis()], [abeden()]);
    const [output] = buildOutputRows(result.rows);

    expect(output).toHaveLength(236);
    expect(output[3]).toBe('khope0079');
    expect(output[4]).toBe('khope0079');
    expect(output[5]).toBe('khope0079');
    expect(output[6]).toBe('');
    expect(output[8]).toContain('東松島市');
    expect(output[9]).toBe(true);
    expect(output[18]).toBe('43490');
    expect(output[19]).toBe(false);
    expect(output[20]).toBe(true);
    expect(output[21]).toBe('2026/06/30');
  });


  it('最終出力のR列は数値入力でも文字列として出力する', () => {
    const result = reconcileBillingRows([cis()], [abeden({
      cells: ['INV-1', 'BILL-1', 'CON-1', 'khope0079', '矢本海浜緑地パークゴルフ場', '202606', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 43489, 'tax'],
      billingAmount: 43489,
    })]);
    const [output] = buildOutputRows(result.rows);

    expect(output[17]).toBe('43489');
    expect(typeof output[17]).toBe('string');
  });

  it('不一致項目を需要家名・請求金額・あべでんのみとして表示用に列挙する', () => {
    const result = reconcileBillingRows([
      cis({ customerName: '別名', billingAmount: '1000' }),
    ], [
      abeden({ billingAmount: '1200' }),
      abeden({ customerId: 'abeden-only', billingAmount: '1200' }),
    ]);

    expect(mismatchItemLabel(result.rows[0])).toBe('需要家名 / 請求金額');
    expect(mismatchItemLabel(result.rows[1])).toBe('あべでんのみ');
  });
});
