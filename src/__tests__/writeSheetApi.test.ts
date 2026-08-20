import { describe, expect, it } from 'vitest';
import { findFirstEmptyBlockRow } from '../../api/write-sheet';

describe('突合結果のGoogle Sheets書き込み位置', () => {
  it('下側の注記や合計欄ではなく、既存データ直後の連続した空き行を使う', () => {
    const usedRows: unknown[][] = [
      ['見出し1'],
      ['見出し2'],
      ['既存データ'],
      ...Array.from({ length: 22 }, () => []),
      ['', '', '', '注記'],
      [],
      [],
      ['', '', '', '合計'],
    ];

    expect(findFirstEmptyBlockRow(usedRows, 11, 3)).toBe(4);
  });

  it('必要な連続空き行がなければ末尾を使う', () => {
    const usedRows: unknown[][] = [
      ['見出し1'],
      ['見出し2'],
      ['既存1'],
      ['既存2'],
    ];

    expect(findFirstEmptyBlockRow(usedRows, 2, 3)).toBe(5);
  });
});
