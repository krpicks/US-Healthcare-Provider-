import { beforeEach, describe, expect, it } from 'vitest';
import { mockFhirClient } from '../../../fhir';
import { auditService, settingsService } from '../../../services';
import { AppError } from '../../../types';
import { securityService } from '../securityService';

const CTX = {
  tenantId: 'state-medicaid-a',
  tenantCode: 'STATE_A',
  correlationId: 'corr-m17-test',
};

describe('M17 Security, Privacy & Compliance', () => {
  beforeEach(() => {
    settingsService.reset();
    mockFhirClient.clearTenantStore(CTX.tenantId);
    securityService.resetForTests();
  });

  it('enforces SMART scope toggles and throws 403 AppError when a required scope is revoked', async () => {
    expect(() =>
      securityService.assertSmartScope(CTX.tenantId, 'system/Consent.write'),
    ).not.toThrow();

    securityService.toggleSmartScope(CTX.tenantId, 'system/Consent.write', false);

    expect(() =>
      securityService.assertSmartScope(CTX.tenantId, 'system/Consent.write'),
    ).toThrow(AppError);

    await expect(
      securityService.saveConsentDirective(
        CTX,
        {
          patientId: 'pat-1',
          patientName: 'Jane Doe',
          provisionType: 'deny',
          securityLabels: ['PSY'],
        },
        { name: 'Admin', role: 'TenantAdmin' },
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'INSUFFICIENT_SCOPE' });
  });

  it('allows audited PII unmask for authorized roles (Auditor) and rejects unauthorized roles (ProviderUser)', async () => {
    await expect(
      securityService.requestAuditedUnmask(
        CTX,
        {
          targetId: 'pat-jane',
          fieldLabel: 'SSN',
          rawValue: '123-45-6789',
          kind: 'ssn',
          reason: 'Verification check',
        },
        { name: 'Dr. Provider', role: 'ProviderUser' },
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'UNMASK_FORBIDDEN' });

    const res = await securityService.requestAuditedUnmask(
      CTX,
      {
        targetId: 'pat-jane',
        fieldLabel: 'SSN',
        rawValue: '123-45-6789',
        kind: 'ssn',
        reason: 'Quarterly Medicaid compliance audit',
      },
      { name: 'Chief Auditor', role: 'Auditor' },
    );

    expect(res.auditRecorded).toBe(true);
    expect(res.unmasked).toBe('123-45-6789');
    expect(res.masked).not.toBe('123-45-6789');

    const audits = await auditService.list(CTX);
    expect(
      audits.some(
        (a) =>
          a.outcomeDesc?.includes('Audited unmask of SSN') &&
          a.agent?.[0]?.name === 'Chief Auditor',
      ),
    ).toBe(true);
  });

  it('hides sensitive PSY/ETH records under active FHIR Consent and reveals them with audited Break-Glass override', async () => {
    const before = securityService.getVisibleSensitiveRecords(CTX.tenantId);
    expect(before.restrictedLabels).toContain('PSY');
    expect(before.restrictedLabels).toContain('ETH');
    expect(before.hiddenCount).toBe(2);
    expect(before.visible.every((r) => r.securityLabel === 'N')).toBe(true);

    const session = await securityService.activateBreakGlass(
      CTX,
      {
        reason: 'Emergency ED behavioral health consultation',
        durationMinutes: 15,
      },
      { name: 'Compliance Officer', role: 'ProgramIntegrityOfficer' },
    );
    expect(session.active).toBe(true);
    expect(securityService.isBreakGlassActive(CTX.tenantId)).toBe(true);

    const during = securityService.getVisibleSensitiveRecords(CTX.tenantId);
    expect(during.hiddenCount).toBe(0);
    expect(during.visible.length).toBe(3);

    securityService.revokeBreakGlass(CTX.tenantId);
    expect(securityService.isBreakGlassActive(CTX.tenantId)).toBe(false);
    expect(securityService.getVisibleSensitiveRecords(CTX.tenantId).hiddenCount).toBe(2);
  });

  it('updates HIPAA technical safeguards, certifies/revokes access reviews with AuditEvent, and toggles legal hold', async () => {
    const updatedSafeguard = securityService.updateSafeguard(CTX.tenantId, 'hipaa-4', {
      status: 'Compliant',
    });
    expect(updatedSafeguard.status).toBe('Compliant');

    const certified = await securityService.decideAccessReview(
      CTX,
      'ar-1',
      'Certified',
      { name: 'Alex Morgan', role: 'TenantAdmin' },
    );
    expect(certified.reviewStatus).toBe('Certified');
    expect(certified.reviewedBy).toContain('Alex Morgan');

    const revoked = await securityService.decideAccessReview(
      CTX,
      'ar-2',
      'Revoked',
      { name: 'Alex Morgan', role: 'TenantAdmin' },
    );
    expect(revoked.reviewStatus).toBe('Revoked');

    const ret = securityService.updateRetentionPolicy(CTX.tenantId, {
      legalHoldActive: true,
      legalHoldMatter: 'OIG Inquiry 2026-44',
    });
    expect(ret.legalHoldActive).toBe(true);
    expect(ret.legalHoldMatter).toBe('OIG Inquiry 2026-44');
  });
});
