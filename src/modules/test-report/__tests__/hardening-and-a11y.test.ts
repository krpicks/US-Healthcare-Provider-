import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OfflineBanner } from '../../../components/OfflineBanner';
import { SkipLink } from '../../../components/SkipLink';
import { computeVirtualWindow } from '../../../components/ui/VirtualTable';
import { AppError } from '../../../types';
import {
  normalizeError,
  parseAndValidateJson,
  sanitizeText,
  validateUploadedFile,
} from '../../../utils/hardening';

describe('Phase 5 Production Hardening, Performance & Accessibility', () => {
  it('sanitizes untrusted HTML, script tags, and control characters safely', () => {
    const dirty =
      'Hello <script>alert("xss")</script><b>Provider</b>\u0000\u0007 <img src=x onerror=evil() />';
    const clean = sanitizeText(dirty);
    expect(clean).toBe('Hello Provider');
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('onerror');
  });

  it('validates JSON imports with size limits, prototype-pollution stripping, and schema checks', () => {
    const rawWithProto =
      '{"name":"Safe","__proto__":{"polluted":true},"nested":{"constructor":"bad","ok":1}}';
    const parsed = parseAndValidateJson<{ name: string; nested: { ok: number } }>(
      rawWithProto,
      (v): v is { name: string; nested: { ok: number } } =>
        Boolean(v && typeof v === 'object' && 'name' in v),
    );
    expect(parsed.name).toBe('Safe');
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed.nested, 'constructor')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    expect(() => parseAndValidateJson('{bad json')).toThrow(AppError);
    expect(() =>
      parseAndValidateJson('{"x":1}', undefined, { maxBytes: 4 }),
    ).toThrow(/exceeds maximum/);
  });

  it('enforces restricted file type allowlists, blocks scripts/executables, and caps file size', () => {
    const okPdf = validateUploadedFile({
      name: 'medical_license.pdf',
      type: 'application/pdf',
      size: 2048,
    });
    expect(okPdf.extension).toBe('.pdf');

    expect(() =>
      validateUploadedFile({ name: 'payload.html', type: 'text/html', size: 512 }),
    ).toThrow(/Blocked or unsafe/);
    expect(() =>
      validateUploadedFile({ name: 'icon.svg', type: 'image/svg+xml', size: 512 }),
    ).toThrow(/Blocked or unsafe/);
    expect(() =>
      validateUploadedFile({ name: 'malware.exe', type: 'application/octet-stream', size: 512 }),
    ).toThrow(/Blocked or unsafe/);
    expect(() =>
      validateUploadedFile({
        name: 'huge.pdf',
        type: 'application/pdf',
        size: 12 * 1024 * 1024,
      }),
    ).toThrow(/10 MB/);
  });

  it('normalizes AppError and unknown runtime exceptions consistently without leaking raw markup', () => {
    const appErr = normalizeError(
      new AppError({ message: '<b>503</b> Gateway unavailable', statusCode: 503, code: 'GW_DOWN' }),
    );
    expect(appErr).toEqual({
      message: '503 Gateway unavailable',
      code: 'GW_DOWN',
      statusCode: 503,
      retryable: true,
    });

    const unknownErr = normalizeError('raw string');
    expect(unknownErr.statusCode).toBe(500);
    expect(unknownErr.code).toBe('UNKNOWN_ERROR');
  });

  it('computes accurate virtualized table windows for large datasets (10,000 rows)', () => {
    const win = computeVirtualWindow(10_000, 4400, 440, 44, 5);
    // ScrollTop 4400 / 44 = row 100; viewport fits 10 rows; overscan 5 -> [95, 115)
    expect(win.startIndex).toBe(95);
    expect(win.endIndex).toBe(115);
    expect(win.topSpacerPx).toBe(95 * 44);
    expect(win.bottomSpacerPx).toBe((10_000 - 115) * 44);
  });

  it('renders WCAG 2.1 AA landmarks and live status attributes on OfflineBanner and SkipLink', () => {
    const offlineHtml = renderToStaticMarkup(
      createElement(OfflineBanner, { forcedOffline: true }),
    );
    expect(offlineHtml).toContain('role="status"');
    expect(offlineHtml).toContain('aria-live="polite"');
    expect(offlineHtml).toContain('Mock mode remains fully operational');

    const onlineHtml = renderToStaticMarkup(
      createElement(OfflineBanner, { forcedOffline: false }),
    );
    expect(onlineHtml).toBe('');

    const skipHtml = renderToStaticMarkup(createElement(SkipLink));
    expect(skipHtml).toContain('href="#main-content"');
    expect(skipHtml).toContain('Skip to main content');
  });
});
