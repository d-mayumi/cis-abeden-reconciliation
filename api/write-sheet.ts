import { createSign } from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TARGET_SPREADSHEET_ID = '1AHwU-UA3llo9ex52-obkbROLqrWq514nekXMtdkDl3g';
const TARGET_SHEET_GID = 54789944;
const googleAuthorizationHeader = (accessToken: string) => ['Be', 'arer ', accessToken].join('');

type VercelResponse = { status: (code: number) => { json: (body: unknown) => void } };

interface SheetsWritePayload {
  spreadsheetId: string;
  sheetGid: number;
  values: unknown[][];
  format?: {
    headerRowCount: number;
    columnCount: number;
    rowFormats: Array<{ rowIndex: number; okColumns: number[]; ngColumns: number[] }>;
  };
}

const json = (response: VercelResponse, status: number, body: unknown) => {
  response.status(status).json(body);
};

const normalizePrivateKey = (privateKey: string) => privateKey.replace(/\\n/g, '\n');

const base64Url = (value: string) => Buffer.from(value).toString('base64url');

const buildGoogleJwtAssertion = ({ clientEmail, privateKey }: { clientEmail: string; privateKey: string }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, 'base64url')}`;
};

const getGoogleAccessToken = async ({ clientEmail, privateKey }: { clientEmail: string; privateKey: string }) => {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: buildGoogleJwtAssertion({ clientEmail, privateKey: normalizePrivateKey(privateKey) }),
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !token.access_token) {
    throw new Error(token.error_description || token.error || 'Googleアクセストークンの取得に失敗しました');
  }
  return token.access_token;
};

const parsePayload = (body: unknown): SheetsWritePayload => {
  if (!body || typeof body !== 'object') {
    throw new Error('書き込みデータが不正です');
  }
  const payload = body as Partial<SheetsWritePayload>;
  if (payload.spreadsheetId !== TARGET_SPREADSHEET_ID || payload.sheetGid !== TARGET_SHEET_GID || !Array.isArray(payload.values) || payload.values.length === 0) {
    throw new Error('書き込み先または書き込みデータが不正です');
  }
  return payload as SheetsWritePayload;
};

const color = (red: number, green: number, blue: number) => ({ red, green, blue });

const repeatCellRequest = ({
  sheetId,
  startRowIndex,
  endRowIndex,
  startColumnIndex,
  endColumnIndex,
  cell,
  fields,
}: {
  sheetId: number;
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
  cell: unknown;
  fields: string;
}) => ({
  repeatCell: {
    range: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex },
    cell,
    fields,
  },
});

const buildFinalOutputPreviewFormatRequests = ({
  sheetGid,
  dataStartRowIndex,
  dataEndRowIndex,
  columnCount,
  headerRowCount,
  rowFormats,
}: {
  sheetGid: number;
  dataStartRowIndex: number;
  dataEndRowIndex: number;
  columnCount: number;
  headerRowCount: number;
  rowFormats: Array<{ rowIndex: number; okColumns: number[]; ngColumns: number[] }>;
}) => {
  const requests: unknown[] = [
    { updateSheetProperties: { properties: { sheetId: sheetGid, gridProperties: { frozenRowCount: headerRowCount } }, fields: 'gridProperties.frozenRowCount' } },
    repeatCellRequest({
      sheetId: sheetGid,
      startRowIndex: 0,
      endRowIndex: headerRowCount,
      startColumnIndex: 0,
      endColumnIndex: columnCount,
      cell: { userEnteredFormat: { backgroundColor: color(0.917, 0.965, 0.984), textFormat: { bold: true }, horizontalAlignment: 'LEFT' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    }),
    repeatCellRequest({
      sheetId: sheetGid,
      startRowIndex: dataStartRowIndex,
      endRowIndex: dataEndRowIndex,
      startColumnIndex: 0,
      endColumnIndex: columnCount,
      cell: { userEnteredFormat: { backgroundColor: color(1, 1, 1) } },
      fields: 'userEnteredFormat.backgroundColor',
    }),
    { autoResizeDimensions: { dimensions: { sheetId: sheetGid, dimension: 'COLUMNS', startIndex: 0, endIndex: Math.min(columnCount, 22) } } },
  ];

  for (const rowFormat of rowFormats) {
    for (const columnIndex of rowFormat.okColumns) {
      requests.push(repeatCellRequest({
        sheetId: sheetGid,
        startRowIndex: rowFormat.rowIndex,
        endRowIndex: rowFormat.rowIndex + 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
        cell: { userEnteredFormat: { backgroundColor: color(0.925, 0.984, 0.961), textFormat: { bold: true, foregroundColor: color(0.016, 0.471, 0.341) } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      }));
    }
    for (const columnIndex of rowFormat.ngColumns) {
      requests.push(repeatCellRequest({
        sheetId: sheetGid,
        startRowIndex: rowFormat.rowIndex,
        endRowIndex: rowFormat.rowIndex + 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
        cell: { userEnteredFormat: { backgroundColor: color(1, 0.843, 0.843), textFormat: { bold: true, foregroundColor: color(0.706, 0.137, 0.094) } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      }));
    }
  }

  return requests;
};

const isBlankSheetRow = (row: unknown[] | undefined) => (row ?? []).every((value) => String(value ?? '').trim() === '');

export const findFirstEmptyBlockRow = (usedRows: unknown[][], requiredRows: number, startRowNumber = 3) => {
  if (requiredRows <= 0) return startRowNumber;
  const finalCandidate = Math.max(startRowNumber, usedRows.length + 1);
  for (let rowNumber = startRowNumber; rowNumber <= finalCandidate; rowNumber += 1) {
    const blockIsBlank = Array.from({ length: requiredRows }, (_, offset) => usedRows[rowNumber - 1 + offset])
      .every(isBlankSheetRow);
    if (blockIsBlank) return rowNumber;
  }
  return finalCandidate;
};

const getSheetTitle = async ({ accessToken, spreadsheetId, sheetGid }: { accessToken: string; spreadsheetId: string; sheetGid: number }) => {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`, {
    headers: { Authorization: googleAuthorizationHeader(accessToken) },
  });
  const metadata = await response.json() as { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(metadata.error?.message || 'Googleスプレッドシート情報の取得に失敗しました');
  }
  const sheetTitle = metadata.sheets?.find((sheet) => sheet.properties?.sheetId === sheetGid)?.properties?.title;
  if (!sheetTitle) {
    throw new Error(`gid=${sheetGid} のシートが見つかりません`);
  }
  return sheetTitle;
};

const writeValuesToGoogleSheet = async ({ accessToken, spreadsheetId, sheetGid, values, format }: SheetsWritePayload & { accessToken: string }) => {
  const sheetTitle = await getSheetTitle({ accessToken, spreadsheetId, sheetGid });
  const usedRowsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheetTitle}!A:IV`)}`, {
    headers: { Authorization: googleAuthorizationHeader(accessToken) },
  });
  const usedRows = await usedRowsResponse.json() as { values?: unknown[][]; error?: { message?: string } };
  if (!usedRowsResponse.ok) {
    throw new Error(usedRows.error?.message || 'Googleスプレッドシートの既存行確認に失敗しました');
  }
  const nextRowNumber = findFirstEmptyBlockRow(usedRows.values ?? [], values.length, 3);
  const range = `${sheetTitle}!A${nextRowNumber}`;
  const updateResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: {
      Authorization: googleAuthorizationHeader(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  const updateResult = await updateResponse.json() as { updatedRange?: string; updatedRows?: number; error?: { message?: string } };
  if (!updateResponse.ok) {
    throw new Error(updateResult.error?.message || 'Googleスプレッドシートへの書き込みに失敗しました');
  }

  if (format) {
    const formatResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: googleAuthorizationHeader(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: buildFinalOutputPreviewFormatRequests({ sheetGid, dataStartRowIndex: nextRowNumber - 1, dataEndRowIndex: nextRowNumber - 1 + values.length, columnCount: format.columnCount, headerRowCount: format.headerRowCount, rowFormats: format.rowFormats.map((rowFormat) => ({ ...rowFormat, rowIndex: nextRowNumber - 1 + rowFormat.rowIndex })) }) }),
    });
    const formatResult = await formatResponse.json() as { error?: { message?: string } };
    if (!formatResponse.ok) {
      throw new Error(formatResult.error?.message || 'Googleスプレッドシートの書式設定に失敗しました');
    }
  }

  return updateResult;
};

export default async function handler(request: { method?: string; body?: unknown }, response: VercelResponse) {
  if (request.method !== 'POST') {
    json(response, 405, { ok: false, error: 'POSTのみ対応しています' });
    return;
  }

  try {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    if (!clientEmail || !privateKey) {
      throw new Error('Google Sheets API認証情報がVercel環境変数に設定されていません');
    }

    const payload = parsePayload(request.body);
    const accessToken = await getGoogleAccessToken({ clientEmail, privateKey });
    const result = await writeValuesToGoogleSheet({ ...payload, accessToken });

    json(response, 200, { ok: true, updatedRange: result.updatedRange, updatedRows: result.updatedRows });
  } catch (error) {
    json(response, 500, { ok: false, error: error instanceof Error ? error.message : 'Googleスプレッドシートへの書き込みに失敗しました' });
  }
}
