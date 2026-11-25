import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveFhirClient } from '../LiveFhirClient';
import { MockFhirClient } from '../MockFhirClient';
import { fhirRequestLog } from '../requestLog';
import type {
  FhirBundle,
  FhirEncounter,
  FhirOperationOutcome,
  FhirPatient,
  FhirPractitioner,
} from '../../types';

describe('M2 FHIR Connectivity — MockFhirClient & LiveFhirClient', () => {
  const ctxA = { tenantId: 'tenant-a', tenantCode: 'tenant-a-code' };
  const ctxB = { tenantId: 'tenant-b', tenantCode: 'tenant-b-code' };
  let mockClient: MockFhirClient;

  beforeEach(() => {
    mockClient = new MockFhirClient();
    fhirRequestLog.clear();
  });

  it('performs full CRUD, versioning, vread, history, patch, and conditionalCreate', async () => {
    const created = await mockClient.create<FhirPatient>(ctxA, {
      resourceType: 'Patient',
      active: true,
      identifier: [{ system: 'http://providerlink.local/sid/mrn', value: 'MRN-777' }],
      name: [{ family: 'Smith', given: ['Alice'], text: 'Alice Smith' }],
      birthDate: '1988-03-14',
    });
    expect(created.id).toBeTruthy();
    expect(created.meta?.versionId).toBe('1');

    const updated = await mockClient.update<FhirPatient>(ctxA, {
      ...created,
      active: false,
    });
    expect(updated.meta?.versionId).toBe('2');

    const v1 = await mockClient.vread<FhirPatient>(ctxA, 'Patient', created.id!, '1');
    expect(v1.active).toBe(true);

    const history = await mockClient.history(ctxA, 'Patient', created.id!);
    expect(history.total).toBe(2);

    const patched = await mockClient.patch<FhirPatient>(ctxA, 'Patient', created.id!, [
      { op: 'replace', path: '/active', value: true },
    ]);
    expect(patched.active).toBe(true);
    expect(patched.meta?.versionId).toBe('3');

    // Conditional create returns existing resource when MRN matches
    const cond = await mockClient.conditionalCreate<FhirPatient>(
      ctxA,
      {
        resourceType: 'Patient',
        identifier: [{ system: 'http://providerlink.local/sid/mrn', value: 'MRN-777' }],
        name: [{ family: 'Duplicate' }],
      },
      { identifier: 'http://providerlink.local/sid/mrn|MRN-777' },
    );
    expect(cond.created).toBe(false);
    expect(cond.resource.id).toBe(created.id);

    await mockClient.delete(ctxA, 'Patient', created.id!);
    await expect(mockClient.read(ctxA, 'Patient', created.id!)).rejects.toThrow();
  });

  it('supports token, string, date prefixes, _sort, _count paging, _summary=count, _include, and _revinclude', async () => {
    const p1 = await mockClient.create<FhirPatient>(ctxA, {
      resourceType: 'Patient',
      identifier: [{ system: 'http://mrn', value: 'M-1' }],
      name: [{ family: 'Adams', given: ['Zoe'], text: 'Zoe Adams' }],
      birthDate: '1980-01-10',
    });
    await mockClient.create<FhirPatient>(ctxA, {
      resourceType: 'Patient',
      identifier: [{ system: 'http://mrn', value: 'M-2' }],
      name: [{ family: 'Brown', given: ['Liam'], text: 'Liam Brown' }],
      birthDate: '1995-06-20',
    });
    await mockClient.create<FhirPatient>(ctxA, {
      resourceType: 'Patient',
      identifier: [{ system: 'http://mrn', value: 'M-3' }],
      name: [{ family: 'Clark', given: ['Maya'], text: 'Maya Clark' }],
      birthDate: '2002-11-05',
    });

    await mockClient.create<FhirEncounter>(ctxA, {
      resourceType: 'Encounter',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: { reference: `Patient/${p1.id}` },
      period: { start: '2026-05-01' },
    });

    const tokenRes = await mockClient.search<FhirPatient>(ctxA, 'Patient', {
      identifier: 'http://mrn|M-2',
    });
    expect(tokenRes.resources).toHaveLength(1);
    expect(tokenRes.resources[0].name?.[0]?.family).toBe('Brown');

    const dateRes = await mockClient.search<FhirPatient>(ctxA, 'Patient', {
      birthdate: 'ge1990-01-01',
    });
    expect(dateRes.resources).toHaveLength(2);

    const summaryRes = await mockClient.search<FhirPatient>(ctxA, 'Patient', {
      _summary: 'count',
    });
    expect(summaryRes.total).toBe(3);
    expect(summaryRes.resources).toHaveLength(0);

    const page1 = await mockClient.search<FhirPatient>(ctxA, 'Patient', {
      _count: 2,
      _sort: 'name',
    });
    expect(page1.resources).toHaveLength(2);
    expect(page1.hasNext).toBe(true);
    const page2 = await page1.nextPage!();
    expect(page2.resources).toHaveLength(1);
    expect(page2.hasNext).toBe(false);

    const incRes = await mockClient.search(ctxA, 'Encounter', {
      _include: 'Encounter:patient',
    });
    expect(incRes.bundle.entry?.some((e) => e.resource?.resourceType === 'Patient')).toBe(true);

    const revRes = await mockClient.search(ctxA, 'Patient', {
      _id: p1.id,
      _revinclude: 'Encounter:patient',
    });
    expect(revRes.bundle.entry?.some((e) => e.resource?.resourceType === 'Encounter')).toBe(true);
  });

  it('executes atomic transactions with urn:uuid resolution and rolls back on failure', async () => {
    const patUrn = 'urn:uuid:tx-pat-1';
    const tx: FhirBundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: patUrn,
          resource: {
            resourceType: 'Patient',
            name: [{ family: 'Atomic', given: ['Pat'] }],
          },
          request: { method: 'POST', url: 'Patient' },
        },
        {
          fullUrl: 'urn:uuid:tx-enc-1',
          resource: {
            resourceType: 'Encounter',
            status: 'finished',
            class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
            subject: { reference: patUrn },
          },
          request: { method: 'POST', url: 'Encounter' },
        },
      ],
    };

    const resp = await mockClient.transaction(ctxA, tx);
    expect(resp.type).toBe('transaction-response');
    const createdPat = resp.entry?.[0]?.resource as FhirPatient;
    const createdEnc = resp.entry?.[1]?.resource as FhirEncounter;
    expect(createdEnc.subject?.reference).toBe(`Patient/${createdPat.id}`);

    // Failing transaction should rollback entry 0
    const badTx: FhirBundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: { resourceType: 'Patient', name: [{ family: 'ShouldRollback' }] },
          request: { method: 'POST', url: 'Patient' },
        },
        {
          request: { method: 'GET', url: 'Patient/non-existent-id' },
        },
      ],
    };
    await expect(mockClient.transaction(ctxA, badTx)).rejects.toThrow();
    const afterRollback = await mockClient.search<FhirPatient>(ctxA, 'Patient', {
      name: 'ShouldRollback',
    });
    expect(afterRollback.resources).toHaveLength(0);
  });

  it('validates resources via $validate and supports Patient $everything with strict tenant isolation', async () => {
    const outcome = await mockClient.operation<FhirOperationOutcome>(ctxA, '$validate', {
      resourceType: 'Encounter',
      resource: {
        resourceType: 'Encounter',
        status: 'invalid-status' as FhirEncounter['status'],
        class: { code: 'AMB' },
        subject: { reference: 'Patient/missing-patient' },
      },
    });
    expect(outcome.issue.some((i) => i.severity === 'error')).toBe(true);

    // Tenant A vs Tenant B isolation
    const pracA = await mockClient.create<FhirPractitioner>(ctxA, {
      resourceType: 'Practitioner',
      name: [{ family: 'TenantAOnly' }],
    });
    await expect(mockClient.read(ctxB, 'Practitioner', pracA.id!)).rejects.toThrow();

    // $everything
    const pat = await mockClient.create<FhirPatient>(ctxA, {
      resourceType: 'Patient',
      name: [{ family: 'EverythingTest' }],
    });
    await mockClient.create<FhirEncounter>(ctxA, {
      resourceType: 'Encounter',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: { reference: `Patient/${pat.id}` },
    });
    const everything = await mockClient.operation<FhirBundle>(ctxA, '$everything', {
      resourceType: 'Patient',
      id: pat.id,
    });
    expect(everything.total).toBe(2);
  });

  it('LiveFhirClient retries 429/503 with backoff, parses OperationOutcome, and verifies FHIR 4.0.1', async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/metadata')) {
        return new Response(
          JSON.stringify({
            resourceType: 'CapabilityStatement',
            status: 'active',
            date: '2026-01-01',
            kind: 'instance',
            fhirVersion: '4.0.1',
            format: ['application/fhir+json'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/fhir+json' } },
        );
      }

      if (url.includes('/Patient/error-case')) {
        return new Response(
          JSON.stringify({
            resourceType: 'OperationOutcome',
            issue: [
              {
                severity: 'error',
                code: 'not-found',
                diagnostics: 'Patient/error-case does not exist on server',
              },
            ],
          }),
          { status: 404, headers: { 'Content-Type': 'application/fhir+json' } },
        );
      }

      attempts += 1;
      if (attempts < 3) {
        return new Response('Rate limited', { status: 429 });
      }
      return new Response(
        JSON.stringify({ resourceType: 'Patient', id: 'live-1' }),
        { status: 200, headers: { 'Content-Type': 'application/fhir+json' } },
      );
    }) as unknown as typeof fetch;

    const live = new LiveFhirClient({
      baseUrl: 'http://localhost:8081/fhir',
      partitionStrategy: 'path',
      baseBackoffMs: 5,
      maxRetries: 3,
      fetchImpl: mockFetch,
    });

    const capCheck = await live.verifyFhirVersion(ctxA);
    expect(capCheck.ok).toBe(true);
    expect(capCheck.fhirVersion).toBe('4.0.1');

    const pat = await live.read<FhirPatient>(ctxA, 'Patient', 'live-1');
    expect(pat.id).toBe('live-1');
    expect(attempts).toBe(3);

    await expect(live.read(ctxA, 'Patient', 'error-case')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Patient/error-case does not exist on server',
    });
  });
});
