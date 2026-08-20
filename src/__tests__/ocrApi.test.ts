import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import handler from '../../api/ocr';

type Target = 'cis-primary' | 'cis-secondary' | 'abeden';
type FetchCall = { url: string; init?: RequestInit };

const SPREADSHEET_ID = '1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20';
const SHEETS: Record<Target, { sheetId: number; title: string }> = {
  'cis-primary': { sheetId: 1215098227, title: "CIS① 取込's" },
  'cis-secondary': { sheetId: 2079880305, title: 'CIS② 取込' },
  abeden: { sheetId: 1678193460, title: 'あべでん 明細' },
};

const DEFAULT_HEADERS: Record<Target, unknown[][]> = {
  'cis-primary': [
    ['CIS① OCR取込'],
    [],
    ['入力用'],
    ['対象年月', '', '', '', '発行日', '', '', '需要者番号', '需要者名', '', '供給地点特定番号', '', '', '', '', '請求金額（税込）'],
  ],
  'cis-secondary': [
    ['CIS② OCR取込'],
    ['請求年月', '', '', '', '発行日', '', '', '需要者番号', '需要者名', '', '供給地点特定番号', '', '', '', '', '請求額'],
  ],
  abeden: [
    ['', '', '', '需要家ID', '需要家名', '料金調停対象年月', '', '', '', '', '', '', '請求金額'],
    ['請求先ID', '請求書番号', '契約番号', '', '', '', '計量開始日', '計量終了日', '高圧料金メニューID', '電気料金メニュー名', '契約電力', '月間電力量全量', '', '消費税相当額'],
  ],
};

const genericParameterHeaders = ({ scope, key1, key2 = '未使用' }: { scope: string; key1: string; key2?: string }) => [
  ['shinki_f', `スコープ\n（${scope}）`, '並び順', key1, key2, 'パラメータセット\nkps101_juryo：従量料金\nkps101_kihon：基本料金', '値1\n適用開始年月日\n適用終了年月日'],
  ['新規:1', 'param_scope', 'seq', 'key1', 'key2', 'param_set_id', 'value1'],
];

const GENERIC_HEADERS: Record<Target, unknown[][]> = {
  'cis-primary': genericParameterHeaders({ scope: '需要者', key1: '需要者番号' }),
  'cis-secondary': genericParameterHeaders({ scope: '契約種別', key1: '契約種別コード' }),
  abeden: genericParameterHeaders({ scope: '需要者・契約種別', key1: '需要者番号', key2: '契約種別コード' }),
};

const quoteTitle = (title: string) => `'${title.replace(/'/g, "''")}'`;

const responseRecorder = () => {
  const recorder = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return { json: (body: unknown) => { this.body = body; } };
    },
  };
  return recorder;
};

const targetFromUrl = (url: string): Target | undefined => {
  const decoded = decodeURIComponent(url);
  return (Object.entries(SHEETS) as Array<[Target, { title: string }]>).find(([, sheet]) => decoded.includes(`${quoteTitle(sheet.title)}!`))?.[0];
};

const createFetchMock = ({
  openAiDocuments = [],
  headers = DEFAULT_HEADERS,
  existingRows = {},
  readRows = {},
  metadataSheets = Object.values(SHEETS),
}: {
  openAiDocuments?: unknown[];
  headers?: Record<Target, unknown[][]>;
  existingRows?: Partial<Record<Target, unknown[][]>>;
  readRows?: Partial<Record<Target, { values: unknown[][]; range: string }>>;
  metadataSheets?: Array<{ sheetId: number; title: string }>;
} = {}) => {
  const calls: FetchCall[] = [];
  let openAiIndex = 0;
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const stringUrl = String(url);
    calls.push({ url: stringUrl, init });
    if (stringUrl.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'google-token' }), { status: 200 });
    if (stringUrl.includes('api.openai.com/v1/responses')) {
      return new Response(JSON.stringify({ output_text: JSON.stringify(openAiDocuments[openAiIndex++]) }), { status: 200 });
    }
    if (stringUrl.includes('?fields=sheets')) {
      return new Response(JSON.stringify({ sheets: metadataSheets.map((sheet) => ({ properties: sheet })) }), { status: 200 });
    }
    if (stringUrl.endsWith('/values:batchUpdate')) return new Response(JSON.stringify({ totalUpdatedRows: 1 }), { status: 200 });

    const target = targetFromUrl(stringUrl);
    if (target && decodeURIComponent(stringUrl).includes('!1:20')) {
      return new Response(JSON.stringify({ values: headers[target] }), { status: 200 });
    }
    if (target && stringUrl.includes('valueRenderOption=FORMULA')) {
      return new Response(JSON.stringify({ values: existingRows[target] ?? [] }), { status: 200 });
    }
    if (target && readRows[target]) return new Response(JSON.stringify(readRows[target]), { status: 200 });
    throw new Error(`Unexpected fetch: ${stringUrl}`);
  }) as unknown as typeof fetch;
  return { calls, fetchMock };
};

const inputFile = (fileName: string) => ({ fileName, mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' });
const inputImage = (fileName: string) => ({ fileName, mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' });

describe('ocr API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'service@example.iam.gserviceaccount.com';
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  });

  it('上部の見出し行と表記揺れから実列を特定し、最初の連続空き行へ対象列だけ書き込む', async () => {
    const { calls, fetchMock } = createFetchMock({
      openAiDocuments: [{
        documentType: 'cis-primary',
        rows: [
          { billingMonth: '2026年06月', customerNumber: 'CIS-000001', customerName: '東松島第一施設', billingAmount: '12,345円', issuedAt: '2026/07/10', fields: [{ column: 'K', header: '供給地点特定番号', value: '0300000000000000000001' }] },
          { billingMonth: '2026年06月', customerNumber: 'CIS-000002', customerName: '東松島第二施設', billingAmount: '22,000円', issuedAt: '2026/07/11', fields: [{ column: 'K', header: '供給地点特定番号', value: '0300000000000000000002' }] },
        ],
      }],
      existingRows: {
        'cis-primary': [
          ['2026年05月', '', '', '', '2026/06/10', '', '', 'OLD-1', '既存施設', '', '0300000000000000000099', '', '', '', '', '1,000円'],
          ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
          ['', '', '', '', '', '', '', 'OLD-2', '', '', '', '', '', '', '', ''],
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { target: 'abeden', files: [inputFile('cis.pdf')] } }, response);

    const openAiCall = calls.find((call) => call.url.includes('api.openai.com/v1/responses'));
    const openAiBody = JSON.parse(String(openAiCall?.init?.body)) as {
      input: Array<{ content: Array<{ type: string; text?: string; filename?: string; file_data?: string; detail?: string }> }>;
    };
    const prompt = openAiBody.input[0].content.find((item) => item.type === 'input_text')?.text ?? '';
    const pdfInput = openAiBody.input[0].content.find((item) => item.type === 'input_file');
    expect(prompt).toContain('参考情報です');
    expect(prompt).toContain('"sheetTitle":"CIS① 取込\'s"');
    expect(prompt).toContain('"column":"H","header":"需要者番号"');
    expect(prompt).toContain('"column":"K","header":"供給地点特定番号"');
    expect(pdfInput).toEqual(expect.objectContaining({
      type: 'input_file',
      filename: 'cis.pdf',
      file_data: 'data:application/pdf;base64,AAAA',
      detail: 'high',
    }));
    expect(openAiCall?.init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer openai-key' }));
    expect(calls.some((call) => call.url.includes(`/spreadsheets/${SPREADSHEET_ID}?fields=sheets`))).toBe(true);

    const updateCall = calls.find((call) => call.url.endsWith('/values:batchUpdate'));
    const updateBody = JSON.parse(String(updateCall?.init?.body)) as { valueInputOption: string; data: Array<{ range: string; values: unknown[][] }> };
    expect(updateBody.valueInputOption).toBe('RAW');
    expect(updateBody.data).toEqual([
      { range: "'CIS① 取込''s'!A8:A9", majorDimension: 'ROWS', values: [[202606], [202606]] },
      { range: "'CIS① 取込''s'!E8:E9", majorDimension: 'ROWS', values: [[46213], [46214]] },
      { range: "'CIS① 取込''s'!H8:H9", majorDimension: 'ROWS', values: [['CIS-000001'], ['CIS-000002']] },
      { range: "'CIS① 取込''s'!I8:I9", majorDimension: 'ROWS', values: [['東松島第一施設'], ['東松島第二施設']] },
      { range: "'CIS① 取込''s'!K8:K9", majorDimension: 'ROWS', values: [['0300000000000000000001'], ['0300000000000000000002']] },
      { range: "'CIS① 取込''s'!P8:P9", majorDimension: 'ROWS', values: [[12345], [22000]] },
    ]);
    expect(updateBody.data.some((entry) => /![BCDFGJLMNO]8:[BCDFGJLMNO]9/.test(entry.range))).toBe(false);
    expect(calls.some((call) => call.url.includes(':append'))).toBe(false);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      requestedTarget: 'abeden',
      target: 'cis-primary',
      targetLabel: 'CIS①',
      updatedRows: 2,
      updatedRange: "'CIS① 取込''s'!A8:P9",
      extractedRows: 2,
      results: [expect.objectContaining({ target: 'cis-primary', fileNames: ['cis.pdf'], updatedRows: 2 })],
    }));
  });

  it('target指定なしの混在ファイルを内容判定し、CIS②とあべでんへ分けて書き込む', async () => {
    const { calls, fetchMock } = createFetchMock({
      openAiDocuments: [
        {
          documentType: 'cis-secondary',
          rows: [{
            billingMonth: '2026年07月', customerNumber: 'C2-1', customerName: 'CIS二番施設', billingAmount: '8,000円', issuedAt: '2026/08/01',
            fields: [{ column: 'H', header: '需要者番号', value: 'C2-1' }],
          }],
        },
        {
          documentType: 'abeden',
          rows: [{
            billingMonth: '2026年07月', customerNumber: 'AB-1', customerName: 'あべでん施設', billingAmount: '9,000円', issuedAt: '2026/08/02',
            fields: [{ column: 'D', header: '需要家ID', value: 'AB-1' }],
          }],
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('cis2.pdf'), inputFile('abeden.pdf')] } }, response);

    const openAiCalls = calls.filter((call) => call.url.includes('api.openai.com/v1/responses'));
    expect(openAiCalls).toHaveLength(2);
    for (const call of openAiCalls) {
      const body = JSON.parse(String(call.init?.body)) as { input: Array<{ content: Array<{ type: string; text?: string }> }> };
      expect(body.input[0].content.find((item) => item.type === 'input_text')?.text).toContain('画面上の対象指定はありません');
    }
    const updates = calls.filter((call) => call.url.endsWith('/values:batchUpdate'));
    expect(updates).toHaveLength(2);
    expect(updates.map((call) => String(call.init?.body)).join('\n')).toContain("'CIS② 取込'!A3:A3");
    expect(updates.map((call) => String(call.init?.body)).join('\n')).toContain("'あべでん 明細'!D3:D3");
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      targetLabel: 'CIS②・あべでん',
      updatedRows: 2,
      extractedRows: 2,
      results: [
        expect.objectContaining({ target: 'cis-secondary', fileNames: ['cis2.pdf'] }),
        expect.objectContaining({ target: 'abeden', fileNames: ['abeden.pdf'] }),
      ],
    }));
    expect((response.body as { target?: unknown }).target).toBeUndefined();
  });

  it('GETでも見出し位置と実列を使って保存済み結果を返す', async () => {
    const dataRange = "'あべでん 明細'!D3:M5";
    const { calls, fetchMock } = createFetchMock({
      readRows: {
        abeden: {
          range: dataRange,
          values: [
            ['ABD-000080', '東松島第一施設', '2026年06月', '', '', '', '', '', '', '121,940円'],
            ['', '', '', '', '', '', '', '', '', ''],
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'GET', query: { target: 'abeden' } }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      target: 'abeden',
      targetLabel: 'あべでん',
      rowCount: 1,
      range: dataRange,
      rows: [{
        billingMonth: '2026年06月',
        customerNumber: 'ABD-000080',
        customerName: '東松島第一施設',
        billingAmount: '121,940円',
        issuedAt: '',
        sourceFileName: '',
      }],
    });
    expect(calls.some((call) => decodeURIComponent(call.url).includes("'あべでん 明細'!D3:M"))).toBe(true);
  });

  it('実シートと同じ二段の汎用見出しを使い、3対象を行3から自動振り分けして非空セルだけ書き込む', async () => {
    const { calls, fetchMock } = createFetchMock({
      headers: GENERIC_HEADERS,
      openAiDocuments: [
        {
          documentType: 'cis-primary',
          rows: [{
            customerNumber: 'CIS-KEY-001',
            fields: [
              { column: 'D', header: '需要者番号 / key1', value: 'CIS-KEY-001' },
              { column: 'F', header: 'パラメータセット / param_set_id', value: '' },
            ],
          }],
        },
        {
          documentType: 'cis-secondary',
          rows: [{
            customerNumber: 'TYPE-001',
            fields: [{ column: 'D', header: '契約種別コード / key1', value: 'TYPE-001' }],
          }],
        },
        {
          documentType: 'abeden',
          rows: [{
            customerNumber: 'AB-CUSTOMER-001',
            fields: [
              { column: 'D', header: '需要者番号 / key1', value: 'AB-CUSTOMER-001' },
              { column: 'E', header: '契約種別コード / key2', value: 'AB-TYPE-001' },
            ],
          }],
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('cis1.pdf'), inputFile('cis2.pdf'), inputFile('abeden.pdf')] } }, response);

    const promptBodies = calls
      .filter((call) => call.url.includes('api.openai.com/v1/responses'))
      .map((call) => String(call.init?.body))
      .join('\n');
    expect(promptBodies).toContain('需要者番号 / key1');
    expect(promptBodies).toContain('契約種別コード / key1');
    expect(promptBodies).toContain('契約種別コード / key2');

    const updateBodies = calls
      .filter((call) => call.url.endsWith('/values:batchUpdate'))
      .map((call) => JSON.parse(String(call.init?.body)) as { data: Array<{ range: string; values: unknown[][] }> });
    expect(updateBodies).toHaveLength(3);
    expect(updateBodies[0].data).toEqual([
      { range: "'CIS① 取込''s'!D3:D3", majorDimension: 'ROWS', values: [['CIS-KEY-001']] },
    ]);
    expect(updateBodies[1].data).toEqual([
      { range: "'CIS② 取込'!D3:D3", majorDimension: 'ROWS', values: [['TYPE-001']] },
    ]);
    expect(updateBodies[2].data).toEqual([
      { range: "'あべでん 明細'!D3:D3", majorDimension: 'ROWS', values: [['AB-CUSTOMER-001']] },
      { range: "'あべでん 明細'!E3:E3", majorDimension: 'ROWS', values: [['AB-TYPE-001']] },
    ]);
    expect(JSON.stringify(updateBodies)).not.toContain('param_set_id');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      targetLabel: 'CIS①・CIS②・あべでん',
      updatedRows: 3,
      results: [
        expect.objectContaining({ target: 'cis-primary', updatedRange: "'CIS① 取込''s'!D3:D3" }),
        expect.objectContaining({ target: 'cis-secondary', updatedRange: "'CIS② 取込'!D3:D3" }),
        expect.objectContaining({ target: 'abeden', updatedRange: "'あべでん 明細'!D3:E3" }),
      ],
    }));
  });

  it('GETは二段見出しの識別子列だけでも行3から安全に読み込む', async () => {
    const dataRange = "'あべでん 明細'!D3:D4";
    const { calls, fetchMock } = createFetchMock({
      headers: GENERIC_HEADERS,
      readRows: {
        abeden: { range: dataRange, values: [['AB-CUSTOMER-001'], []] },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'GET', query: { target: 'abeden' } }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      target: 'abeden',
      targetLabel: 'あべでん',
      rowCount: 1,
      range: dataRange,
      rows: [{
        billingMonth: '',
        customerNumber: 'AB-CUSTOMER-001',
        customerName: '',
        billingAmount: '',
        issuedAt: '',
        sourceFileName: '',
      }],
    });
    expect(calls.some((call) => decodeURIComponent(call.url).includes("'あべでん 明細'!D3:D"))).toBe(true);
  });

  it('画像はResponses APIの画像入力として高精細で送信する', async () => {
    const { calls, fetchMock } = createFetchMock({
      openAiDocuments: [{
        documentType: 'abeden',
        rows: [{
          billingMonth: '2026年08月', customerNumber: 'AB-IMG-1', customerName: '画像施設', billingAmount: '1,500円',
          fields: [{ column: 'D', header: '需要家ID', value: 'AB-IMG-1' }],
        }],
      }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputImage('abeden.png')] } }, response);

    const openAiCall = calls.find((call) => call.url.includes('api.openai.com/v1/responses'));
    const openAiBody = JSON.parse(String(openAiCall?.init?.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string; detail?: string }> }>;
    };
    expect(openAiBody.input[0].content.find((item) => item.type === 'input_image')).toEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,AAAA',
      detail: 'high',
    });
    expect(response.statusCode).toBe(200);
  });

  it('判定先に識別用の見出しがない場合は、空欄を書き込まず停止する', async () => {
    const headers = { ...DEFAULT_HEADERS, 'cis-primary': [[], []] };
    const { calls, fetchMock } = createFetchMock({
      headers,
      openAiDocuments: [{ documentType: 'cis-primary', rows: [{ billingMonth: '2026年06月', customerNumber: 'C1', customerName: '施設', billingAmount: '100円' }] }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('missing-header.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'missing-header.pdf: OCR結果の1行目に実見出しと一致する非空の値がありません' });
    expect(calls.some((call) => call.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('実見出しに一致していても値が空のfieldsしかない行は書き込まない', async () => {
    const { calls, fetchMock } = createFetchMock({
      headers: GENERIC_HEADERS,
      openAiDocuments: [{
        documentType: 'cis-primary',
        rows: [{ fields: [{ column: 'D', header: '需要者番号 / key1', value: '   ' }] }],
      }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('empty-fields.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'empty-fields.pdf: OCR結果の1行目に実見出しと一致する非空の値がありません' });
    expect(calls.some((call) => call.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('既存の請求書形式でもfieldsがない行は推測書き込みをしない', async () => {
    const { calls, fetchMock } = createFetchMock({
      openAiDocuments: [{
        documentType: 'cis-primary',
        rows: [{ billingMonth: '2026年06月', customerNumber: 'CIS-001', customerName: '施設', billingAmount: '100円' }],
      }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('missing-fields.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'missing-fields.pdf: OCR結果の1行目に実見出しと一致する非空の値がありません' });
    expect(calls.some((call) => call.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('列が同じでも二段の実見出しと完全一致しないfieldsは拒否する', async () => {
    const { calls, fetchMock } = createFetchMock({
      headers: GENERIC_HEADERS,
      openAiDocuments: [{
        documentType: 'cis-primary',
        rows: [{ fields: [{ column: 'D', header: '需要者番号', value: 'CIS-KEY-001' }] }],
      }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('partial-header.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'partial-header.pdf: OCR結果に書き込み対象外の列指定があります（D / 需要者番号）' });
    expect(calls.some((call) => call.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('全角括弧や改行由来の空白差は同じ実見出しとして扱う', async () => {
    const { calls, fetchMock } = createFetchMock({
      headers: GENERIC_HEADERS,
      openAiDocuments: [{
        documentType: 'cis-primary',
        rows: [{
          customerNumber: 'CIS-KEY-SPACE-001',
          fields: [
            { column: 'B', header: 'スコープ（需要者） / param_scope', value: '2' },
            { column: 'D', header: '需要者番号 / key1', value: 'CIS-KEY-SPACE-001' },
          ],
        }],
      }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('header-spacing.pdf')] } }, response);

    const updateBody = calls
      .filter((call) => call.url.endsWith('/values:batchUpdate'))
      .map((call) => JSON.parse(String(call.init?.body)) as { data: Array<{ range: string; values: unknown[][] }> })[0];
    expect(updateBody.data).toEqual([
      { range: "'CIS① 取込''s'!B3:B3", majorDimension: 'ROWS', values: [['2']] },
      { range: "'CIS① 取込''s'!D3:D3", majorDimension: 'ROWS', values: [['CIS-KEY-SPACE-001']] },
    ]);
    expect(response.statusCode).toBe(200);
  });

  it('OpenAIが実見出し一覧にない列を返すと書き込まず拒否する', async () => {
    const { calls, fetchMock } = createFetchMock({
      openAiDocuments: [{
        documentType: 'cis-primary',
        rows: [{
          billingMonth: '2026年06月', customerNumber: 'C1', customerName: '施設', billingAmount: '100円',
          fields: [{ column: 'Z', header: '管理者用列', value: '不正値' }],
        }],
      }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('unsafe.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'unsafe.pdf: OCR結果に書き込み対象外の列指定があります（Z / 管理者用列）' });
    expect(calls.some((call) => call.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('帳票種別を判定できないファイルはヒント先へ流さず、書き込み前に停止する', async () => {
    const { calls, fetchMock } = createFetchMock({
      openAiDocuments: [{ documentType: 'unknown', rows: [{ customerName: '判定不能' }] }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { target: 'cis-primary', files: [inputFile('unknown.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'unknown.pdf: 帳票種別をCIS①・CIS②・あべでんのいずれかに特定できませんでした' });
    expect(calls.some((call) => call.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('3つのgidを厳密に確認し、不足タブがあっても先頭タブへフォールバックしない', async () => {
    const metadataSheets = [SHEETS['cis-primary'], SHEETS.abeden, { sheetId: 0, title: '先頭タブ' }];
    const { calls, fetchMock } = createFetchMock({ metadataSheets });
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { files: [inputFile('input.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'gid=2079880305 のOCR書き込み先シートが見つかりません' });
    expect(calls.some((call) => call.url.includes('api.openai.com'))).toBe(false);
    expect(calls.some((call) => call.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('allowlist外のtargetヒントは外部APIを呼ばずに拒否する', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: { target: 'constructor', files: [inputFile('input.pdf')] } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ ok: false, error: 'OCR対象ヒントが不正です' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
