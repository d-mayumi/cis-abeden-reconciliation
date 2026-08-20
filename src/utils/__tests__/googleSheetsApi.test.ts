import { describe, expect, it, vi } from 'vitest';
import { buildGoogleJwtAssertion, normalizePrivateKey, writeValuesToGoogleSheet } from '../googleSheetsApi';

describe('Google Sheets API認証ヘルパー', () => {
  it('Vercel環境変数用の改行エスケープ付き秘密鍵をPEMへ戻す', () => {
    expect(normalizePrivateKey('-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n')).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
  });

  it('サービスアカウントJWTのclaimsにSheets scopeとissuerを含める', () => {
    const assertion = buildGoogleJwtAssertion({
      clientEmail: 'service-account@example.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      nowSeconds: 1_786_500_000,
      sign: () => 'signature',
    });
    const [, payload, signature] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));

    expect(claims.iss).toBe('service-account@example.iam.gserviceaccount.com');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/spreadsheets');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.iat).toBe(1_786_500_000);
    expect(claims.exp).toBe(1_786_503_600);
    expect(signature).toBe('signature');
  });

  it('gidからシート名を解決し、3行目以降の次の空き行へ値を追記する', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('fields=sheets')) {
        return new Response(JSON.stringify({ sheets: [{ properties: { sheetId: 54789944, title: '突合結果' } }] }), { status: 200 });
      }
      if (String(url).includes('/values/') && (String(url).includes('A:IV') || String(url).includes('A%3AIV'))) {
        return new Response(JSON.stringify({ values: [['請求先ID'], ['ヘッダー2'], ['既存1'], ['既存2']] }), { status: 200 });
      }
      if (String(url).includes(':batchUpdate')) {
        return new Response(JSON.stringify({ replies: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ updatedRange: '突合結果!A5:A6', updatedRows: 2 }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await writeValuesToGoogleSheet({
      accessToken: 'token',
      spreadsheetId: 'sheet-id',
      sheetGid: 54789944,
      values: [['A'], ['B']],
      format: { headerRowCount: 2, columnCount: 236, rowFormats: [{ rowIndex: 2, okColumns: [20], ngColumns: [19] }] },
      fetchImpl,
    });

    expect(result.updatedRows).toBe(2);
    expect(calls[0].url).toContain('/sheet-id?fields=sheets');
    expect(calls[1].url).toContain(encodeURIComponent('突合結果!A:IV'));
    expect(calls[2].url).toContain(encodeURIComponent('突合結果!A5'));
    expect(calls[2].url).toContain('valueInputOption=RAW');
    expect(calls[2].init?.method).toBe('PUT');
    expect(calls[2].init?.body).toBe(JSON.stringify({ values: [['A'], ['B']] }));
    expect(calls[3].url).toContain(':batchUpdate');
    expect(calls[3].init?.method).toBe('POST');
    expect(String(calls[3].init?.body)).toContain('repeatCell');
    expect(String(calls[3].init?.body)).toContain('autoResizeDimensions');
  });
});
