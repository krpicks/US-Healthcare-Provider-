import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { getFhirClient, mockFhirClient } from '../../../fhir';
import { settingsService } from '../../../services';
import type { FhirCommunication } from '../../../types';
import { notificationService, renderTemplateText } from '../notificationService';

const CTX = {
  tenantId: 'state-medicaid-a',
  tenantCode: 'STATE_A',
  correlationId: 'corr-m18-test',
};

describe('M18 Notifications & Correspondence', () => {
  beforeEach(() => {
    settingsService.reset();
    mockFhirClient.clearTenantStore(CTX.tenantId);
    notificationService.resetForTests();
  });

  it('automatically dispatches notifications on ExclusionHit and ReportabilityResponseReceived platform events', () => {
    eventBus.publish({
      type: 'ExclusionHit',
      tenantId: CTX.tenantId,
      sourceModule: 'M12',
      payload: {
        providerName: 'Dr. Jordan Patel',
        npi: '1234567893',
        reason: 'OIG LEIE match found',
        newStatus: 'Suspended',
      },
    });

    eventBus.publish({
      type: 'ReportabilityResponseReceived',
      tenantId: CTX.tenantId,
      sourceModule: 'M13',
      payload: {
        caseNumber: 'ECR-2026-009',
        determination: 'Reportable',
        patientId: 'pat-jane-doe',
        documentReferenceId: 'doc-rr-1',
      },
    });

    const deliveries = notificationService.getState(CTX.tenantId).deliveries;
    expect(deliveries.length).toBeGreaterThanOrEqual(2);
    expect(deliveries.some((d) => d.eventType === 'ExclusionHit' && d.body.includes('1234567893'))).toBe(true);
    expect(
      deliveries.some(
        (d) => d.eventType === 'ReportabilityResponseReceived' && d.subject.includes('ECR-2026-009'),
      ),
    ).toBe(true);
  });

  it('versions correspondence templates, renders merge variables, and tracks approval workflow', () => {
    const rendered = renderTemplateText('Hello {{providerName}} (NPI {{npi}})', {
      providerName: 'Dr. Priya Nair',
      npi: '1497758544',
    });
    expect(rendered).toBe('Hello Dr. Priya Nair (NPI 1497758544)');

    const v2 = notificationService.updateTemplateNewVersion(CTX.tenantId, 'tpl-approval', {
      subjectTemplate: 'Updated Approval for {{providerName}}',
      bodyTemplate: 'Effective {{effectiveDate}}, NPI {{npi}} is approved.',
    });
    expect(v2.version).toBe(2);
    expect(v2.approvalStatus).toBe('Draft');

    const approved = notificationService.approveTemplate(
      CTX.tenantId,
      'tpl-approval',
      'Robin Hayes (AgencyApprover)',
    );
    expect(approved.approvalStatus).toBe('Approved');
    expect(approved.approvedBy).toBe('Robin Hayes (AgencyApprover)');
  });

  it('persists FHIR Communication resources, simulates delivery failures, and transitions to Sent on retry', async () => {
    const failed = await notificationService.sendNotification(
      CTX,
      {
        templateId: 'tpl-rfi',
        channel: 'Email',
        recipient: 'provider@clinic.synthetic',
        variables: { providerName: 'Dr. Samira Vance', caseNumber: 'CASE-501' },
        simulateFailure: true,
      },
      { name: 'Enrollment Analyst', role: 'EnrollmentAnalyst' },
    );

    expect(failed.status).toBe('Failed');
    expect(failed.communicationId).toBeTruthy();

    const retried = await notificationService.retryDelivery(CTX, failed.id, {
      name: 'Enrollment Analyst',
      role: 'EnrollmentAnalyst',
    });
    expect(retried.status).toBe('Sent');
    expect(retried.retryCount).toBe(1);

    const storedComm = await getFhirClient().read<FhirCommunication>(
      CTX,
      'Communication',
      failed.communicationId!,
    );
    expect(storedComm.status).toBe('completed');
  });

  it('defers non-critical notifications during Quiet Hours while delivering Critical notices immediately', async () => {
    notificationService.updatePreferences(CTX.tenantId, {
      enabled: true,
      startHour: 22,
      endHour: 7,
      deferNonCritical: true,
      simulatedCurrentHour: 23,
    });

    const normal = await notificationService.sendNotification(
      CTX,
      {
        templateId: 'tpl-reval',
        channel: 'Portal',
        recipient: 'Dr. Lee',
        variables: { providerName: 'Dr. Lee', detail: 'License expiring in 60 days' },
        priority: 'Normal',
      },
      { name: 'Monitor Bot', role: 'TenantAdmin' },
    );
    expect(normal.status).toBe('Queued');

    const critical = await notificationService.sendNotification(
      CTX,
      {
        templateId: 'tpl-term',
        channel: 'Email',
        recipient: 'Dr. Lee',
        variables: {
          providerName: 'Dr. Lee',
          npi: '1234567893',
          status: 'Suspended',
          effectiveDate: '2026-11-25',
          reason: 'SAM Exclusion Match',
        },
        priority: 'Critical',
      },
      { name: 'PI Officer', role: 'ProgramIntegrityOfficer' },
    );
    expect(critical.status).toBe('Sent');
  });
});
