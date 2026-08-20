import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { assignOutputRowValues, parseCisFile } from '../cisAbedenFiles';

const xlsxFile = (name: string, rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

describe('CISファイル読込', () => {
  it('パラメータファイルをCIS枠に入れた場合は対象外であることを案内する', async () => {
    const file = xlsxFile('20260722114212_一般社団法人 東松島みらいとし機構パラメータ.xlsx', [
      ['項目', '値'],
      ['基本料金', '1000'],
    ]);

    await expect(parseCisFile(file)).rejects.toThrow('パラメータファイルは今回の突合では取り込み不要です');
  });

  it('マスタファイルをCIS枠に入れた場合も対象外であることを案内する', async () => {
    const file = xlsxFile('20260722114029_一般社団法人 東松島みらいとし機構マスタ.xlsx', [
      ['shinki_f', 'juyosha_no', 'juyosha_mei'],
      ['', 'khope0079', '矢本海浜緑地パークゴルフ場'],
    ]);

    await expect(parseCisFile(file)).rejects.toThrow('マスタファイルは今回の突合では取り込み不要です');
  });
});

describe('突合結果Excel出力', () => {
  it('先頭データをA列から書き込み、右へずらさない', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('事業者契約時');
    const row = sheet.getRow(3);

    assignOutputRowValues(row, ['INV-01', 'BILL-01', 'CON-01', 'TC001']);

    expect(row.getCell(1).value).toBe('INV-01');
    expect(row.getCell(2).value).toBe('BILL-01');
    expect(row.getCell(3).value).toBe('CON-01');
    expect(row.getCell(4).value).toBe('TC001');
    expect(row.getCell(5).value).toBeNull();
  });
});
