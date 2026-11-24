import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLogValue, redactLogText } from '../src/observability/log-sanitizer.ts';

test('redacts mixed-case and punctuated sensitive keys recursively', () => {
  const actual = sanitizeLogValue({
    Authorization: 'Bearer abc',
    'X-API-KEY': 'client-secret',
    headers: { COOKIE: 'session=123', 'Set-Cookie': ['a=b'] },
    nested: [{ refresh_token: 'refresh-raw', passwordHash: 'hash' }],
    requestId: 'req-123', status: 401,
  });
  assert.deepEqual(actual, {
    Authorization: '[redacted]', 'X-API-KEY': '[redacted]',
    headers: { COOKIE: '[redacted]', 'Set-Cookie': '[redacted]' },
    nested: [{ refresh_token: '[redacted]', passwordHash: '[redacted]' }],
    requestId: 'req-123', status: 401,
  });
});

test('sanitizes sensitive query values in URL and error strings', () => {
  const input = 'GET /auth/callback?code=xy9&state=public&access_token=topsecret';
  const output = redactLogText(input);
  assert.ok(!output.includes('xy9'));
  assert.ok(!output.includes('topsecret'));
  assert.ok(output.includes('state=public'));
});

test('redacts Bearer and Basic tokens in error messages', () => {
  const result = redactLogText('Authorization: Bearer secret123, Authorization: Basic YWJj');
  assert.ok(!result.includes('secret123'));
  assert.ok(!result.includes('YWJj'));
});

test('production Error objects suppress stack, nonproduction stack gets sanitized', () => {
  const error = new Error('bad https://example.com/?api_key=mykey&safe=1');
  const production = sanitizeLogValue({ error }, false);
  assert.equal(production.error.stack, undefined);
  assert.ok(!JSON.stringify(production).includes('mykey'));
  const development = sanitizeLogValue({ error }, true);
  assert.ok(!JSON.stringify(development).includes('mykey'));
  assert.ok(development.error.stack?.includes('[redacted]'));
});

test('normal diagnostic fields and nonstring primitives remain available', () => {
  assert.deepEqual(sanitizeLogValue({ route: '/health', durationMs: 2.14, ok: true, data: null }),
    { route: '/health', durationMs: 2.14, ok: true, data: null });
});

test('bounds cyclic graphs and nested arrays', () => {
  const cycle = {}; cycle.self = cycle;
  const output = sanitizeLogValue(cycle);
  assert.equal(output.self.self.self.self.self, '[max-depth]');
});

test('redacts database URL userinfo and sensitive HTTP header values', () => {
  const log = 'database error postgres://service:db-password@db.internal:5432/app\nCookie: session=secret-cookie\nProxy-Authorization: Basic protected-credential';
  const sanitized = redactLogText(log);
  assert.ok(!sanitized.includes('db-password'));
  assert.ok(!sanitized.includes('secret-cookie'));
  assert.ok(!sanitized.includes('protected-credential'));
  assert.ok(sanitized.includes('db.internal:5432'));
});

test('redacts URL-encoded passwords in connection URI userinfo', () => {
  const log = 'timeout at rediss://worker:%40private%3Fvalue@cache.local:6379';
  const sanitized = redactLogText(log);
  assert.ok(!sanitized.includes('%40private%3Fvalue'));
  assert.ok(sanitized.includes('cache.local:6379'));
});
