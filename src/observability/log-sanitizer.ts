/** Minimal, dependency-free protection for structured application logs. */
const REDACTED = '[redacted]';
const SENSITIVE_KEYS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'setcookie',
  'password', 'passwordhash', 'passphrase', 'secret', 'clientsecret',
  'accesstoken', 'refreshtoken', 'idtoken', 'token', 'apikey',
  'xapikey', 'smtpurl', 'privatekey', 'sessionid', 'sessiontoken',
  'creditcard', 'cardnumber',
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Also redact credentials embedded in error messages/URL strings. */
export function redactLogText(input: string): string {
  return input
    .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;]+/gi,
      (_match, prefix: string) => prefix + REDACTED)
    .replace(/(^|[\s?&;])((?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|client[_-]?secret|password|passphrase|secret|code|session[_-]?id))=([^\s&#;]+)/gi,
      (_match, prefix: string, key: string) => prefix + key + '=' + REDACTED);
}

export function sanitizeLogValue(value: unknown, includeErrorStack = false, depth = 0): unknown {
  if (depth > 4) return '[max-depth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogText(value.message),
      stack: includeErrorStack ? redactLogText(value.stack ?? '') : undefined,
    };
  }
  if (typeof value === 'string') return redactLogText(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeLogValue(entry, includeErrorStack, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEYS.has(normalizeKey(key))
      ? REDACTED
      : sanitizeLogValue(entry, includeErrorStack, depth + 1);
  }
  return output;
}
