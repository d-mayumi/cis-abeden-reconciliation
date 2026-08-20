import Encoding from 'encoding-japanese';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  AbedenRow,
  buildOutputRows,
  CisRow,
  outputHeaders,
  REQUIRED_CIS_COLUMNS,
  ReconciliationResult,
} from './cisAbedenReconciliation';

const OUTPUT_TEMPLATE_PATH = '/templates/final-output-template.xlsx';
const OUTPUT_TEMPLATE_DATA_START_ROW = 3;
const OUTPUT_TEMPLATE_MAX_ROW = 1000;

export interface ParsedCisFile {
  fileName: string;
  rows: CisRow[];
  warnings: string[];
  months: string[];
}

export interface ParsedAbedenFile {
  fileName: string;
  rows: AbedenRow[];
  warnings: string[];
  months: string[];
}

const cellText = (value: unknown): string => String(value ?? '').trim();

const uniqueSorted = (values: string[]): string[] => [...new Set(values.filter(Boolean))].sort();

export const cisSupportFileKind = (fileName: string): 'マスタ' | 'パラメータ' | null => {
  if (fileName.includes('マスタ')) return 'マスタ';
  if (fileName.includes('パラメータ')) return 'パラメータ';
  return null;
};

export const isCisSupportFile = (fileName: string): boolean => cisSupportFileKind(fileName) !== null;

const assertRequiredColumns = (headers: string[], required: readonly string[], fileName: string) => {
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    const supportFileKind = cisSupportFileKind(fileName);
    if (supportFileKind) {
      throw new Error(`${fileName}: ${supportFileKind}ファイルは今回の突合では取り込み不要です。CIS枠には「料金突合用ファイル」(請求年月・需要者番号・需要者名・請求金額・発行日を含むCSV/xlsx)を入れてください。`);
    }
    throw new Error(`${fileName}: 必須ヘッダーが見つかりません (${missing.join(', ')})`);
  }
};

const decodeCsvBuffer = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const detected = Encoding.detect(bytes) || 'UTF8';
  if (detected === 'UTF8' || detected === 'UNICODE') {
    return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  }
  const unicodeArray = Encoding.convert(bytes, { to: 'UNICODE', from: detected });
  return Encoding.codeToString(unicodeArray).replace(/^\uFEFF/, '');
};

const readWorkbook = async (file: File): Promise<XLSX.WorkBook> => {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
};

export const parseCisFile = async (file: File): Promise<ParsedCisFile> => {
  const lowerName = file.name.toLowerCase();
  let table: unknown[][];
  if (lowerName.endsWith('.csv')) {
    const text = decodeCsvBuffer(await file.arrayBuffer());
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    if (parsed.errors.length > 0) {
      throw new Error(`${file.name}: CSV解析に失敗しました (${parsed.errors[0].message})`);
    }
    table = parsed.data;
  } else if (lowerName.endsWith('.xlsx')) {
    const workbook = await readWorkbook(file);
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    table = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '', raw: false });
  } else {
    throw new Error(`${file.name}: .csv / .xlsx のみ対応しています`);
  }

  const [headerRow, ...dataRows] = table;
  const headers = (headerRow ?? []).map(cellText);
  assertRequiredColumns(headers, REQUIRED_CIS_COLUMNS, file.name);
  const indexOf = (column: string) => headers.indexOf(column);
  const warnings: string[] = [];
  const rows = dataRows
    .map((row, index): CisRow => ({
      sourceFileName: file.name,
      sourceRowNumber: index + 2,
      billingMonth: cellText(row[indexOf('請求年月')]),
      customerNumber: cellText(row[indexOf('需要者番号')]),
      customerName: cellText(row[indexOf('需要者名')]),
      billingAmount: cellText(row[indexOf('請求金額')]),
      issueDate: cellText(row[indexOf('発行日')]),
    }))
    .filter((row) => Object.values(row).some((value) => String(value).trim()));

  rows.forEach((row) => {
    if (!row.customerNumber || !row.billingMonth) {
      warnings.push(`${file.name}:${row.sourceRowNumber}行目 CIS突合キーが空欄です`);
    }
  });

  return {
    fileName: file.name,
    rows,
    warnings,
    months: uniqueSorted(rows.map((row) => row.billingMonth)),
  };
};

export const parseAbedenFile = async (file: File): Promise<ParsedAbedenFile> => {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error(`${file.name}: あべでんファイルは.xlsxのみ対応しています`);
  }
  const workbook = await readWorkbook(file);
  const sheetName = workbook.SheetNames.includes('事業者契約時') ? '事業者契約時' : workbook.SheetNames[0];
  if (sheetName !== '事業者契約時') {
    throw new Error(`${file.name}: 「事業者契約時」シートが見つかりません`);
  }
  const table: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
  const header = table[0] ?? [];
  ['請求先ID', '請求書番号', '契約番号', '需要家ID'].forEach((expected, index) => {
    if (!cellText(header[index]).includes(expected)) {
      throw new Error(`${file.name}: あべでん主要ヘッダーが一致しません (${expected})`);
    }
  });
  const rows = table.slice(2)
    .map((cells, index): AbedenRow => ({
      sourceFileName: file.name,
      sourceRowNumber: index + 3,
      cells: Array.from({ length: 227 }, (_, cellIndex) => cells[cellIndex] ?? ''),
      customerId: cellText(cells[3]),
      customerName: cellText(cells[4]),
      targetMonth: cellText(cells[5]),
      billingAmount: cellText(cells[12]),
    }))
    .filter((row) => row.cells.some((cell) => cellText(cell)));
  const warnings = rows
    .filter((row) => !row.customerId || !row.targetMonth)
    .map((row) => `${file.name}:${row.sourceRowNumber}行目 あべでん突合キーが空欄です`);

  return {
    fileName: file.name,
    rows,
    warnings,
    months: uniqueSorted(rows.map((row) => row.targetMonth)),
  };
};

const applyResultFill = (cell: ExcelJS.Cell, ok: boolean) => {
  if (ok) return;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD7D7' } };
};

const clearTemplateDataRows = (sheet: ExcelJS.Worksheet, maxColumn: number) => {
  for (let rowNumber = OUTPUT_TEMPLATE_DATA_START_ROW; rowNumber <= OUTPUT_TEMPLATE_MAX_ROW; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let columnNumber = 1; columnNumber <= maxColumn; columnNumber += 1) {
      row.getCell(columnNumber).value = '';
    }
  }
};

const loadOutputWorkbook = async (): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook();
  const response = await fetch(OUTPUT_TEMPLATE_PATH);
  if (!response.ok) {
    throw new Error(`最終出力テンプレートを読み込めませんでした (${response.status})`);
  }
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook;
};

export const assignOutputRowValues = (excelRow: ExcelJS.Row, values: unknown[]) => {
  excelRow.values = values.map((value) => value as ExcelJS.CellValue);
};

export const downloadReconciliationWorkbook = async (result: ReconciliationResult, targetMonth: string) => {
  const workbook = await loadOutputWorkbook();
  const sheet = workbook.getWorksheet('事業者契約時') ?? workbook.addWorksheet('事業者契約時');
  const electricSheet = workbook.getWorksheet('電力会社契約時');
  if (sheet.rowCount < 2) {
    const [header1, header2] = outputHeaders();
    sheet.addRow(header1);
    sheet.addRow(header2);
  }
  clearTemplateDataRows(sheet, 236);
  if (electricSheet) clearTemplateDataRows(electricSheet, 227);
  const outputRows = buildOutputRows(result.rows);
  outputRows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(OUTPUT_TEMPLATE_DATA_START_ROW + rowIndex);
    assignOutputRowValues(excelRow, row);
    const resultRow = result.rows[rowIndex];
    applyResultFill(excelRow.getCell(10), resultRow.nameOk);
    applyResultFill(excelRow.getCell(20), resultRow.amountExact);
    applyResultFill(excelRow.getCell(21), resultRow.amountWithinOneYen);
    if (!resultRow.matched) {
      [5, 9, 19, 22].forEach((index) => applyResultFill(excelRow.getCell(index), false));
    }
    excelRow.commit();
  });
  const summaryRow = sheet.getRow(OUTPUT_TEMPLATE_DATA_START_ROW + outputRows.length + 1);
  summaryRow.getCell(1).value = '合計⇒';
  summaryRow.getCell(2).value = result.summary.total;
  summaryRow.getCell(3).value = '一致件数(U=TRUE)';
  summaryRow.getCell(4).value = result.summary.okCount;
  sheet.views = [{ state: 'frozen', ySplit: 2 }];

  const cisOnlySheet = workbook.addWorksheet('アンマッチ(CISのみ)');
  cisOnlySheet.addRow(['請求年月', '需要者番号', '需要者名', '請求金額', '発行日', '元ファイル', '行番号']);
  result.cisOnlyRows.forEach((row) => {
    cisOnlySheet.addRow([row.billingMonth, row.customerNumber, row.customerName, row.billingAmount, row.issueDate, row.sourceFileName, row.sourceRowNumber]);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `【CIS、あべでん突合ファイル】料金計算_${targetMonth || 'YYYYMM'}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
};
