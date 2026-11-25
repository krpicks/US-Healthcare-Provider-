import { beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../events';
import { mockFhirClient } from '../../../fhir';
import { seedTenantFhirData } from '../../../mock-data';
import { buildValidNpi } from '../../../rules';
import { settingsService } from '../../../services';
import { providerService } from '../../m3-directory/providerService';
import {
  computeSha256Hex,
  createBlankApplication,
  enrollmentService,
} from '../enrollmentService';

describe('M5 Enrollment Application Wizard', () => {
  const ctx = { tenantId: 'tenant-state-medicaid', tenantCode: 'state-medicaid-a' };
  const actor = { name: 'Dr. Nina Patel', role: 'ProviderUser' as const };

  beforeEach(async () => {
    settingsService.reset();
    enrollmentService.resetForTests();
    eventBus.clearHistory();
    mockFhirClient.clearTenantStore(ctx.tenantId);
    await seedTenantFhirData(mockFhirClient, ctx, true);
  });

  it('validates MIME type and 10 MB limit, hashes with SHA-256, and persists FHIR DocumentReference', async () => {
    const hash = await computeSha256Hex('synthetic-license-bytes');
    expect(hash).toHaveLength(64);

    await expect(
      enrollmentService.uploadDocument(
        ctx,
        'app-1',
        'State Medical License',
        { name: 'bad.exe', type: 'application/octet-stream', size: 1024, content: 'x' },
        actor,
      ),
    ).rejects.toThrow(/Unsupported file type/);

    await expect(
      enrollmentService.uploadDocument(
        ctx,
        'app-1',
        'State Medical License',
        { name: 'huge.pdf', type: 'application/pdf', size: 11 * 1024 * 1024, content: 'x' },
        actor,
      ),
    ).rejects.toThrow(/10 MB/);

    const uploaded = await enrollmentService.uploadDocument(
      ctx,
      'app-1',
      'State Medical License',
      { name: 'license.pdf', type: 'application/pdf', size: 4096, content: 'valid-pdf-content' },
      actor,
    );
    expect(uploaded.status).toBe('Uploaded');
    expect(uploaded.sha256).toHaveLength(64);
    expect(uploaded.documentReferenceId).toBeTruthy();
  });

  it('submits a complete 12-step application creating QuestionnaireResponse + Task and emitting ProviderSubmitted', async () => {
    const npi = buildValidNpi('139876543');
    const draft = createBlankApplication(ctx.tenantId, {
      applicantGiven: 'Nina',
      applicantFamily: 'Patel',
      applicantEmail: 'n.patel@med.synthetic',
      applicantPhone: '518-555-0199',
      npi,
      organizationName: 'Hudson Primary Care LLC',
      tin: '47-1234567',
      licenseNumber: 'NY-884122',
      licenseState: 'NY',
      taxonomyCode: '207Q00000X',
      locations: [
        {
          id: 'loc-1',
          clinicName: 'Hudson Clinic',
          street: '50 State St',
          city: 'Albany',
          state: 'NY',
          postalCode: '12207',
          phone: '518-555-0199',
          hours: 'Mon-Fri 08:00-17:00',
          acceptingNewPatients: true,
        },
      ],
      attestedTruthful: true,
      attestedCompliance: true,
      eSignatureName: 'Dr. Nina Patel',
      feeStatus: 'Paid',
    });

    draft.documents = draft.documents.map((d) => ({
      ...d,
      status: 'Uploaded',
      fileName: `${d.requirementName}.pdf`,
      sha256: 'a'.repeat(64),
    }));

    const submitted = await enrollmentService.submitApplication(ctx, draft, actor);
    expect(submitted.status).toBe('Submitted');
    expect(submitted.questionnaireResponseId).toBeTruthy();
    expect(submitted.taskId).toBeTruthy();

    const qr = await mockFhirClient.read(ctx, 'QuestionnaireResponse', submitted.questionnaireResponseId!);
    expect(qr.resourceType).toBe('QuestionnaireResponse');

    const events = eventBus.getHistory(ctx.tenantId);
    expect(events.some((e) => e.type === 'ProviderSubmitted')).toBe(true);
  });

  it('allows applicant to respond to an open RFI and resumes case into In Review', async () => {
    const apps = enrollmentService.listApplications(ctx.tenantId);
    const rfiApp = apps.find((a) => a.status === 'RFI Issued');
    expect(rfiApp).toBeDefined();
    const openRfi = rfiApp!.rfis[0];

    const updated = await enrollmentService.respondToRfi(
      ctx,
      rfiApp!.id,
      openRfi.id,
      'Uploaded updated malpractice COI.',
      undefined,
      actor,
    );
    expect(updated.status).toBe('In Review');
    expect(updated.rfis[0].status).toBe('Responded');
  });

  it('pre-fills a Revalidation draft from an existing M3 provider for M12 reuse', async () => {
    const providers = await providerService.listProviders(ctx);
    const draft = enrollmentService.createRevalidationDraftFromProvider(
      ctx.tenantId,
      providers[0],
      'Revalidation',
    );
    expect(draft.applicationType).toBe('Revalidation');
    expect(draft.npi).toBe(providers[0].npi);
    expect(draft.status).toBe('Draft');
  });
});
