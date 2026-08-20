import { describe, expect, it } from 'vitest';
import { isBasicAuthAuthorized } from '../basicAuth';

const basicHeader = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;

describe('isBasicAuthAuthorized', () => {
  it('環境変数のIDとパスワードが一致するBasic認証だけ許可する', () => {
    const env = { BASIC_AUTH_USER: 'user@example.com', BASIC_AUTH_PASSWORD: 'secret-pass' };

    expect(isBasicAuthAuthorized(basicHeader('user@example.com', 'secret-pass'), env)).toBe(true);
    expect(isBasicAuthAuthorized(basicHeader('user@example.com', 'wrong-pass'), env)).toBe(false);
    expect(isBasicAuthAuthorized(basicHeader('other@example.com', 'secret-pass'), env)).toBe(false);
  });

  it('認証ヘッダーまたは環境変数が不足している場合は許可しない', () => {
    expect(isBasicAuthAuthorized(null, { BASIC_AUTH_USER: 'user@example.com', BASIC_AUTH_PASSWORD: 'secret-pass' })).toBe(false);
    expect(isBasicAuthAuthorized('Bearer token', { BASIC_AUTH_USER: 'user@example.com', BASIC_AUTH_PASSWORD: 'secret-pass' })).toBe(false);
    expect(isBasicAuthAuthorized(basicHeader('user@example.com', 'secret-pass'), { BASIC_AUTH_USER: '', BASIC_AUTH_PASSWORD: 'secret-pass' })).toBe(false);
    expect(isBasicAuthAuthorized(basicHeader('user@example.com', 'secret-pass'), { BASIC_AUTH_USER: 'user@example.com', BASIC_AUTH_PASSWORD: '' })).toBe(false);
  });
});
