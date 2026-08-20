import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react';
import {
  buildOutputRows,
  mismatchItemLabel,
  outputHeaders,
  reconcileBillingRows,
  ReconciliationResult,
  ReconciliationRow,
} from './utils/cisAbedenReconciliation';
import {
  downloadReconciliationWorkbook,
  cisSupportFileKind,
  isCisSupportFile,
  parseAbedenFile,
  parseCisFile,
  ParsedAbedenFile,
  ParsedCisFile,
} from './utils/cisAbedenFiles';
import { buildSheetsWritePayload, TARGET_SPREADSHEET_URL } from './utils/sheetsExport';

const OCR_CIS_PRIMARY_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20/edit?gid=1215098227#gid=1215098227';
const OCR_CIS_SECONDARY_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20/edit?gid=2079880305#gid=2079880305';
const OCR_ABEDEN_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20/edit?gid=1678193460#gid=1678193460';
const OCR_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const MAX_OCR_UPLOAD_BYTES = 3 * 1024 * 1024;

const ocrFileMimeType = (file: File) => {
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (file.type === 'application/pdf' || extension === 'pdf') return 'application/pdf';
  if (file.type === 'image/png' || extension === 'png') return 'image/png';
  if (file.type === 'image/jpeg' || file.type === 'image/jpg' || extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (file.type === 'image/webp' || extension === 'webp') return 'image/webp';
  return file.type || 'application/octet-stream';
};

const isSupportedOcrFile = (file: File) => ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(ocrFileMimeType(file));

const FilePicker = ({
  id,
  label,
  accept,
  multiple,
  onFiles,
}: {
  id: string;
  label: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}) => {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    handleDrag(event);
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    handleDrag(event);
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    handleDrag(event);
    setDragActive(false);
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length > 0) onFiles(droppedFiles);
  };

  return (
    <label
      className={`dropzone ${dragActive ? 'dropzoneActive' : ''}`}
      data-testid={`dropzone-${id}`}
      htmlFor={id}
      onDragEnter={handleDragEnter}
      onDragOver={handleDrag}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="dropzoneTitle">{label}</span>
      <span className="dropzoneHint">クリックして選択 / ドラッグ&ドロップ対応</span>
      {dragActive && <span className="dropzoneDropText">ここにドロップして追加</span>}
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onFiles(Array.from(event.target.files ?? []))}
      />
    </label>
  );
};

const StatusList = ({ title, items, tone = 'warn' }: { title: string; items: string[]; tone?: 'warn' | 'error' }) => {
  if (items.length === 0) return null;
  return (
    <section className={`alert alert-${tone}`}>
      <h3>{title}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
};

const judgeLabel = (row: ReconciliationRow) => {
  if (!row.matched) return 'あべでんのみ';
  if (!row.nameOk) return '名称NG';
  if (!row.amountWithinOneYen) return '金額NG';
  return 'OK';
};


const PREVIEW_COLUMN_COUNT = 22;
const PREVIEW_COLUMN_LETTERS = Array.from({ length: PREVIEW_COLUMN_COUNT }, (_, index) => {
  let column = '';
  let current = index + 1;
  while (current > 0) {
    const mod = (current - 1) % 26;
    column = String.fromCharCode(65 + mod) + column;
    current = Math.floor((current - mod) / 26);
  }
  return column;
});

const finalOutputPreviewHeaders = () => {
  const [first, second] = outputHeaders();
  return first.slice(0, PREVIEW_COLUMN_COUNT).map((header, index) => {
    const subHeader = second[index] ? ` / ${second[index]}` : '';
    return `${PREVIEW_COLUMN_LETTERS[index]}列 ${header}${subHeader}`;
  });
};


const outputCellText = (cell: unknown): string => {
  if (typeof cell === 'boolean') return String(cell).toUpperCase();
  return String(cell ?? '');
};

const finalOutputCellClass = (row: ReconciliationRow, columnIndex: number) => {
  if (!row.matched && [4, 8, 18, 21].includes(columnIndex)) return 'outputCellNg';
  if (!row.nameOk && [8, 9].includes(columnIndex)) return 'outputCellNg';
  if (!row.amountExact && columnIndex === 19) return 'outputCellNg';
  if (!row.amountWithinOneYen && columnIndex === 20) return 'outputCellNg';
  if ([9, 19, 20].includes(columnIndex)) return 'outputCellOk';
  return '';
};

type TopTab = 'files' | 'usage' | 'results' | 'log';
type MainDropTarget = 'cis' | 'abeden' | 'ocr' | null;
type WorkMode = 'reconciliation' | 'ocr';
type OcrSpreadsheetTarget = 'cis-primary' | 'cis-secondary' | 'abeden';
type OcrUploadFile = { file: File };
type OcrResultRow = {
  billingMonth: string;
  customerNumber: string;
  customerName: string;
  billingAmount: string;
  issuedAt: string;
  sourceFileName: string;
};
type OcrRunLog = {
  id: string;
  status: 'success' | 'error';
  executedAt: string;
  target: OcrSpreadsheetTarget;
  targetLabel: string;
  spreadsheetUrl: string;
  fileNames: string[];
  rows: OcrResultRow[];
  extractedRows: number;
  updatedRows: number;
  updatedRange: string;
  error?: string;
};
type OcrApiTargetResult = {
  target: OcrSpreadsheetTarget;
  targetLabel?: string;
  fileNames?: string[];
  updatedRows?: number;
  updatedRange?: string;
  extractedRows?: number;
  rows?: OcrResultRow[];
};
type OcrSheetSnapshot = {
  target: OcrSpreadsheetTarget;
  rows: OcrResultRow[];
  range: string;
};
type OcrFileLog = {
  sourceFileName: string;
  rowCount: number;
  billingMonths: string[];
  firstCustomerNumber: string;
  lastCustomerNumber: string;
};

const ocrUploadKey = (item: OcrUploadFile) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`;

const appendUniqueOcrFiles = (current: OcrUploadFile[], files: File[]) => {
  const next = [...current];
  const known = new Set(current.map(ocrUploadKey));
  for (const file of files) {
    const item = { file };
    const key = ocrUploadKey(item);
    if (known.has(key)) continue;
    known.add(key);
    next.push(item);
  }
  return next;
};

const ocrSpreadsheetLabel = (target: OcrSpreadsheetTarget) => {
  if (target === 'cis-primary') return 'CIS①';
  if (target === 'cis-secondary') return 'CIS②';
  return 'あべでん';
};

const ocrSpreadsheetUrl = (target: OcrSpreadsheetTarget) => {
  if (target === 'cis-primary') return OCR_CIS_PRIMARY_SPREADSHEET_URL;
  if (target === 'cis-secondary') return OCR_CIS_SECONDARY_SPREADSHEET_URL;
  return OCR_ABEDEN_SPREADSHEET_URL;
};

const buildOcrFileLogs = (rows: OcrResultRow[]): OcrFileLog[] => {
  const groups = new Map<string, OcrResultRow[]>();
  for (const row of rows) {
    const sourceFileName = row.sourceFileName || '元ファイル不明';
    groups.set(sourceFileName, [...(groups.get(sourceFileName) ?? []), row]);
  }
  return [...groups.entries()].map(([sourceFileName, sourceRows]) => ({
    sourceFileName,
    rowCount: sourceRows.length,
    billingMonths: [...new Set(sourceRows.map((row) => row.billingMonth).filter(Boolean))],
    firstCustomerNumber: sourceRows[0]?.customerNumber ?? '',
    lastCustomerNumber: sourceRows[sourceRows.length - 1]?.customerNumber ?? '',
  }));
};

const mismatchSourceLocations = (row: ReconciliationRow): string[] => {
  if (!row.matched) {
    return [`あべでん: ${row.abeden.sourceFileName ?? 'あべでんファイル'} ${row.abeden.sourceRowNumber}行 D列 需要家ID`];
  }
  const locations: string[] = [];
  if (!row.nameOk) {
    locations.push(`CIS: ${row.cis?.sourceFileName ?? 'CISファイル'} ${row.cis?.sourceRowNumber ?? '-'}行 需要者名`);
    locations.push(`あべでん: ${row.abeden.sourceFileName ?? 'あべでんファイル'} ${row.abeden.sourceRowNumber}行 E列 需要家名`);
  }
  if (!row.amountWithinOneYen) {
    locations.push(`CIS: ${row.cis?.sourceFileName ?? 'CISファイル'} ${row.cis?.sourceRowNumber ?? '-'}行 請求金額`);
    locations.push(`あべでん: ${row.abeden.sourceFileName ?? 'あべでんファイル'} ${row.abeden.sourceRowNumber}行 M列 請求金額`);
  }
  return locations;
};

const formatLogExecutedAt = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}/${value('month')}/${value('day')} ${value('hour')}:${value('minute')}`;
};

const formatOcrLogExecutedAt = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatLogExecutedAt(date);
};

const usageGuideContent: Record<WorkMode, { lead: string; steps: { title: string; detail: string }[] }> = {
  reconciliation: {
    lead: 'CISとあべでんの2種類を入れ、結果と確認場所を順に確認します。',
    steps: [
      { title: '2種類のファイルを入れる', detail: '「CISデータ」と「料金計算ファイル」の各投入欄へ追加します。' },
      { title: '読み込み内容を確認', detail: 'ファイル数と対象年月を確認します。' },
      { title: '突合を実行', detail: '「突合実行」を押し、番号・名称・金額を比べます。' },
      { title: '結果を確認', detail: '「結果」で不一致と元ファイルの行・列を確認します。' },
      { title: '保存・履歴を確認', detail: '「スプレッドシート」と「ログ」で保存内容を確認します。' },
    ],
  },
  ocr: {
    lead: 'PDFや画像をまとめて入れると、資料の内容から保存先を自動で判定します。',
    steps: [
      { title: 'PDF・画像を入れる', detail: '資料の種類を分けず、1つの投入欄へまとめて追加します。' },
      { title: '保存先を自動判定', detail: '資料の内容からCIS①・CIS②・あべでんを判定します。' },
      { title: 'OCRを実行', detail: '「OCR実行」を押すと文字を読み取り、対応するシートへ保存します。' },
      { title: '読み取り結果を確認', detail: '「結果」で抽出した行数・内容・保存範囲を確認します。' },
      { title: 'シート・ログを確認', detail: '「スプレッドシート」と「ログ」で保存内容と実行履歴を確認します。' },
    ],
  },
};

const UsageGuide = ({ workMode }: { workMode: WorkMode }) => {
  const guide = usageGuideContent[workMode];
  const modeLabel = workMode === 'ocr' ? 'OCR' : '突合';
  return (
    <div className="usageGuide">
      <div className="usageGuideIntro">
        <span className="usageModeLabel">現在：{modeLabel}</span>
        <p>{guide.lead}</p>
      </div>
      <ol className="usageSteps" aria-label={`${modeLabel}の操作手順`}>
        {guide.steps.map((step, index) => (
          <li className="usageStep" key={step.title}>
            <span className="usageStepNumber" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default function App() {
  const [cisFiles, setCisFiles] = useState<ParsedCisFile[]>([]);
  const [abedenFiles, setAbedenFiles] = useState<ParsedAbedenFile[]>([]);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [logResult, setLogResult] = useState<ReconciliationResult | null>(null);
  const [logExecutedAt, setLogExecutedAt] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [topTab, setTopTab] = useState<TopTab>('files');
  const [workMode, setWorkMode] = useState<WorkMode>('reconciliation');
  const [ocrSpreadsheetTarget, setOcrSpreadsheetTarget] = useState<OcrSpreadsheetTarget>('cis-primary');
  const [mainDropActive, setMainDropActive] = useState<MainDropTarget>(null);
  const [sheetWriteStatus, setSheetWriteStatus] = useState<'idle' | 'writing' | 'success' | 'error'>('idle');
  const [sheetWriteMessage, setSheetWriteMessage] = useState('');
  const [ocrFiles, setOcrFiles] = useState<OcrUploadFile[]>([]);
  const [ocrMessage, setOcrMessage] = useState('');
  const [ocrResult, setOcrResult] = useState<OcrRunLog | null>(null);
  const [ocrRunLogs, setOcrRunLogs] = useState<OcrRunLog[]>([]);
  const [ocrSheetSnapshot, setOcrSheetSnapshot] = useState<OcrSheetSnapshot | null>(null);
  const [ocrViewLoading, setOcrViewLoading] = useState(false);
  const [ocrViewError, setOcrViewError] = useState('');
  const [ocrRefreshKey, setOcrRefreshKey] = useState(0);

  const allCisRows = useMemo(() => cisFiles.flatMap((file) => file.rows), [cisFiles]);
  const allAbedenRows = useMemo(() => abedenFiles.flatMap((file) => file.rows), [abedenFiles]);
  const targetMonth = useMemo(() => {
    const months = [...new Set([...abedenFiles.flatMap((file) => file.months), ...cisFiles.flatMap((file) => file.months)])]
      .filter(Boolean)
      .sort();
    return months[0] ?? '';
  }, [abedenFiles, cisFiles]);

  useEffect(() => {
    if (workMode !== 'ocr' || (topTab !== 'results' && topTab !== 'log')) return undefined;
    const controller = new AbortController();
    let active = true;
    setOcrViewLoading(true);
    setOcrViewError('');
    void (async () => {
      try {
        const response = await fetch(`/api/ocr?target=${encodeURIComponent(ocrSpreadsheetTarget)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const responseText = await response.text();
        let json: { ok?: boolean; error?: string; rows?: OcrResultRow[]; range?: string };
        try {
          json = responseText ? JSON.parse(responseText) as { ok?: boolean; error?: string; rows?: OcrResultRow[]; range?: string } : {};
        } catch {
          throw new Error(`OCR結果APIがJSON以外を返しました: ${responseText.slice(0, 120)}`);
        }
        if (!response.ok || !json.ok) throw new Error(json.error || 'OCR結果の読み込みに失敗しました');
        if (!active) return;
        setOcrSheetSnapshot({
          target: ocrSpreadsheetTarget,
          rows: Array.isArray(json.rows) ? json.rows : [],
          range: json.range ?? '',
        });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setOcrViewError(error instanceof Error ? error.message : 'OCR結果の読み込みに失敗しました');
      } finally {
        if (active) setOcrViewLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [ocrRefreshKey, ocrSpreadsheetTarget, topTab, workMode]);

  const readCisFiles = async (files: File[]) => {
    if (workMode === 'ocr') {
      setOcrFiles((current) => appendUniqueOcrFiles(current, files));
      setErrors([]);
      setOcrMessage('');
      return;
    }
    setBusy(true);
    setErrors([]);
    setResult(null);
    try {
      const skippedSupportFiles = files.filter((file) => isCisSupportFile(file.name));
      const targetFiles = files.filter((file) => !isCisSupportFile(file.name));
      if (targetFiles.length === 0) {
        setCisFiles([]);
        setWarnings(skippedSupportFiles.map((file) => `${file.name}: ${cisSupportFileKind(file.name)}ファイルは今回の突合では取り込み不要です`));
        setErrors(['CIS枠には「料金突合用ファイル」(請求年月・需要者番号・需要者名・請求金額・発行日を含むCSV/xlsx)を入れてください。マスタ・パラメータファイルは不要です。']);
        return;
      }
      const parsed: ParsedCisFile[] = [];
      for (const file of targetFiles) {
        parsed.push(await parseCisFile(file));
      }
      setCisFiles(parsed);
      setWarnings([
        ...skippedSupportFiles.map((file) => `${file.name}: ${cisSupportFileKind(file.name)}ファイルは今回の突合では取り込み不要のため無視しました`),
        ...parsed.flatMap((file) => file.warnings),
      ]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'CISファイルの読込に失敗しました']);
    } finally {
      setBusy(false);
    }
  };

  const readAbedenFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (workMode === 'ocr') {
      setOcrFiles((current) => appendUniqueOcrFiles(current, files));
      setErrors([]);
      setOcrMessage('');
      return;
    }
    setBusy(true);
    setErrors([]);
    setResult(null);
    try {
      const parsed: ParsedAbedenFile[] = [];
      for (const file of files) {
        parsed.push(await parseAbedenFile(file));
      }
      setAbedenFiles(parsed);
      setWarnings((current) => [...current, ...parsed.flatMap((file) => file.warnings)]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'あべでんファイルの読込に失敗しました']);
    } finally {
      setBusy(false);
    }
  };

  const readOcrFiles = (files: File[]) => {
    if (files.length === 0) return;
    const supportedFiles = files.filter(isSupportedOcrFile);
    const unsupportedFiles = files.filter((file) => !isSupportedOcrFile(file));
    if (supportedFiles.length > 0) setOcrFiles((current) => appendUniqueOcrFiles(current, supportedFiles));
    setErrors(unsupportedFiles.map((file) => `${file.name}: OCRはPDF・PNG・JPEG・WebPに対応しています`));
    setOcrMessage('');
  };

  const handleMainDrag = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleMainDragEnter = (target: Exclude<MainDropTarget, null>, event: DragEvent<HTMLElement>) => {
    handleMainDrag(event);
    setMainDropActive(target);
  };

  const handleMainDragLeave = (event: DragEvent<HTMLElement>) => {
    handleMainDrag(event);
    setMainDropActive(null);
  };

  const handleMainDrop = (target: Exclude<MainDropTarget, null>, event: DragEvent<HTMLElement>) => {
    handleMainDrag(event);
    setMainDropActive(null);
    const files = Array.from(event.dataTransfer.files);
    if (target === 'cis') {
      void readCisFiles(files);
      return;
    }
    void readAbedenFiles(files);
  };

  const handleOcrDrop = (event: DragEvent<HTMLElement>) => {
    handleMainDrag(event);
    setMainDropActive(null);
    readOcrFiles(Array.from(event.dataTransfer.files));
  };

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`${file.name} の読み込みに失敗しました`));
    reader.readAsDataURL(file);
  });

  const runOcr = async () => {
    const resultViewTarget = ocrSpreadsheetTarget;
    const targetFiles = ocrFiles;
    if (targetFiles.length === 0) {
      setErrors(['OCR対象のPDFまたは画像を1件以上投入してください']);
      return;
    }
    const totalBytes = targetFiles.reduce((total, item) => total + item.file.size, 0);
    if (totalBytes > MAX_OCR_UPLOAD_BYTES) {
      setErrors([`1回のOCRは合計3MBまでです（現在 ${(totalBytes / 1024 / 1024).toFixed(1)}MB）。ファイルを分けて実行してください`]);
      return;
    }
    const startedAt = new Date().toISOString();
    const fileNames = targetFiles.map((item) => item.file.name);
    setBusy(true);
    setErrors([]);
    setOcrMessage('資料を確認し、保存先を自動判定しています');
    try {
      const files = [];
      for (const item of targetFiles) {
        const mimeType = ocrFileMimeType(item.file);
        const rawDataUrl = await fileToDataUrl(item.file);
        const dataUrl = rawDataUrl.replace(/^data:[^;]*;base64,/, `data:${mimeType};base64,`);
        files.push({ fileName: item.file.name, mimeType, dataUrl });
      }
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const responseText = await response.text();
      let json: {
        ok?: boolean;
        error?: string;
        target?: OcrSpreadsheetTarget;
        targetLabel?: string;
        fileNames?: string[];
        executedAt?: string;
        updatedRows?: number;
        updatedRange?: string;
        extractedRows?: number;
        rows?: OcrResultRow[];
        results?: OcrApiTargetResult[];
      };
      try {
        json = responseText ? JSON.parse(responseText) as typeof json : {};
      } catch {
        throw new Error(`OCR APIがJSON以外を返しました: ${responseText.slice(0, 120)}`);
      }
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'OCR処理に失敗しました');
      }
      const fallbackResult: OcrApiTargetResult[] = json.target ? [{
        target: json.target,
        targetLabel: json.targetLabel,
        fileNames: json.fileNames,
        updatedRows: json.updatedRows,
        updatedRange: json.updatedRange,
        extractedRows: json.extractedRows,
        rows: json.rows,
      }] : [];
      const targetResults = Array.isArray(json.results) && json.results.length > 0 ? json.results : fallbackResult;
      if (targetResults.length === 0) throw new Error('OCRの保存先判定結果を確認できませんでした');
      const executedAt = json.executedAt ?? startedAt;
      const completedRuns: OcrRunLog[] = targetResults.map((resultItem) => ({
        id: `${executedAt}-${resultItem.target}-${(resultItem.fileNames ?? fileNames).join('|')}`,
        status: 'success',
        executedAt,
        target: resultItem.target,
        targetLabel: resultItem.targetLabel ?? ocrSpreadsheetLabel(resultItem.target),
        spreadsheetUrl: ocrSpreadsheetUrl(resultItem.target),
        fileNames: Array.isArray(resultItem.fileNames) ? resultItem.fileNames : fileNames,
        rows: Array.isArray(resultItem.rows) ? resultItem.rows : [],
        extractedRows: resultItem.extractedRows ?? resultItem.updatedRows ?? 0,
        updatedRows: resultItem.updatedRows ?? 0,
        updatedRange: resultItem.updatedRange ?? '',
      }));
      const rowCount = json.extractedRows ?? completedRuns.reduce((total, run) => total + run.extractedRows, 0);
      const completedTarget = completedRuns[0].target;
      const completedLabels = completedRuns.map((run) => run.targetLabel).join('・');
      const submittedFiles = new Set(targetFiles);
      setOcrFiles((current) => current.filter((item) => !submittedFiles.has(item)));
      setOcrResult(completedRuns[0]);
      setOcrRunLogs((current) => [...completedRuns, ...current].slice(0, 50));
      setOcrMessage(completedRuns.length === 1
        ? `保存先を${completedLabels}と自動判定し、OCRで${rowCount}行を書き込み済みです`
        : `資料を${completedLabels}へ自動振り分けし、OCRで合計${rowCount}行を書き込み済みです`);
      setOcrSpreadsheetTarget(completedTarget);
      setOcrRefreshKey((current) => current + 1);
      setTopTab('results');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR処理に失敗しました';
      const failedRun: OcrRunLog = {
        id: `${startedAt}-automatic-${fileNames.join('|')}-error`,
        status: 'error',
        executedAt: startedAt,
        target: resultViewTarget,
        targetLabel: '自動判定',
        spreadsheetUrl: ocrSpreadsheetUrl(resultViewTarget),
        fileNames,
        rows: [],
        extractedRows: 0,
        updatedRows: 0,
        updatedRange: '',
        error: message,
      };
      setOcrRunLogs((current) => [failedRun, ...current].slice(0, 50));
      setErrors([message]);
      setOcrMessage('');
    } finally {
      setBusy(false);
    }
  };

  const writeResultToSheet = async (nextResult: ReconciliationResult) => {
    setSheetWriteStatus('writing');
    setSheetWriteMessage('Googleスプレッドシートへ自動書き込み中です');
    try {
      const response = await fetch('/api/write-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSheetsWritePayload(nextResult)),
      });
      const responseText = await response.text();
      let json: { ok?: boolean; error?: string; updatedRows?: number };
      try {
        json = responseText ? JSON.parse(responseText) as { ok?: boolean; error?: string; updatedRows?: number } : {};
      } catch {
        throw new Error(`GoogleスプレッドシートAPIがJSON以外を返しました: ${responseText.slice(0, 120)}`);
      }
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Googleスプレッドシートへの自動書き込みに失敗しました');
      }
      setSheetWriteStatus('success');
      setSheetWriteMessage('Googleスプレッドシートへ自動書き込み済みです');
    } catch (error) {
      setSheetWriteStatus('error');
      setSheetWriteMessage(error instanceof Error ? error.message : 'Googleスプレッドシートへの自動書き込みに失敗しました');
    }
  };

  const saveResultLog = async (nextResult: ReconciliationResult, executedAt: string) => {
    try {
      const response = await fetch('/api/save-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executedAt,
          targetMonth,
          cisFileNames: cisFiles.map((file) => file.fileName),
          abedenFileNames: abedenFiles.map((file) => file.fileName),
          summary: nextResult.summary,
        }),
      });
      const responseText = await response.text();
      let json: { ok?: boolean; error?: string };
      try {
        json = responseText ? JSON.parse(responseText) as { ok?: boolean; error?: string } : {};
      } catch {
        throw new Error(`Supabaseログ保存APIがJSON以外を返しました: ${responseText.slice(0, 120)}`);
      }
      if (!response.ok || !json.ok) {
        throw new Error(json.error || 'Supabaseへのログ保存に失敗しました');
      }
    } catch (error) {
      setWarnings((current) => [...current, error instanceof Error ? error.message : 'Supabaseへのログ保存に失敗しました']);
    }
  };

  const runReconciliation = () => {
    if (allAbedenRows.length === 0 || allCisRows.length === 0) {
      setErrors(['CISデータとあべでんデータを1件以上読み込んでください']);
      return;
    }
    try {
      const nextResult = reconcileBillingRows(allCisRows, allAbedenRows);
      const cisMonths = new Set(allCisRows.map((row) => row.billingMonth).filter(Boolean));
      const abedenMonths = new Set(allAbedenRows.map((row) => row.targetMonth).filter(Boolean));
      const monthWarning = [...cisMonths].some((month) => !abedenMonths.has(month)) || [...abedenMonths].some((month) => !cisMonths.has(month))
        ? ['CISとあべでんで対象年月の組が一致しません。年月込みキーで処理を続行しました']
        : [];
      setWarnings([...cisFiles.flatMap((file) => file.warnings), ...abedenFiles.flatMap((file) => file.warnings), ...nextResult.warnings, ...monthWarning]);
      const executedAt = formatLogExecutedAt(new Date());
      setResult(nextResult);
      setLogResult(nextResult);
      setLogExecutedAt(executedAt);
      setTopTab('results');
      setErrors([]);
      void writeResultToSheet(nextResult);
      void saveResultLog(nextResult, executedAt);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '突合処理に失敗しました']);
    }
  };

  const visibleResult = workMode === 'reconciliation' && topTab !== 'files' && topTab !== 'usage' ? topTab === 'log' ? logResult : result : null;
  const resultAreaLabel = workMode === 'ocr'
    ? topTab === 'log' ? 'OCRログエリア' : topTab === 'results' ? 'OCR結果エリア' : 'OCRファイル投入エリア'
    : topTab === 'log' ? 'ログエリア' : '突合結果エリア';
  const resultHeading = topTab === 'log' ? 'ログ' : '突合結果';
  const currentOcrSheetRows = ocrSheetSnapshot?.target === ocrSpreadsheetTarget ? ocrSheetSnapshot.rows : [];
  const currentOcrResult = ocrResult?.target === ocrSpreadsheetTarget ? ocrResult : null;
  const displayedOcrRows = currentOcrResult?.rows.length ? currentOcrResult.rows : currentOcrSheetRows;
  const displayedOcrRange = currentOcrResult?.updatedRange || (ocrSheetSnapshot?.target === ocrSpreadsheetTarget ? ocrSheetSnapshot.range : '');
  const ocrFileLogs = useMemo(() => buildOcrFileLogs(currentOcrSheetRows), [currentOcrSheetRows]);
  const showUploadPanel = workMode === 'ocr' ? topTab === 'files' : !visibleResult;

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (visibleResult?.rows ?? []).filter((row) => {
      const mismatch = !row.nameOk || !row.amountWithinOneYen || !row.matched;
      if (mismatchOnly && !mismatch) return false;
      if (!normalizedQuery) return true;
      return [row.abeden.customerId, row.abeden.customerName, row.cis?.customerNumber, row.cis?.customerName]
        .some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
    });
  }, [mismatchOnly, query, visibleResult]);


  const finalOutputHeaders = useMemo(() => finalOutputPreviewHeaders(), []);
  const finalOutputPreviewRows = useMemo(() => {
    if (!visibleResult) return [];
    return buildOutputRows(filteredRows).map((cells, rowIndex) => ({
      source: filteredRows[rowIndex],
      cells: cells.slice(0, PREVIEW_COLUMN_COUNT),
    }));
  }, [filteredRows, visibleResult]);

  const activeSpreadsheetUrl = workMode === 'ocr' ? ocrSpreadsheetUrl(ocrSpreadsheetTarget) : TARGET_SPREADSHEET_URL;

  return (
    <main className="appFrame">
      <section className="mainWorkspace" aria-label="メイン作業エリア">
        <header className="hero">
          <div className="heroTopRow">
            <p className="eyebrow">一般社団法人 東松島みらいとし機構</p>
            <div className="heroControls" aria-label="右上操作">
              {workMode === 'ocr' && (
                <div className="modeSwitcher">
                  <span id="ocr-spreadsheet-switcher-label">結果の表示先</span>
                  <div className="modeSegments modeSegmentsWide" role="radiogroup" aria-labelledby="ocr-spreadsheet-switcher-label">
                    <label className="modeSegmentOption"><input type="radio" name="ocr-spreadsheet" value="cis-primary" checked={ocrSpreadsheetTarget === 'cis-primary'} disabled={busy} onChange={() => { setOcrSpreadsheetTarget('cis-primary'); setOcrMessage(''); }} /><span>CIS①</span></label>
                    <label className="modeSegmentOption"><input type="radio" name="ocr-spreadsheet" value="cis-secondary" checked={ocrSpreadsheetTarget === 'cis-secondary'} disabled={busy} onChange={() => { setOcrSpreadsheetTarget('cis-secondary'); setOcrMessage(''); }} /><span>CIS②</span></label>
                    <label className="modeSegmentOption"><input type="radio" name="ocr-spreadsheet" value="abeden" checked={ocrSpreadsheetTarget === 'abeden'} disabled={busy} onChange={() => { setOcrSpreadsheetTarget('abeden'); setOcrMessage(''); }} /><span>あべでん</span></label>
                  </div>
                </div>
              )}
              <div className="modeSwitcher">
                <span id="model-switcher-label">モデル切り替え</span>
                <div className="modeSegments" role="radiogroup" aria-labelledby="model-switcher-label">
                  <label className="modeSegmentOption"><input type="radio" name="work-mode" value="reconciliation" checked={workMode === 'reconciliation'} disabled={busy} onChange={() => setWorkMode('reconciliation')} /><span>突合</span></label>
                  <label className="modeSegmentOption"><input type="radio" name="work-mode" value="ocr" checked={workMode === 'ocr'} disabled={busy} onChange={() => setWorkMode('ocr')} /><span>OCR</span></label>
                </div>
              </div>
            </div>
          </div>
          <h1>{workMode === 'ocr' ? 'OCR' : 'CIS・あべでん料金突合システム'}</h1>
          <nav className="topTabs" role="tablist" aria-label="上部バータブ">
            <button type="button" role="tab" aria-selected={topTab === 'usage'} className={topTab === 'usage' ? 'topTabActive' : ''} onClick={() => setTopTab('usage')}>①使い方</button>
            <button type="button" role="tab" aria-selected={topTab === 'files'} className={topTab === 'files' ? 'topTabActive' : ''} onClick={() => setTopTab('files')}>②ファイル投入</button>
            <button type="button" role="tab" aria-selected={topTab === 'results'} className={topTab === 'results' ? 'topTabActive' : ''} onClick={() => setTopTab('results')}>③結果</button>
            <a className="topTabLink" href={activeSpreadsheetUrl} target="_blank" rel="noreferrer">④スプレッドシート</a>
            <button type="button" role="tab" aria-selected={topTab === 'log'} className={topTab === 'log' ? 'topTabActive' : ''} onClick={() => setTopTab('log')}>⑤ログ</button>
          </nav>
        </header>

        {topTab === 'usage' ? (
          <section className="card topUsagePanel usagePanel" aria-label="上部使い方">
            <h2>使い方</h2>
            <UsageGuide workMode={workMode} />
          </section>
        ) : (
        <section className="workspace" aria-label={resultAreaLabel}>
          <StatusList title="エラー" items={errors} tone="error" />
          <StatusList title="警告" items={warnings} />

          {showUploadPanel && (
            <section className={`mainUploadSplit ${workMode === 'ocr' ? 'mainUploadSplitOcr' : ''}`} aria-label="空白部ファイルアップロード">
              {workMode === 'ocr' ? (
                <section
                  className={`mainUploadDropzone mainUploadDropzoneOcr ${mainDropActive ? 'mainUploadDropzoneActive' : ''}`}
                  data-testid="main-upload-dropzone-ocr"
                  aria-label="OCRファイルアップロード"
                  onDragEnter={(event) => handleMainDragEnter('ocr', event)}
                  onDragOver={handleMainDrag}
                  onDragLeave={handleMainDragLeave}
                  onDrop={handleOcrDrop}
                >
                  <div>
                    <p className="mainUploadEyebrow">OCRファイル</p>
                    <h2>PDF・画像をまとめて投入</h2>
                    <p>資料を読み取り、保存先を自動判定します。</p>
                    <label className="mainUploadPicker" htmlFor="main-upload-ocr-input">ファイルを選択</label>
                    <input
                      id="main-upload-ocr-input"
                      className="mainUploadFileInput"
                      aria-label="OCRファイルを選択"
                      type="file"
                      multiple
                      disabled={busy}
                      accept={OCR_ACCEPT}
                      onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? []);
                        event.currentTarget.value = '';
                        readOcrFiles(files);
                      }}
                    />
                    <p className="fileSummary">{ocrFiles.length}ファイル</p>
                    <ul className="fileList">{ocrFiles.map((item) => <li key={ocrUploadKey(item)}>{item.file.name}</li>)}</ul>
                  </div>
                </section>
              ) : (
                <>
                  <section
                    className={`mainUploadDropzone mainUploadDropzoneCis ${mainDropActive === 'cis' ? 'mainUploadDropzoneActive' : ''}`}
                    data-testid="main-upload-dropzone-cis"
                    aria-label="CISファイルアップロード"
                    onDragEnter={(event) => handleMainDragEnter('cis', event)}
                    onDragOver={handleMainDrag}
                    onDragLeave={handleMainDragLeave}
                    onDrop={(event) => handleMainDrop('cis', event)}
                  >
                    <div>
                      <p className="mainUploadEyebrow">CISデータ</p>
                      <p>料金突合用CSV/xlsxをここへドロップします。</p>
                      <label className="mainUploadPicker" htmlFor="main-upload-cis-input">ファイルを選択</label>
                      <input
                        id="main-upload-cis-input"
                        className="mainUploadFileInput"
                        aria-label="CISファイルを選択"
                        type="file"
                        multiple
                        disabled={busy}
                        accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={(event) => {
                          const files = Array.from(event.currentTarget.files ?? []);
                          event.currentTarget.value = '';
                          void readCisFiles(files);
                        }}
                      />
                      <p className="fileSummary">{`${cisFiles.length}ファイル / ${allCisRows.length}件 / 年月: ${cisFiles.flatMap((file) => file.months).join(', ') || '-'}`}</p>
                      <ul className="fileList">{cisFiles.map((file) => <li key={file.fileName}>{file.fileName}</li>)}</ul>
                    </div>
                  </section>

                  <section
                    className={`mainUploadDropzone mainUploadDropzoneAbeden ${mainDropActive === 'abeden' ? 'mainUploadDropzoneActive' : ''}`}
                    data-testid="main-upload-dropzone-abeden"
                    aria-label="あべでんファイルアップロード"
                    onDragEnter={(event) => handleMainDragEnter('abeden', event)}
                    onDragOver={handleMainDrag}
                    onDragLeave={handleMainDragLeave}
                    onDrop={(event) => handleMainDrop('abeden', event)}
                  >
                    <div>
                      <p className="mainUploadEyebrow">料金計算ファイル</p>
                      <p>あべでん料金計算xlsxをここへドロップします。</p>
                      <label className="mainUploadPicker" htmlFor="main-upload-abeden-input">ファイルを選択</label>
                      <input
                        id="main-upload-abeden-input"
                        className="mainUploadFileInput"
                        aria-label="あべでんファイルを選択"
                        type="file"
                        multiple
                        disabled={busy}
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={(event) => {
                          const files = Array.from(event.currentTarget.files ?? []);
                          event.currentTarget.value = '';
                          void readAbedenFiles(files);
                        }}
                      />
                      <p className="fileSummary">{abedenFiles.length > 0 ? `${abedenFiles.length}ファイル / ${allAbedenRows.length}件 / 年月: ${abedenFiles.flatMap((file) => file.months).join(', ') || '-'}` : '未選択'}</p>
                      <ul className="fileList">{abedenFiles.map((file) => <li key={file.fileName}>{file.fileName}</li>)}</ul>
                    </div>
                  </section>
                </>
              )}

              <div className="mainUploadActions">
                <button className="primary mainRunButton" type="button" disabled={busy} onClick={workMode === 'ocr' ? runOcr : runReconciliation}>
                  {busy ? '処理中…' : workMode === 'ocr' ? 'OCR実行' : '突合実行'}
                </button>
              </div>
            </section>
          )}

          {ocrMessage && <section className="alert alert-warn" aria-label="OCR処理状態"><h3>OCR</h3><p>{ocrMessage}</p></section>}

          {workMode === 'ocr' && topTab === 'results' && (
            <>
              {ocrViewError && <section className="alert alert-error" aria-label="OCR結果読込エラー"><h3>エラー</h3><p>{ocrViewError}</p></section>}
              <section className="summaryGrid" aria-label="OCR結果サマリ">
                <div className="summary"><span>出力先</span><strong className="summaryText">{ocrSpreadsheetLabel(ocrSpreadsheetTarget)}</strong></div>
                <div className="summary"><span>対象ファイル</span><strong>{currentOcrResult?.fileNames.length ?? ocrFileLogs.length}</strong></div>
                <div className="summary"><span>抽出行数</span><strong>{currentOcrResult?.extractedRows ?? displayedOcrRows.length}</strong></div>
                <div className="summary"><span>書き込み範囲</span><strong className="summaryText">{displayedOcrRange || '-'}</strong></div>
              </section>

              <section className="card" aria-label="OCR結果一覧">
                <div className="resultsHead">
                  <div>
                    <h2>OCR結果</h2>
                    <p className="previewNote">
                      {currentOcrResult?.rows.length
                        ? `${formatOcrLogExecutedAt(currentOcrResult.executedAt)} に処理した明細です。`
                        : `${ocrSpreadsheetLabel(ocrSpreadsheetTarget)}スプレッドシートに保存済みの明細を表示しています。`}
                    </p>
                  </div>
                  <div className="tools">
                    <a className="ocrActionLink" href={ocrSpreadsheetUrl(ocrSpreadsheetTarget)} target="_blank" rel="noreferrer">スプレッドシートを開く</a>
                    <button className="ghost" type="button" disabled={ocrViewLoading} onClick={() => { setOcrResult(null); setOcrRefreshKey((current) => current + 1); }}>
                      {ocrViewLoading ? '読込中…' : '再読み込み'}
                    </button>
                  </div>
                </div>
                {ocrViewLoading && displayedOcrRows.length === 0 ? (
                  <p className="ocrEmptyState">OCR結果を読み込んでいます。</p>
                ) : displayedOcrRows.length === 0 ? (
                  <p className="ocrEmptyState">OCR実行後、抽出した明細をここに表示します。</p>
                ) : (
                  <div className="tableWrap ocrTableWrap">
                    <table className="ocrResultTable">
                      <thead>
                        <tr><th>請求年月</th><th>需要者番号</th><th>需要者名</th><th>請求金額</th><th>発行日</th><th>元ファイル</th></tr>
                      </thead>
                      <tbody>
                        {displayedOcrRows.map((row, index) => (
                          <tr key={`${row.sourceFileName}-${row.customerNumber}-${index}`}>
                            <td>{row.billingMonth}</td>
                            <td>{row.customerNumber}</td>
                            <td>{row.customerName}</td>
                            <td>{row.billingAmount}</td>
                            <td>{row.issuedAt}</td>
                            <td className="ocrFileNameCell">{row.sourceFileName || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {workMode === 'ocr' && topTab === 'log' && (
            <>
              {ocrViewError && <section className="alert alert-error" aria-label="OCRログ読込エラー"><h3>エラー</h3><p>{ocrViewError}</p></section>}
              <section className="card" aria-label="OCR実行ログ">
                <div className="resultsHead">
                  <div>
                    <h2>OCR実行ログ</h2>
                    <p className="previewNote">この画面を開いてから実行したOCRの成功・失敗を新しい順に表示します。</p>
                  </div>
                </div>
                {ocrRunLogs.length === 0 ? (
                  <p className="ocrEmptyState">この画面でのOCR実行履歴はまだありません。</p>
                ) : (
                  <div className="tableWrap ocrLogTableWrap">
                    <table className="ocrLogTable">
                      <thead><tr><th>日時</th><th>状態</th><th>出力先</th><th>ファイル</th><th>抽出行</th><th>書込行</th><th>書込範囲・エラー</th></tr></thead>
                      <tbody>
                        {ocrRunLogs.map((log) => (
                          <tr key={log.id} className={log.status === 'error' ? 'rowNg' : ''}>
                            <td>{formatOcrLogExecutedAt(log.executedAt)}</td>
                            <td><span className={`ocrStatusBadge ocrStatusBadge-${log.status}`}>{log.status === 'success' ? '成功' : '失敗'}</span></td>
                            <td><a className="sheetLink" href={log.spreadsheetUrl} target="_blank" rel="noreferrer">{log.targetLabel}</a></td>
                            <td className="ocrFileNameCell">{log.fileNames.join(' / ') || '-'}</td>
                            <td>{log.extractedRows}</td>
                            <td>{log.updatedRows}</td>
                            <td className={log.status === 'error' ? 'ng' : ''}>{log.error || log.updatedRange || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="card" aria-label="スプレッドシート取込ログ">
                <div className="resultsHead">
                  <div>
                    <h2>スプレッドシート取込ログ</h2>
                    <p className="previewNote">{ocrSpreadsheetLabel(ocrSpreadsheetTarget)}に保存済みの行を元ファイル別に集計しています。</p>
                  </div>
                  <div className="tools">
                    <a className="ocrActionLink" href={ocrSpreadsheetUrl(ocrSpreadsheetTarget)} target="_blank" rel="noreferrer">スプレッドシートを開く</a>
                    <button className="ghost" type="button" disabled={ocrViewLoading} onClick={() => { setOcrResult(null); setOcrRefreshKey((current) => current + 1); }}>
                      {ocrViewLoading ? '読込中…' : '再読み込み'}
                    </button>
                  </div>
                </div>
                {ocrViewLoading && ocrFileLogs.length === 0 ? (
                  <p className="ocrEmptyState">取込ログを読み込んでいます。</p>
                ) : ocrFileLogs.length === 0 ? (
                  <p className="ocrEmptyState">スプレッドシートに保存されたOCR取込履歴はありません。</p>
                ) : (
                  <div className="tableWrap ocrLogTableWrap">
                    <table className="ocrLogTable">
                      <thead><tr><th>元ファイル</th><th>取込行数</th><th>請求年月</th><th>先頭の需要者番号</th><th>末尾の需要者番号</th></tr></thead>
                      <tbody>
                        {ocrFileLogs.map((log) => (
                          <tr key={log.sourceFileName}>
                            <td className="ocrFileNameCell">{log.sourceFileName}</td>
                            <td>{log.rowCount}</td>
                            <td>{log.billingMonths.join(', ') || '-'}</td>
                            <td>{log.firstCustomerNumber || '-'}</td>
                            <td>{log.lastCustomerNumber || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {visibleResult && (
            <>
          {sheetWriteMessage && (
            <section className={`alert ${sheetWriteStatus === 'error' ? 'alert-error' : 'alert-warn'}`} aria-label="Googleスプレッドシート自動書き込み状態">
              <h3>
                <a className="sheetLink" href={TARGET_SPREADSHEET_URL} target="_blank" rel="noreferrer">
                  Googleスプレッドシート連携
                </a>
              </h3>
              <p>{sheetWriteMessage}</p>
            </section>
          )}
          <section className="summaryGrid" aria-label="突合サマリ">
            <div className="summary"><span>総件数</span><strong>{visibleResult.summary.total}</strong></div>
            <div className="summary"><span>一致件数(U基準)</span><strong>{visibleResult.summary.okCount}</strong></div>
            <div className="summary"><span>金額不一致</span><strong>{visibleResult.summary.amountMismatchCount}</strong></div>
            <div className="summary"><span>名称不一致</span><strong>{visibleResult.summary.nameMismatchCount}</strong></div>
          </section>

          <section className="card">
            <div className="resultsHead">
              <h2>{resultHeading}</h2>
              {topTab === 'log' && logExecutedAt && <p className="logTimestamp">突合日時: {logExecutedAt}</p>}
              <div className="tools">
                <label><input type="checkbox" checked={mismatchOnly} onChange={(event) => setMismatchOnly(event.target.checked)} /> 不一致のみ表示</label>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="需要家ID・需要家名で検索" />
                <button className="primary" type="button" onClick={() => downloadReconciliationWorkbook(visibleResult, targetMonth)}>
                  Excelダウンロード
                </button>
                <button className="ghost" type="button" onClick={() => { setResult(null); setTopTab('files'); }}>新しい突合</button>
              </div>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>状態</th><th>不一致項目</th><th>元ファイル該当箇所</th><th>需要家ID</th><th>需要家名(あべでん)</th><th>CIS需要家名</th><th>名称</th><th>あべでん請求金額</th><th>CIS請求金額</th><th>完全一致</th><th>±1円</th><th>発行日</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={`${row.key}-${row.abeden.sourceRowNumber}`} className={judgeLabel(row) === 'OK' ? '' : 'rowNg'}>
                      <td>{judgeLabel(row)}</td>
                      <td className={mismatchItemLabel(row) === '-' ? 'ok' : 'ng'}>{mismatchItemLabel(row)}</td>
                      <td className="sourceCell">{mismatchSourceLocations(row).join(' / ') || '-'}</td>
                      <td>{row.abeden.customerId}</td>
                      <td>{row.abeden.customerName}</td>
                      <td>{row.cis?.customerName ?? ''}</td>
                      <td className={row.nameOk ? 'ok' : 'ng'}>{row.nameJudge}</td>
                      <td>{row.abeden.billingAmount}</td>
                      <td>{row.cis?.billingAmount ?? ''}</td>
                      <td className={row.amountExact ? 'ok' : 'ng'}>{String(row.amountExact).toUpperCase()}</td>
                      <td className={row.amountWithinOneYen ? 'ok' : 'ng'}>{String(row.amountWithinOneYen).toUpperCase()}</td>
                      <td>{row.issueDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-label="最終出力プレビュー">
            <div className="resultsHead">
              <h2>最終出力プレビュー</h2>
              <p className="previewNote">ダウンロードされる「【CIS、あべでん突合ファイル】料金計算」xlsxの先頭22列を同じ並びで表示します。不一致セルは赤で確認できます。</p>
            </div>
            <div className="tableWrap finalOutputWrap">
              <table className="finalOutputTable">
                <thead>
                  <tr>
                    {finalOutputHeaders.map((header) => <th key={header}>{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {finalOutputPreviewRows.map(({ source, cells }) => (
                    <tr key={`final-${source.key}-${source.abeden.sourceRowNumber}`} className={judgeLabel(source) === 'OK' ? '' : 'rowNg'}>
                      {cells.map((cell, columnIndex) => (
                        <td key={`${source.key}-${source.abeden.sourceRowNumber}-${columnIndex}`} className={finalOutputCellClass(source, columnIndex)}>
                          {outputCellText(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {visibleResult.cisOnlyRows.length > 0 && (
            <section className="card">
              <h2>アンマッチ(CISのみ)</h2>
              <div className="tableWrap small">
                <table>
                  <thead><tr><th>請求年月</th><th>需要者番号</th><th>需要者名</th><th>請求金額</th><th>発行日</th></tr></thead>
                  <tbody>
                    {visibleResult.cisOnlyRows.map((row) => (
                      <tr key={`${row.sourceFileName}-${row.sourceRowNumber}`}>
                        <td>{row.billingMonth}</td><td>{row.customerNumber}</td><td>{row.customerName}</td><td>{row.billingAmount}</td><td>{row.issueDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
            </>
          )}
        </section>
        )}
      </section>
    </main>
  );
}
