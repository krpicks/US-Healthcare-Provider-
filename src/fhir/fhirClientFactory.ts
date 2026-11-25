import { settingsService } from '../services/settingsService';
import type { FhirClient } from './FhirClient';
import { LiveFhirClient } from './LiveFhirClient';
import { MockFhirClient } from './MockFhirClient';

export const mockFhirClient = new MockFhirClient();
export const liveFhirClient = new LiveFhirClient();

export function getFhirClient(overrideMode?: 'mock' | 'live'): FhirClient {
  const mode = overrideMode ?? settingsService.load().fhirMode;
  return mode === 'live' ? liveFhirClient : mockFhirClient;
}
