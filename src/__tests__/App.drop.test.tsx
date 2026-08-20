import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { parseAbedenFile, parseCisFile } from '../utils/cisAbedenFiles';

vi.mock('../utils/cisAbedenFiles', async () => {
  const actual = await vi.importActual<typeof import('../utils/cisAbedenFiles')>('../utils/cisAbedenFiles');
  return {
    ...actual,
    parseCisFile: vi.fn(async (file: File) => ({
      fileName: file.name,
      rows: [],
      warnings: [],
      months: [],
    })),
    parseAbedenFile: vi.fn(async (file: File) => ({
      fileName: file.name,
      rows: [],
      warnings: [],
      months: [],
    })),
  };
});

const dataTransfer = (files: File[]) => ({
  files,
  items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
  types: ['Files'],
});

const selectWorkMode = (name: '突合' | 'OCR') => fireEvent.click(screen.getByRole('radio', { name }));
const selectOcrSpreadsheet = (name: 'CIS①' | 'CIS②' | 'あべでん') => fireEvent.click(screen.getByRole('radio', { name }));

describe('ファイルドロップ投入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, updatedRows: 3 }), { status: 200 })));
  });

  it('左サイドバーを表示せず、メイン作業エリアだけを表示する', () => {
    render(<App />);

    expect(screen.queryByRole('complementary', { name: '左サイドバー' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'サイドバータブ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'サイドバー突合一覧' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'メイン作業エリア' })).toBeInTheDocument();
    expect(screen.queryByText('請求データはブラウザ内だけで処理します。サーバーやDBへ保存しません。')).not.toBeInTheDocument();
  });

  it('上部バーのタブも日本語で表示し、使い方を上部から確認できる', () => {
    render(<App />);

    const topTabs = screen.getByRole('tablist', { name: '上部バータブ' });
    const tabLabels = Array.from(topTabs.querySelectorAll('button[role=\"tab\"], a')).map((element) => element.textContent);
    expect(tabLabels).toEqual(['①使い方', '②ファイル投入', '③結果', '④スプレッドシート', '⑤ログ']);
    const usageTab = within(topTabs).getByRole('tab', { name: '①使い方' });
    expect(usageTab).toBeInTheDocument();
    expect(screen.queryByText(/transcript/i)).not.toBeInTheDocument();

    fireEvent.click(usageTab);

    expect(usageTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: '上部使い方' })).toBeInTheDocument();
    const reconciliationSteps = screen.getByRole('list', { name: '突合の操作手順' });
    expect(within(reconciliationSteps).getAllByRole('listitem')).toHaveLength(5);
    expect(within(reconciliationSteps).getByRole('heading', { name: '2種類のファイルを入れる' })).toBeInTheDocument();
    expect(within(reconciliationSteps).getByRole('heading', { name: '保存・履歴を確認' })).toBeInTheDocument();

    selectWorkMode('OCR');
    const ocrSteps = screen.getByRole('list', { name: 'OCRの操作手順' });
    expect(within(ocrSteps).getAllByRole('listitem')).toHaveLength(5);
    expect(within(ocrSteps).getByRole('heading', { name: '保存先を自動判定' })).toBeInTheDocument();
    expect(screen.getByText('PDFや画像をまとめて入れると、資料の内容から保存先を自動で判定します。')).toBeInTheDocument();
  });

  it('上部バーから書き込み先スプレッドシートを別タブで開ける', () => {
    render(<App />);

    const topTabs = screen.getByRole('tablist', { name: '上部バータブ' });
    const sheetsTab = within(topTabs).getByRole('link', { name: '④スプレッドシート' });
    expect(sheetsTab).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1AHwU-UA3llo9ex52-obkbROLqrWq514nekXMtdkDl3g/edit?gid=54789944#gid=54789944');
    expect(sheetsTab).toHaveAttribute('target', '_blank');
  });

  it('右端上部でOCR結果の表示先を切り替え、ファイルは共通欄へ投入できる', () => {
    render(<App />);

    const reconciliationRadio = screen.getByRole('radio', { name: '突合' });
    const ocrRadio = screen.getByRole('radio', { name: 'OCR' });
    expect(reconciliationRadio).toBeChecked();
    expect(ocrRadio).not.toBeChecked();
    expect(within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '①使い方' })).toBeInTheDocument();
    expect(screen.getByText('料金突合用CSV/xlsxをここへドロップします。')).toBeInTheDocument();
    expect(screen.getByText('あべでん料金計算xlsxをここへドロップします。')).toBeInTheDocument();

    selectWorkMode('OCR');

    expect(reconciliationRadio).not.toBeChecked();
    expect(ocrRadio).toBeChecked();
    expect(screen.getByRole('heading', { name: 'OCR' })).toBeInTheDocument();
    expect(within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '⑤ログ' })).toBeInTheDocument();
    const ocrSpreadsheetLabel = screen.getByText('結果の表示先');
    const modelSwitcherLabel = screen.getByText('モデル切り替え');
    expect(ocrSpreadsheetLabel.compareDocumentPosition(modelSwitcherLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ocrSheetsTab = within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('link', { name: '④スプレッドシート' });
    expect(ocrSheetsTab).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20/edit?gid=1215098227#gid=1215098227');
    expect(screen.getByRole('radio', { name: 'CIS①' })).toBeChecked();
    selectOcrSpreadsheet('CIS②');
    expect(screen.getByRole('radio', { name: 'CIS②' })).toBeChecked();
    expect(ocrSheetsTab).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20/edit?gid=2079880305#gid=2079880305');
    selectOcrSpreadsheet('あべでん');
    expect(screen.getByRole('radio', { name: 'あべでん' })).toBeChecked();
    expect(ocrSheetsTab).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20/edit?gid=1678193460#gid=1678193460');
    expect(screen.queryByRole('link', { name: 'CIS①スプレッドシート' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'CIS②スプレッドシート' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'あべでんスプレッドシート' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'OCRファイルアップロード' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PDF・画像をまとめて投入' })).toBeInTheDocument();
    expect(screen.getByText('資料を読み取り、保存先を自動判定します。')).toBeInTheDocument();
    expect(screen.getByLabelText('OCRファイルを選択')).toHaveAttribute(
      'accept',
      '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp',
    );
  });

  it('OCRファイルをドラッグせずファイル選択から投入できる', () => {
    render(<App />);
    selectWorkMode('OCR');
    const file = new File(['pdf'], '08_abeden_OCR_clean.pdf', { type: 'application/pdf' });

    fireEvent.change(screen.getByLabelText('OCRファイルを選択'), { target: { files: [file] } });

    expect(screen.getByText('08_abeden_OCR_clean.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('main-upload-dropzone-ocr')).toHaveTextContent('1ファイル');
  });


  it('右側メイン作業エリアの空白部にCIS用とあべでん用の投入エリアを分けて表示する', async () => {
    render(<App />);
    const cisMainDropzone = screen.getByTestId('main-upload-dropzone-cis');
    const abedenMainDropzone = screen.getByTestId('main-upload-dropzone-abeden');
    const cisFile = new File(['請求年月,需要者番号,需要者名,請求金額,発行日\n'], 'CISデータ 料金突合用ファイル.csv', { type: 'text/csv' });
    const abedenFile = new File(['xlsx'], 'あべでん料金計算.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    expect(within(cisMainDropzone).queryByRole('heading', { name: '①CISデータのみの評価' })).not.toBeInTheDocument();
    expect(within(abedenMainDropzone).queryByRole('heading', { name: '②あべでんのみ' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '空白部ファイルアップロード' })).getByRole('button', { name: '突合実行' })).toBeInTheDocument();

    fireEvent.dragEnter(cisMainDropzone, { dataTransfer: dataTransfer([cisFile]) });
    expect(cisMainDropzone).toHaveClass('mainUploadDropzoneActive');
    fireEvent.drop(cisMainDropzone, { dataTransfer: dataTransfer([cisFile]) });

    fireEvent.dragEnter(abedenMainDropzone, { dataTransfer: dataTransfer([abedenFile]) });
    expect(abedenMainDropzone).toHaveClass('mainUploadDropzoneActive');
    fireEvent.drop(abedenMainDropzone, { dataTransfer: dataTransfer([abedenFile]) });

    await waitFor(() => expect(parseCisFile).toHaveBeenCalledWith(cisFile));
    await waitFor(() => expect(parseAbedenFile).toHaveBeenCalledWith(abedenFile));
    expect(screen.getByText('CISデータ 料金突合用ファイル.csv')).toBeInTheDocument();
    expect(screen.getByText('あべでん料金計算.xlsx')).toBeInTheDocument();
  });

  it('CIS枠へドラッグ中の表示を出し、ドロップしたファイルを読み込む', async () => {
    render(<App />);
    const cisDropzone = screen.getByTestId('main-upload-dropzone-cis');
    const file = new File(['請求年月,需要者番号,需要者名,請求金額,発行日\n'], 'cis.csv', { type: 'text/csv' });

    fireEvent.dragEnter(cisDropzone, { dataTransfer: dataTransfer([file]) });
    expect(cisDropzone).toHaveClass('mainUploadDropzoneActive');
    fireEvent.drop(cisDropzone, { dataTransfer: dataTransfer([file]) });

    await waitFor(() => expect(vi.mocked(parseCisFile).mock.calls[0]?.[0]).toBe(file));
    expect(cisDropzone).not.toHaveClass('mainUploadDropzoneActive');
  });

  it('あべでん枠にもドロップでファイルを投入できる', async () => {
    render(<App />);
    const abedenDropzone = screen.getByTestId('main-upload-dropzone-abeden');
    const file = new File(['xlsx'], 'abeden.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    fireEvent.drop(abedenDropzone, { dataTransfer: dataTransfer([file]) });

    await waitFor(() => expect(parseAbedenFile).toHaveBeenCalledWith(file));
  });

  it('OCRモードでは投入ファイルだけをOCR APIへ送り、資料から判定されたスプレッドシートへ書き込む', async () => {
    const rows = [
      { billingMonth: '2026年06月', customerNumber: 'ABD-000080', customerName: '東松島第一施設', billingAmount: '121,940円', issuedAt: '2026/07/10', sourceFileName: 'abeden-ocr.pdf' },
      { billingMonth: '2026年06月', customerNumber: 'ABD-000081', customerName: '矢本中央センター', billingAmount: '123,310円', issuedAt: '2026/07/11', sourceFileName: 'abeden-ocr.pdf' },
    ];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          target: 'abeden',
          targetLabel: 'あべでん',
          fileNames: ['abeden-ocr.pdf'],
          executedAt: '2026-08-17T05:00:00.000Z',
          updatedRows: 2,
          updatedRange: "'事業者契約時'!A4:F5",
          extractedRows: 2,
          rows,
          results: [{
            target: 'abeden',
            targetLabel: 'あべでん',
            fileNames: ['abeden-ocr.pdf'],
            updatedRows: 2,
            updatedRange: "'事業者契約時'!A4:F5",
            extractedRows: 2,
            rows,
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, range: "'事業者契約時'!A3:F5", rows }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    selectWorkMode('OCR');
    selectOcrSpreadsheet('あべでん');
    const abedenDropzone = screen.getByTestId('main-upload-dropzone-ocr');
    const file = new File(['rough-pdf'], 'abeden-ocr.pdf', { type: 'application/pdf' });

    fireEvent.drop(abedenDropzone, { dataTransfer: dataTransfer([file]) });
    await waitFor(() => expect(screen.getByText('abeden-ocr.pdf')).toBeInTheDocument());
    expect(parseAbedenFile).not.toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole('button', { name: 'OCR実行' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ocr', expect.objectContaining({ method: 'POST' })));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty('target');
    expect(body.files[0]).toEqual(expect.objectContaining({ fileName: 'abeden-ocr.pdf', mimeType: 'application/pdf' }));
    expect(String(body.files[0].dataUrl)).toMatch(/^data:application\/pdf;base64,/);
    expect(screen.getByText('保存先をあべでんと自動判定し、OCRで2行を書き込み済みです')).toBeInTheDocument();
    expect(within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '③結果' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'OCR結果エリア' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'OCR結果一覧' })).toBeInTheDocument();
    expect(screen.getByText('ABD-000080')).toBeInTheDocument();
    expect(screen.getByText('121,940円')).toBeInTheDocument();
    expect(screen.getAllByText('abeden-ocr.pdf').length).toBeGreaterThan(0);

    fireEvent.click(within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '⑤ログ' }));
    expect(screen.getByRole('region', { name: 'OCRログエリア' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'OCR実行ログ' })).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('region', { name: 'スプレッドシート取込ログ' })).toHaveTextContent('abeden-ocr.pdf'));
  });

  it('OCR未実行でも結果とログを空白にせず案内を表示する', async () => {
    render(<App />);
    selectWorkMode('OCR');
    const topTabs = screen.getByRole('tablist', { name: '上部バータブ' });

    fireEvent.click(within(topTabs).getByRole('tab', { name: '③結果' }));
    expect(screen.getByRole('region', { name: 'OCR結果エリア' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('OCR実行後、抽出した明細をここに表示します。')).toBeInTheDocument());

    fireEvent.click(within(topTabs).getByRole('tab', { name: '⑤ログ' }));
    expect(screen.getByRole('region', { name: 'OCRログエリア' })).toBeInTheDocument();
    expect(screen.getByText('この画面でのOCR実行履歴はまだありません。')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('スプレッドシートに保存されたOCR取込履歴はありません。')).toBeInTheDocument());
  });

  it('OCRモードで同じPDFを二重投入せず、処理中は出力先とモードを固定する', async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    const postResponse = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') return postResponse;
      return new Response(JSON.stringify({ ok: true, range: "'需要者'!A3:F", rows: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    selectWorkMode('OCR');
    const file = new File(['same-pdf'], 'same.pdf', { type: 'application/pdf', lastModified: 123 });
    const dropzone = screen.getByTestId('main-upload-dropzone-ocr');

    fireEvent.drop(dropzone, { dataTransfer: dataTransfer([file]) });
    fireEvent.drop(dropzone, { dataTransfer: dataTransfer([file]) });
    expect(screen.getAllByText('same.pdf')).toHaveLength(1);
    expect(screen.getByText('1ファイル')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'OCR実行' }));
    expect(screen.getByRole('radio', { name: 'CIS①' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'OCR' })).toBeDisabled();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body)).files).toHaveLength(1);

    resolvePost?.(new Response(JSON.stringify({
      ok: true,
      target: 'cis-primary',
      targetLabel: 'CIS①',
      fileNames: ['same.pdf'],
      executedAt: '2026-08-17T05:00:00.000Z',
      updatedRows: 1,
      updatedRange: "'需要者'!A3:F3",
      extractedRows: 1,
      rows: [{ billingMonth: '2026年06月', customerNumber: 'CIS-1', customerName: '需要者', billingAmount: '100円', issuedAt: '2026/07/10', sourceFileName: 'same.pdf' }],
    }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'CIS①' })).not.toBeDisabled());
    expect(screen.getByRole('radio', { name: 'OCR' })).not.toBeDisabled();
  });

  it('結果の表示先はOCR保存先として送らず、APIの自動判定先へ表示を切り替える', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => new Response(JSON.stringify(init?.method === 'POST'
      ? { ok: true, target: 'cis-secondary', targetLabel: 'CIS②', fileNames: ['cis-secondary.pdf'], executedAt: '2026-08-17T05:00:00.000Z', updatedRows: 1, updatedRange: "'需要者'!A3:F3", extractedRows: 1, rows: [] }
      : { ok: true, range: "'需要者'!A3:F", rows: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    selectWorkMode('OCR');
    selectOcrSpreadsheet('あべでん');
    const file = new File(['cis-pdf'], 'cis-secondary.pdf', { type: 'application/pdf' });

    fireEvent.drop(screen.getByTestId('main-upload-dropzone-ocr'), { dataTransfer: dataTransfer([file]) });
    await waitFor(() => expect(screen.getByText('cis-secondary.pdf')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'OCR実行' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ocr', expect.objectContaining({ method: 'POST' })));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('target');
    expect(screen.getByText('保存先をCIS②と自動判定し、OCRで1行を書き込み済みです')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'CIS②' })).toBeChecked();
    expect(screen.queryByText('cis-secondary.pdf')).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '②ファイル投入' }));
    selectOcrSpreadsheet('CIS①');
    fireEvent.click(screen.getByRole('button', { name: 'OCR実行' }));
    expect(screen.getByText('OCR対象のPDFまたは画像を1件以上投入してください')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('種類の異なる資料をまとめて送り、自動振り分け結果を保存先別のログに表示する', async () => {
    const cisRows = [{ billingMonth: '2026年06月', customerNumber: 'CIS-1', customerName: 'CIS需要者', billingAmount: '100円', issuedAt: '', sourceFileName: 'cis.pdf' }];
    const abedenRows = [{ billingMonth: '2026年06月', customerNumber: 'ABD-1', customerName: 'あべでん需要家', billingAmount: '200円', issuedAt: '', sourceFileName: 'abeden.pdf' }];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => new Response(JSON.stringify(init?.method === 'POST'
      ? {
          ok: true,
          executedAt: '2026-08-17T05:00:00.000Z',
          updatedRows: 2,
          extractedRows: 2,
          rows: [...cisRows, ...abedenRows],
          results: [
            { target: 'cis-primary', targetLabel: 'CIS①', fileNames: ['cis.pdf'], updatedRows: 1, updatedRange: "'CIS①'!A2:P2", extractedRows: 1, rows: cisRows },
            { target: 'abeden', targetLabel: 'あべでん', fileNames: ['abeden.pdf'], updatedRows: 1, updatedRange: "'あべでん'!D3:M3", extractedRows: 1, rows: abedenRows },
          ],
        }
      : { ok: true, range: "'CIS①'!A2:P", rows: cisRows }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    selectWorkMode('OCR');
    const dropzone = screen.getByTestId('main-upload-dropzone-ocr');
    fireEvent.drop(dropzone, { dataTransfer: dataTransfer([
      new File(['cis'], 'cis.pdf', { type: 'application/pdf' }),
      new File(['abeden'], 'abeden.pdf', { type: 'application/pdf' }),
    ]) });

    fireEvent.click(screen.getByRole('button', { name: 'OCR実行' }));

    await waitFor(() => expect(screen.getByText('資料をCIS①・あべでんへ自動振り分けし、OCRで合計2行を書き込み済みです')).toBeInTheDocument());
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body).not.toHaveProperty('target');
    expect(body.files).toHaveLength(2);
    fireEvent.click(within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '⑤ログ' }));
    const executionLog = screen.getByRole('region', { name: 'OCR実行ログ' });
    expect(within(executionLog).getAllByText('成功')).toHaveLength(2);
    expect(within(executionLog).getByRole('link', { name: 'CIS①' })).toBeInTheDocument();
    expect(within(executionLog).getByRole('link', { name: 'あべでん' })).toBeInTheDocument();
  });

  it('あべでん枠に複数ファイルをドロップすると全ファイルを読み込む', async () => {
    render(<App />);
    const abedenDropzone = screen.getByTestId('main-upload-dropzone-abeden');
    const files = [
      new File(['xlsx'], 'abeden-1.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      new File(['xlsx'], 'abeden-2.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    ];

    fireEvent.drop(abedenDropzone, { dataTransfer: dataTransfer(files) });

    await waitFor(() => expect(parseAbedenFile).toHaveBeenCalledTimes(2));
    expect(vi.mocked(parseAbedenFile).mock.calls.map(([file]) => file.name)).toEqual(['abeden-1.xlsx', 'abeden-2.xlsx']);
    expect(screen.getByText(/2ファイル/)).toBeInTheDocument();
  });

  it('CIS枠は5ファイル以上でも切り捨てずに全料金突合用ファイルを読み込む', async () => {
    render(<App />);
    const cisDropzone = screen.getByTestId('main-upload-dropzone-cis');
    const files = Array.from({ length: 6 }, (_, index) => (
      new File(['請求年月,需要者番号,需要者名,請求金額,発行日\n'], `CISデータ 料金突合用ファイル-${index + 1}.csv`, { type: 'text/csv' })
    ));

    fireEvent.drop(cisDropzone, { dataTransfer: dataTransfer(files) });

    await waitFor(() => expect(parseCisFile).toHaveBeenCalledTimes(6));
    expect(screen.getByText(/6ファイル/)).toBeInTheDocument();
  });

  it('CIS枠にパラメータファイルだけを入れた場合は不要ファイルとして案内する', async () => {
    render(<App />);
    const cisDropzone = screen.getByTestId('main-upload-dropzone-cis');
    const file = new File(['xlsx'], '20260722114212_一般社団法人 東松島みらいとし機構パラメータ.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    fireEvent.drop(cisDropzone, { dataTransfer: dataTransfer([file]) });

    await waitFor(() => expect(screen.getByText(/パラメータファイルは不要です/)).toBeInTheDocument());
    expect(parseCisFile).not.toHaveBeenCalledWith(file);
  });

  it('CIS枠にマスタ・パラメータ・料金突合用ファイルが混ざっても料金突合用ファイルだけ読む', async () => {
    render(<App />);
    const cisDropzone = screen.getByTestId('main-upload-dropzone-cis');
    const master = new File(['xlsx'], '20260722114029_一般社団法人 東松島みらいとし機構マスタ.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const parameter = new File(['xlsx'], '20260722114212_一般社団法人 東松島みらいとし機構パラメータ.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const billingCsv = new File(['請求年月,需要者番号,需要者名,請求金額,発行日\n'], 'CISデータ 料金突合用ファイル.csv', { type: 'text/csv' });

    fireEvent.drop(cisDropzone, { dataTransfer: dataTransfer([master, parameter, billingCsv]) });

    await waitFor(() => expect(parseCisFile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(parseCisFile).mock.calls[0]?.[0]).toBe(billingCsv);
    expect(screen.getByText(/マスタファイルは今回の突合では取り込み不要のため無視しました/)).toBeInTheDocument();
    expect(screen.getByText(/パラメータファイルは今回の突合では取り込み不要のため無視しました/)).toBeInTheDocument();
  });

  it('突合後にメイン画面で需要者番号・需要者名・請求金額・発行日・誤差有無を一覧管理できる', async () => {
    vi.mocked(parseCisFile).mockResolvedValueOnce({
      fileName: 'cis.csv',
      warnings: [],
      months: ['202606'],
      rows: [{
        sourceFileName: 'cis.csv',
        sourceRowNumber: 2,
        billingMonth: '202606',
        customerNumber: 'khope0079',
        customerName: '矢本海浜緑地パークゴルフ場',
        billingAmount: '68006',
        issueDate: '2026/7/7',
      }],
    });
    vi.mocked(parseAbedenFile).mockResolvedValueOnce({
      fileName: 'abeden.xlsx',
      warnings: [],
      months: ['202606'],
      rows: [{
        sourceRowNumber: 3,
        cells: ['', '', '', 'khope0079', '矢本海浜緑地パークゴルフ場', '202606', '', '', '', '', '', '', '68008'],
        sourceFileName: 'abeden.xlsx',
        customerId: 'khope0079',
        customerName: '矢本海浜緑地パークゴルフ場',
        targetMonth: '202606',
        billingAmount: '68008',
      }],
    });
    render(<App />);

    fireEvent.drop(screen.getByTestId('main-upload-dropzone-cis'), { dataTransfer: dataTransfer([new File(['csv'], 'cis.csv', { type: 'text/csv' })]) });
    fireEvent.drop(screen.getByTestId('main-upload-dropzone-abeden'), { dataTransfer: dataTransfer([new File(['xlsx'], 'abeden.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })]) });
    await waitFor(() => expect(parseAbedenFile).toHaveBeenCalledTimes(1));

    fireEvent.click(within(screen.getByRole('region', { name: '空白部ファイルアップロード' })).getByRole('button', { name: '突合実行' }));

    const resultArea = await screen.findByRole('region', { name: '突合結果エリア' });
    expect(resultArea).toBeInTheDocument();
    expect(within(resultArea).getAllByText('khope0079').length).toBeGreaterThan(0);
    expect(within(resultArea).getAllByText('矢本海浜緑地パークゴルフ場').length).toBeGreaterThan(0);
    expect(within(resultArea).getAllByText('68006').length).toBeGreaterThan(0);
    expect(within(resultArea).getAllByText('2026/7/7').length).toBeGreaterThan(0);
    expect(within(resultArea).getByText('CIS: cis.csv 2行 請求金額 / あべでん: abeden.xlsx 3行 M列 請求金額')).toBeInTheDocument();

    const finalPreview = screen.getByRole('region', { name: '最終出力プレビュー' });
    expect(finalPreview).toBeInTheDocument();
    expect(within(finalPreview).getByText('A列 請求先ID')).toBeInTheDocument();
    expect(within(finalPreview).getByText('I列 CIS①～④ / 需要家名')).toBeInTheDocument();
    expect(within(finalPreview).getByText('T列 請求金額 / 正誤チェック')).toBeInTheDocument();
    expect(within(finalPreview).getByText('U列 市場連動 / 誤差±1円以内')).toBeInTheDocument();
    expect(within(finalPreview).getAllByText('FALSE')).toHaveLength(2);
    within(finalPreview).getAllByText('FALSE').forEach((cell) => expect(cell).toHaveClass('outputCellNg'));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/write-sheet', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/save-log', expect.objectContaining({ method: 'POST' })));
    const saveLogCall = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/save-log');
    expect(JSON.parse(String(saveLogCall?.[1]?.body))).toEqual(expect.objectContaining({
      executedAt: expect.stringMatching(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/),
      targetMonth: '202606',
      cisFileNames: ['cis.csv'],
      abedenFileNames: ['abeden.xlsx'],
      summary: expect.objectContaining({ total: 1, amountMismatchCount: 1 }),
    }));
    expect(await screen.findByText('Googleスプレッドシートへ自動書き込み済みです')).toBeInTheDocument();
    const topResultTab = within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '③結果' });
    expect(topResultTab).toBeInTheDocument();
    expect(topResultTab).toHaveAttribute('aria-selected', 'true');
    const currentResultArea = screen.getByRole('region', { name: '突合結果エリア' });
    expect(currentResultArea).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '突合結果' })).toBeInTheDocument();
    const resultSummary = within(currentResultArea).getByRole('region', { name: '突合サマリ' });
    expect(within(resultSummary).queryByText('あべでんのみ')).not.toBeInTheDocument();
    expect(within(resultSummary).queryByText('CISのみ')).not.toBeInTheDocument();
    const topLogTab = within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '⑤ログ' });
    expect(topLogTab).toBeInTheDocument();
    fireEvent.click(topLogTab);
    expect(topLogTab).toHaveAttribute('aria-selected', 'true');
    const firstLogArea = screen.getByRole('region', { name: 'ログエリア' });
    expect(firstLogArea).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ログ' })).toBeInTheDocument();
    expect(within(firstLogArea).getByText(/^突合日時: \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)).toBeInTheDocument();
    const sheetsLink = screen.getByRole('link', { name: /Googleスプレッドシート連携/ });
    expect(sheetsLink).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1AHwU-UA3llo9ex52-obkbROLqrWq514nekXMtdkDl3g/edit?gid=54789944#gid=54789944');
    expect(sheetsLink).toHaveAttribute('target', '_blank');

    fireEvent.click(within(screen.getByRole('tablist', { name: '上部バータブ' })).getByRole('tab', { name: '②ファイル投入' }));
    fireEvent.drop(screen.getByTestId('main-upload-dropzone-cis'), { dataTransfer: dataTransfer([new File(['csv'], 'new-cis.csv', { type: 'text/csv' })]) });
    await waitFor(() => expect(parseCisFile).toHaveBeenCalledTimes(2));

    fireEvent.click(topLogTab);

    const logArea = screen.getByRole('region', { name: 'ログエリア' });
    expect(logArea).toBeInTheDocument();
    expect(within(logArea).getAllByText('khope0079').length).toBeGreaterThan(0);
    expect(within(logArea).getAllByText('68008').length).toBeGreaterThan(0);
  });
});
