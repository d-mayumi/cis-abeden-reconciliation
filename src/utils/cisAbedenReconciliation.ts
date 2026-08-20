export interface CisRow {
  sourceFileName: string;
  sourceRowNumber: number;
  billingMonth: string;
  customerNumber: string;
  customerName: string;
  billingAmount: string | number;
  issueDate: string;
}

export interface AbedenRow {
  sourceFileName?: string;
  sourceRowNumber: number;
  cells: unknown[];
  customerId: string;
  customerName: string;
  targetMonth: string;
  billingAmount: string | number;
}

export type NameJudge = 'exact' | 'normalized' | 'prefix' | 'mismatch' | 'unmatched';

export interface ReconciliationRow {
  key: string;
  matched: boolean;
  abeden: AbedenRow;
  cis?: CisRow;
  nameJudge: NameJudge;
  nameOk: boolean;
  amountExact: boolean;
  amountWithinOneYen: boolean;
  amountDiff: number | null;
  issueDate: string;
}

export interface ReconciliationSummary {
  total: number;
  okCount: number;
  amountMismatchCount: number;
  nameMismatchCount: number;
  abedenOnlyCount: number;
  cisOnlyCount: number;
}

export interface ReconciliationResult {
  rows: ReconciliationRow[];
  cisOnlyRows: CisRow[];
  warnings: string[];
  summary: ReconciliationSummary;
}

export const REQUIRED_CIS_COLUMNS = ['請求年月', '需要者番号', '需要者名', '請求金額', '発行日'] as const;

const OUTPUT_COLUMN_COUNT = 236;

const canonicalKey = (customerId: string, month: string) => `${customerId.trim()}__${month.trim()}`;

export const normalizeCustomerName = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/[\s\u3000\t]+/g, '')
    .toUpperCase();

const parseAmount = (value: string | number | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const normalized = String(value ?? '').replace(/[\s\u3000,円]/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.trunc(amount) : null;
};

const outputText = (value: unknown): string => value === null || value === undefined ? '' : String(value);

const judgeName = (abedenName: string, cisName?: string): NameJudge => {
  if (!cisName) return 'unmatched';
  if (abedenName === cisName) return 'exact';
  const normalizedAbeden = normalizeCustomerName(abedenName);
  const normalizedCis = normalizeCustomerName(cisName);
  if (normalizedAbeden === normalizedCis) return 'normalized';
  if (
    normalizedAbeden.length > 0 &&
    normalizedCis.length > 0 &&
    (normalizedAbeden.endsWith(normalizedCis) || normalizedCis.endsWith(normalizedAbeden))
  ) {
    return 'prefix';
  }
  return 'mismatch';
};

const sameCisValues = (left: CisRow, right: CisRow): boolean =>
  left.billingMonth.trim() === right.billingMonth.trim() &&
  left.customerNumber.trim() === right.customerNumber.trim() &&
  left.customerName.trim() === right.customerName.trim() &&
  String(left.billingAmount).trim() === String(right.billingAmount).trim() &&
  left.issueDate.trim() === right.issueDate.trim();

const indexCisRows = (cisRows: CisRow[], warnings: string[]): Map<string, CisRow> => {
  const byKey = new Map<string, CisRow>();
  for (const row of cisRows) {
    const key = canonicalKey(row.customerNumber, row.billingMonth);
    if (byKey.has(key)) {
      const existing = byKey.get(key)!;
      if (!sameCisValues(existing, row)) {
        throw new Error(`CIS重複キーに異なる値があります: ${key}`);
      }
      warnings.push(`CIS同値重複を1件に統合しました: ${key} (${existing.sourceFileName}, ${row.sourceFileName})`);
      continue;
    }
    byKey.set(key, row);
  }
  return byKey;
};

const buildRow = (abeden: AbedenRow, cis?: CisRow): ReconciliationRow => {
  const key = canonicalKey(abeden.customerId, abeden.targetMonth);
  const nameJudge = judgeName(abeden.customerName, cis?.customerName);
  const abedenAmount = parseAmount(abeden.billingAmount);
  const cisAmount = parseAmount(cis?.billingAmount);
  const amountDiff = abedenAmount === null || cisAmount === null ? null : abedenAmount - cisAmount;
  const matched = Boolean(cis);
  return {
    key,
    matched,
    abeden,
    cis,
    nameJudge,
    nameOk: nameJudge === 'exact' || nameJudge === 'normalized' || nameJudge === 'prefix',
    amountExact: amountDiff === 0,
    amountWithinOneYen: amountDiff !== null && Math.abs(amountDiff) <= 1,
    amountDiff,
    issueDate: cis?.issueDate ?? '',
  };
};

const summarize = (rows: ReconciliationRow[], cisOnlyRows: CisRow[]): ReconciliationSummary => ({
  total: rows.length,
  okCount: rows.filter((row) => row.matched && row.nameOk && row.amountWithinOneYen).length,
  amountMismatchCount: rows.filter((row) => !row.amountWithinOneYen).length,
  nameMismatchCount: rows.filter((row) => !row.nameOk).length,
  abedenOnlyCount: rows.filter((row) => !row.matched).length,
  cisOnlyCount: cisOnlyRows.length,
});

export const mismatchItemLabel = (row: ReconciliationRow): string => {
  if (!row.matched) return 'あべでんのみ';
  const items: string[] = [];
  if (!row.nameOk) items.push('需要家名');
  if (!row.amountWithinOneYen) items.push('請求金額');
  return items.length > 0 ? items.join(' / ') : '-';
};

export const reconcileBillingRows = (cisRows: CisRow[], abedenRows: AbedenRow[]): ReconciliationResult => {
  const warnings: string[] = [];
  const cisByKey = indexCisRows(cisRows, warnings);
  const usedCisKeys = new Set<string>();
  const rows = abedenRows.map((abeden) => {
    const key = canonicalKey(abeden.customerId, abeden.targetMonth);
    const cis = cisByKey.get(key);
    if (cis) usedCisKeys.add(key);
    if (!abeden.customerId.trim() || !abeden.targetMonth.trim()) {
      warnings.push(`あべでん${abeden.sourceRowNumber}行目の突合キーが空欄です`);
    }
    return buildRow(abeden, cis);
  });
  const cisOnlyRows = Array.from(cisByKey.entries())
    .filter(([key]) => !usedCisKeys.has(key))
    .map(([, row]) => row);

  return {
    rows,
    cisOnlyRows,
    warnings,
    summary: summarize(rows, cisOnlyRows),
  };
};

export const buildOutputRows = (rows: ReconciliationRow[]): unknown[][] => rows.map((row) => {
  const cells = row.abeden.cells;
  const output: unknown[] = Array.from({ length: OUTPUT_COLUMN_COUNT }, () => '');
  cells.slice(0, 4).forEach((cell, index) => {
    output[index] = cell;
  });
  output[4] = row.cis?.customerNumber ?? '';
  output[5] = row.abeden.customerId;
  output[6] = '';
  output[7] = row.abeden.customerName || cells[4] || '';
  output[8] = row.cis?.customerName ?? '';
  output[9] = row.nameOk;
  cells.slice(5, 13).forEach((cell, index) => {
    output[10 + index] = cell;
  });
  output[17] = outputText(output[17]);
  output[18] = row.cis?.billingAmount ?? '';
  output[19] = row.amountExact;
  output[20] = row.amountWithinOneYen;
  output[21] = row.issueDate;
  cells.slice(13, 227).forEach((cell, index) => {
    output[22 + index] = cell;
  });
  return output.slice(0, OUTPUT_COLUMN_COUNT);
});

export const outputHeaders = (): [string[], string[]] => {
  const first = Array.from({ length: OUTPUT_COLUMN_COUNT }, () => '');
  const second = Array.from({ length: OUTPUT_COLUMN_COUNT }, () => '');
  first.splice(0, 22,
    '請求先ID', '請求書番号', '契約番号', '需要家ID', 'CIS①～④', 'あべでん', '市役所',
    '需要家名', 'CIS①～④', '需要家名', '料金調停対象年月', '', '', '', '', '', '', '請求金額',
    'CIS①～④', '請求金額', '市場連動', '発行日',
  );
  second.splice(0, 22,
    '', '', '', '', '需用家ID', 'web', '需用家ID', '', '需要家名', '正誤チェック', '', '', '', '', '', '', '', '',
    '請求金額', '正誤チェック', '誤差±1円以内', '',
  );
  for (let index = 22; index < OUTPUT_COLUMN_COUNT; index += 1) {
    first[index] = `あべでん${index - 8}`;
  }
  return [first, second];
};
