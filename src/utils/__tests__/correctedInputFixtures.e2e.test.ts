import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOutputRows, reconcileBillingRows } from '../cisAbedenReconciliation';
import { parseAbedenFile, parseCisFile } from '../cisAbedenFiles';

const fixtureDir = process.env.CIS_ABEDEN_TEST_FIXTURE_DIR;

describe.runIf(Boolean(fixtureDir))('実物入力列に合わせた20ファイル', () => {
  it('アプリで全件を読み、入力列から出力列まで正しく対応する', async () => {
    const names = (await fs.readdir(fixtureDir!)).filter((name) => name.endsWith('.xlsx')).sort();
    const cisRows = [];
    const abedenRows = [];

    for (const name of names) {
      const bytes = await fs.readFile(path.join(fixtureDir!, name));
      const file = new File([new Uint8Array(bytes)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      if (name.includes('_CIS_')) cisRows.push(...(await parseCisFile(file)).rows);
      else abedenRows.push(...(await parseAbedenFile(file)).rows);
    }

    expect(names).toHaveLength(20);
    expect(cisRows).toHaveLength(11);
    expect(abedenRows).toHaveLength(11);

    const result = reconcileBillingRows(cisRows, abedenRows);
    expect(result.summary).toEqual({
      total: 11,
      okCount: 6,
      amountMismatchCount: 4,
      nameMismatchCount: 3,
      abedenOnlyCount: 2,
      cisOnlyCount: 2,
    });

    const representativeIndex = result.rows.findIndex((row) => row.abeden.customerId === 'TC001');
    expect(representativeIndex).toBeGreaterThanOrEqual(0);
    const output = buildOutputRows(result.rows)[representativeIndex];
    expect([0, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22].map((index) => String(output[index] ?? ''))).toEqual([
      'INV-01',
      'TC001',
      '202607',
      '2026/07/01',
      '2026/07/31',
      'TEST-MENU-01',
      'テスト用高圧メニュー',
      '季節別料金',
      '1,200',
      '10,000',
      '10,000',
      '2026/07/31',
      '800',
    ]);
  });
});
