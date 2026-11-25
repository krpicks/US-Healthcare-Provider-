import { AppError } from '../types';

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG_RE = /<\/?[^>]+(>|$)/g;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type AllowedFileCategory = 'document' | 'data' | 'image';

const ALLOWED_EXTENSIONS_BY_CATEGORY: Record<AllowedFileCategory, string[]> = {
  document: ['.pdf'],
  image: ['.png', '.jpg', '.jpeg'],
  data: ['.json', '.csv', '.xml'],
};

const ALLOWED_MIME_BY_CATEGORY: Record<AllowedFileCategory, string[]> = {
  document: ['application/pdf'],
  image: ['image/png', 'image/jpeg'],
  data: ['application/json', 'text/csv', 'application/csv', 'application/xml', 'text/xml', 'text/plain'],
};

const BLOCKED_EXTENSIONS = [
  '.exe',
  '.dll',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.html',
  '.htm',
  '.svg',
  '.php',
];

/**
 * Sanitizes untrusted user/imported strings for safe plain-text display.
 * Removes script/style blocks, HTML tags, and non-printable control characters.
 */
export function sanitizeText(input: unknown, maxLength = 4000): string {
  if (input === null || input === undefined) {
    return '';
  }
  const raw = String(input);
  const cleaned = raw
    .replace(SCRIPT_STYLE_RE, '')
    .replace(HTML_TAG_RE, '')
    .replace(CONTROL_CHARS_RE, '')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

function stripDangerousKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDangerousKeys);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) {
        continue;
      }
      out[k] = stripDangerousKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Safely parses JSON with size limits, prototype-pollution stripping, and schema validation.
 */
export function parseAndValidateJson<T>(
  raw: string,
  validator?: (parsed: unknown) => parsed is T,
  options?: { maxBytes?: number; schemaLabel?: string },
): T {
  const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024; // 2 MB
  const label = options?.schemaLabel ?? 'JSON payload';

  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError({
      message: `${label} is empty.`,
      statusCode: 400,
      code: 'EMPTY_JSON',
    });
  }

  if (raw.length > maxBytes) {
    throw new AppError({
      message: `${label} exceeds maximum allowed size (${Math.round(maxBytes / 1024)} KB).`,
      statusCode: 400,
      code: 'JSON_TOO_LARGE',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError({
      message: `${label} contains invalid JSON syntax.`,
      statusCode: 400,
      code: 'INVALID_JSON',
    });
  }

  const sanitized = stripDangerousKeys(parsed);

  if (validator && !validator(sanitized)) {
    throw new AppError({
      message: `${label} failed schema validation.`,
      statusCode: 400,
      code: 'INVALID_JSON_SCHEMA',
    });
  }

  return sanitized as T;
}

export interface FileUploadCandidate {
  name: string;
  type?: string;
  size: number;
}

/**
 * Validates uploaded files against strict allowlists, blocked script/executable extensions,
 * and file size boundaries (default 10 MB).
 */
export function validateUploadedFile(
  file: FileUploadCandidate,
  categories: AllowedFileCategory[] = ['document', 'image', 'data'],
  maxBytes = 10 * 1024 * 1024,
): { extension: string; safeName: string } {
  const safeName = sanitizeText(file.name, 255);
  const lower = safeName.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  const extension = dotIdx >= 0 ? lower.slice(dotIdx) : '';

  if (!extension || BLOCKED_EXTENSIONS.includes(extension)) {
    throw new AppError({
      message: `Blocked or unsafe file extension "${extension || '(none)'}" for "${safeName}".`,
      statusCode: 400,
      code: 'UNSAFE_FILE_TYPE',
    });
  }

  const allowedExts = new Set(
    categories.flatMap((cat) => ALLOWED_EXTENSIONS_BY_CATEGORY[cat]),
  );
  const allowedMimes = new Set(
    categories.flatMap((cat) => ALLOWED_MIME_BY_CATEGORY[cat]),
  );

  if (!allowedExts.has(extension)) {
    throw new AppError({
      message: `Unsupported file type "${extension}". Allowed: ${Array.from(allowedExts).join(', ')}.`,
      statusCode: 400,
      code: 'UNSUPPORTED_FILE_TYPE',
    });
  }

  if (file.type && !allowedMimes.has(file.type.toLowerCase())) {
    throw new AppError({
      message: `MIME type "${file.type}" is not permitted for "${safeName}".`,
      statusCode: 400,
      code: 'UNSUPPORTED_MIME_TYPE',
    });
  }

  if (file.size <= 0) {
    throw new AppError({
      message: `File "${safeName}" is empty (0 bytes).`,
      statusCode: 400,
      code: 'EMPTY_FILE',
    });
  }

  if (file.size > maxBytes) {
    throw new AppError({
      message: `File "${safeName}" exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
      statusCode: 400,
      code: 'FILE_TOO_LARGE',
    });
  }

  return { extension, safeName };
}

export interface NormalizedError {
  message: string;
  code: string;
  statusCode: number;
  retryable: boolean;
}

/**
 * Produces a consistent, user-safe error summary without exposing stack traces or PHI.
 */
export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return {
      message: sanitizeText(err.message, 400),
      code: err.code ?? 'APP_ERROR',
      statusCode: err.statusCode ?? 400,
      retryable: err.statusCode >= 500 || err.statusCode === 429,
    };
  }
  if (err instanceof Error) {
    return {
      message: sanitizeText(err.message, 400) || 'An unexpected error occurred.',
      code: 'UNEXPECTED_ERROR',
      statusCode: 500,
      retryable: false,
    };
  }
  return {
    message: 'An unexpected error occurred.',
    code: 'UNKNOWN_ERROR',
    statusCode: 500,
    retryable: false,
  };
}
