import { createSign } from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const googleAuthorizationHeader = (accessToken: string) => ['Be', 'arer ', accessToken].join('');

export const normalizePrivateKey = (privateKey: string) => privateKey.replace(/\\n/g, '\n');

const base64Url = (value: string) => Buffer.from(value).toString('base64url');

export interface GoogleJwtOptions {
  clientEmail: string;
  privateKey: string;
  nowSeconds?: number;
  sign?: (input: string, privateKey: string) => string;
}

const signRs256 = (input: string, privateKey: string) => {
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return signer.sign(privateKey, 'base64url');
};

export const buildGoogleJwtAssertion = ({
  clientEmail,
  privateKey,
  nowSeconds = Math.floor(Date.now() / 1000),
  sign = signRs256,
}: GoogleJwtOptions) => {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  return `${unsigned}.${sign(unsigned, privateKey)}`;
};

export const getGoogleAccessToken = async ({
  clientEmail,
  privateKey,
  fetchImpl = fetch,
}: {
  clientEmail: string;
  privateKey: string;
  fetchImpl?: typeof fetch;
}) => {
  const assertion = buildGoogleJwtAssertion({
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  });
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || 'Googleアクセストークンの取得に失敗しました');
  }
  return json.access_token;
};

export const writeValuesToGoogleSheet = async ({
  accessToken,
  spreadsheetId,
  sheetGid,
  values,
  format,
  fetchImpl = fetch,
}: {
  accessToken: string;
  spreadsheetId: string;
  sheetGid: number;
  values: unknown[][];
  format?: {
    headerRowCount: number;
    columnCount: number;
    rowFormats: Array<{ rowIndex: number; okColumns: number[]; ngColumns: number[] }>;
  };
  fetchImpl?: typeof fetch;
}) => {
  const metadataResponse = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`, {
    headers: { Authorization: googleAuthorizationHeader(accessToken) },
  });
  const metadata = await metadataResponse.json() as { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>; error?: { message?: string } };
  if (!metadataResponse.ok) {
    throw new Error(metadata.error?.message || 'Googleスプレッドシート情報の取得に失敗しました');
  }
  const targetSheet = metadata.sheets?.find((sheet) => sheet.properties?.sheetId === sheetGid);
  const sheetTitle = targetSheet?.properties?.title;
  if (!sheetTitle) {
    throw new Error(`gid=${sheetGid} のシートが見つかりません`);
  }

  const usedRowsResponse = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheetTitle}!A:IV`)}`, {
    headers: { Authorization: googleAuthorizationHeader(accessToken) },
  });
  const usedRows = await usedRowsResponse.json() as { values?: unknown[][]; error?: { message?: string } };
  if (!usedRowsResponse.ok) {
    throw new Error(usedRows.error?.message || 'Googleスプレッドシートの既存行確認に失敗しました');
  }
  const nextRowNumber = Math.max(3, (usedRows.values?.length ?? 0) + 1);
  const range = `${sheetTitle}!A${nextRowNumber}`;
  const updateResponse = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
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
    await applyFinalOutputPreviewFormat({
      accessToken,
      spreadsheetId,
      sheetGid,
      rowCount: nextRowNumber + values.length - 1,
      columnCount: format.columnCount,
      headerRowCount: format.headerRowCount,
      rowFormats: format.rowFormats.map((rowFormat) => ({ ...rowFormat, rowIndex: nextRowNumber - 1 + rowFormat.rowIndex })),
      fetchImpl,
    });
  }

  return updateResult;
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

export const buildFinalOutputPreviewFormatRequests = ({
  sheetGid,
  rowCount,
  columnCount,
  headerRowCount,
  rowFormats,
}: {
  sheetGid: number;
  rowCount: number;
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
      startRowIndex: headerRowCount,
      endRowIndex: rowCount,
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

const applyFinalOutputPreviewFormat = async ({
  accessToken,
  spreadsheetId,
  sheetGid,
  rowCount,
  columnCount,
  headerRowCount,
  rowFormats,
  fetchImpl,
}: {
  accessToken: string;
  spreadsheetId: string;
  sheetGid: number;
  rowCount: number;
  columnCount: number;
  headerRowCount: number;
  rowFormats: Array<{ rowIndex: number; okColumns: number[]; ngColumns: number[] }>;
  fetchImpl: typeof fetch;
}) => {
  const response = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: googleAuthorizationHeader(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: buildFinalOutputPreviewFormatRequests({ sheetGid, rowCount, columnCount, headerRowCount, rowFormats }) }),
  });
  const json = await response.json() as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(json.error?.message || 'Googleスプレッドシートの書式設定に失敗しました');
  }
};
