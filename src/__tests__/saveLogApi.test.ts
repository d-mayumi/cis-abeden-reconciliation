import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/save-log';

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

describe('save-log API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    delete process.env.SUPABASE_LOG_TABLE;
  });

  it('突合ログをSupabase REST APIへ保存する', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 123 }]), { status: 201 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const response = responseRecorder();

    await handler({ method: 'POST', body: {
      executedAt: '2026/08/12 16:40',
      targetMonth: '202606',
      cisFileNames: ['cis.csv'],
      abedenFileNames: ['abeden.xlsx'],
      summary: { total: 1, okCount: 0, amountMismatchCount: 1, nameMismatchCount: 0, abedenOnlyCount: 0, cisOnlyCount: 0 },
    } }, response);

    expect(fetchMock).toHaveBeenCalledWith('https://example.supabase.co/rest/v1/reconciliation_logs', expect.objectContaining({ method: 'POST' }));
    const [, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(init?.headers).toEqual(expect.objectContaining({
      apikey: 'service-role-key',
      Authorization: 'Bearer service-role-key',
      Prefer: 'return=representation',
    }));
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      executed_at: '2026/08/12 16:40',
      target_month: '202606',
      cis_file_names: ['cis.csv'],
      abeden_file_names: ['abeden.xlsx'],
      total_count: 1,
      amount_mismatch_count: 1,
      payload: expect.objectContaining({ summary: expect.objectContaining({ total: 1 }) }),
    }));
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, id: 123 });
  });
});
