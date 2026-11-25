import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../types';
import {
  INTEROP_KNOWLEDGE_BASE,
  SAMPLE_OPERATION_OUTCOME,
  diagnosticsService,
  maskSecretsInObject,
} from '../diagnosticsService';

const TENANT_ID = 'state-medicaid-a';

describe('M20 Diagnostics & Troubleshooting', () => {
  beforeEach(() => {
    diagnosticsService.resetForTests();
  });

  it('classifies all 8 connectivity failure categories accurately', () => {
    expect(
      diagnosticsService.classifyConnectivityFailure({ httpStatus: 401 }).classification,
    ).toBe('401 / 403 Auth');
    expect(
      diagnosticsService.classifyConnectivityFailure({ httpStatus: 404 }).classification,
    ).toBe('404 Not Found');
    expect(
      diagnosticsService.classifyConnectivityFailure({ httpStatus: 503 }).classification,
    ).toBe('5xx Server Error');
    expect(
      diagnosticsService.classifyConnectivityFailure({
        httpStatus: 200,
        responseBodySnippet: '<html><body>Not FHIR</body></html>',
      }).classification,
    ).toBe('Not a FHIR Server');
    expect(
      diagnosticsService.classifyConnectivityFailure({ errorMessage: 'Request timeout aborted' })
        .classification,
    ).toBe('Timeout');
    expect(
      diagnosticsService.classifyConnectivityFailure({ errorMessage: 'ERR_CERT_AUTHORITY_INVALID TLS' })
        .classification,
    ).toBe('TLS / Certificate');
    expect(
      diagnosticsService.classifyConnectivityFailure({ errorMessage: 'TypeError: Failed to fetch (CORS)' })
        .classification,
    ).toBe('CORS Blocked');
    expect(
      diagnosticsService.classifyConnectivityFailure({ errorMessage: 'ECONNREFUSED 127.0.0.1:8081' })
        .classification,
    ).toBe('Refused / DNS');
  });

  it('provides all 10 interoperability knowledge base articles and ranks symptom matches', () => {
    expect(INTEROP_KNOWLEDGE_BASE).toHaveLength(10);

    const portResults = diagnosticsService.searchKnowledgeBase('port 8080 ecrnow hapi');
    expect(portResults[0]?.id).toBe('kb-port-8080');

    const urnResults = diagnosticsService.searchKnowledgeBase('urn:uuid transaction bundle');
    expect(urnResults[0]?.id).toBe('kb-urn-uuid');

    const dockerResults = diagnosticsService.searchKnowledgeBase('host.docker.internal localhost');
    expect(dockerResults[0]?.id).toBe('kb-docker-localhost');
  });

  it('explains FHIR OperationOutcome JSON issues in plain English and rejects invalid inputs', () => {
    const explained = diagnosticsService.explainOperationOutcome(SAMPLE_OPERATION_OUTCOME);
    expect(explained).toHaveLength(3);
    expect(explained[0]?.relatedKbId).toBe('kb-inferno-profile');
    expect(explained[1]?.relatedKbId).toBe('kb-urn-uuid');
    expect(explained[2]?.relatedKbId).toBe('kb-422-validation');

    expect(() => diagnosticsService.explainOperationOutcome('{invalid-json')).toThrow(AppError);
    expect(() =>
      diagnosticsService.explainOperationOutcome(JSON.stringify({ resourceType: 'Patient' })),
    ).toThrow(AppError);
  });

  it('masks secrets/tokens/SSNs in support bundles and exports troubleshooting logs as Markdown', () => {
    const masked = maskSecretsInObject({
      apiKey: 'super-secret-123',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
      nested: {
        note: 'Header Bearer abc.def.ghi and SSN 123-45-6789',
        clientSecret: 'do-not-leak',
      },
    });
    expect(masked.apiKey).toBe('***REDACTED***');
    expect(masked.authorization).toBe('***REDACTED***');
    expect(masked.nested.clientSecret).toBe('***REDACTED***');
    expect(masked.nested.note).not.toContain('123-45-6789');
    expect(masked.nested.note).not.toContain('abc.def.ghi');

    const bundle = diagnosticsService.buildMaskedSupportBundle(TENANT_ID, {
      clientSecret: 'top-secret',
    });
    expect(JSON.stringify(bundle)).not.toContain('top-secret');

    diagnosticsService.addTroubleshootingLogEntry(TENANT_ID, {
      symptom: 'Port 8080 clash on startup',
      actionTaken: 'Remapped HAPI FHIR to port 8081:8080',
      outcome: 'Resolved',
    });
    const md = diagnosticsService.exportTroubleshootingLogMarkdown(TENANT_ID);
    expect(md).toContain('# ProviderLink Troubleshooting Log');
    expect(md).toContain('[Resolved] Port 8080 clash on startup');
  });
});
