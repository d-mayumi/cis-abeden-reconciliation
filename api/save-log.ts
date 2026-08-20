type VercelResponse = { status: (code: number) => { json: (body: unknown) => void } };

type ReconciliationLogPayload = {
  executedAt: string;
  targetMonth: string;
  cisFileNames: string[];
  abedenFileNames: string[];
  summary: {
    total: number;
    okCount: number;
    amountMismatchCount: number;
    nameMismatchCount: number;
    abedenOnlyCount: number;
    cisOnlyCount: number;
  };
};

const DEFAULT_LOG_TABLE = 'reconciliation_logs';

const json = (response: VercelResponse, status: number, body: unknown) => {
  response.status(status).json(body);
};

const supabaseAuthorizationHeader = (serviceRoleKey: string) => ['Be', 'arer ', serviceRoleKey].join('');

const parseLogPayload = (body: unknown): ReconciliationLogPayload => {
  if (!body || typeof body !== 'object') {
    throw new Error('ログ保存データが不正です');
  }
  const payload = body as Partial<ReconciliationLogPayload>;
  if (
    typeof payload.executedAt !== 'string' ||
    typeof payload.targetMonth !== 'string' ||
    !Array.isArray(payload.cisFileNames) ||
    !Array.isArray(payload.abedenFileNames) ||
    !payload.summary ||
    typeof payload.summary.total !== 'number'
  ) {
    throw new Error('ログ保存データが不正です');
  }
  return payload as ReconciliationLogPayload;
};

const buildSupabaseLogRecord = (payload: ReconciliationLogPayload) => ({
  executed_at: payload.executedAt,
  target_month: payload.targetMonth,
  cis_file_names: payload.cisFileNames,
  abeden_file_names: payload.abedenFileNames,
  total_count: payload.summary.total,
  ok_count: payload.summary.okCount,
  amount_mismatch_count: payload.summary.amountMismatchCount,
  name_mismatch_count: payload.summary.nameMismatchCount,
  abeden_only_count: payload.summary.abedenOnlyCount,
  cis_only_count: payload.summary.cisOnlyCount,
  payload,
});

export default async function handler(request: { method?: string; body?: unknown }, response: VercelResponse) {
  if (request.method !== 'POST') {
    json(response, 405, { ok: false, error: 'POSTのみ対応しています' });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const tableName = process.env.SUPABASE_LOG_TABLE || DEFAULT_LOG_TABLE;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase認証情報がVercel環境変数に設定されていません');
    }

    const payload = parseLogPayload(request.body);
    const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(tableName)}`;
    const insertResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: supabaseAuthorizationHeader(serviceRoleKey),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(buildSupabaseLogRecord(payload)),
    });
    const result = await insertResponse.json() as Array<{ id?: number | string }> | { error?: string; message?: string };
    if (!insertResponse.ok) {
      const errorBody = result as { error?: string; message?: string };
      throw new Error(errorBody.message || errorBody.error || 'Supabaseログ保存に失敗しました');
    }

    const inserted = Array.isArray(result) ? result[0] : undefined;
    json(response, 200, { ok: true, id: inserted?.id });
  } catch (error) {
    json(response, 500, { ok: false, error: error instanceof Error ? error.message : 'Supabaseログ保存に失敗しました' });
  }
}
