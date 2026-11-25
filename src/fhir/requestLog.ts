import type { FhirOperationOutcome } from '../types';

export interface FhirRequestLogEntry {
  id: string;
  timestamp: string;
  mode: 'mock' | 'live';
  tenantId: string;
  tenantCode: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  outcomeSummary?: string;
  outcome?: FhirOperationOutcome;
}

class FhirRequestLog {
  private entries: FhirRequestLogEntry[] = [];
  private listeners = new Set<() => void>();
  private readonly maxEntries = 100;

  public record(entry: Omit<FhirRequestLogEntry, 'id' | 'timestamp'>): FhirRequestLogEntry {
    const full: FhirRequestLogEntry = {
      ...entry,
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.unshift(full);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    this.listeners.forEach((fn) => fn());
    return full;
  }

  public getEntries(tenantId?: string): FhirRequestLogEntry[] {
    if (!tenantId) {
      return [...this.entries];
    }
    return this.entries.filter((e) => e.tenantId === tenantId);
  }

  public clear(tenantId?: string): void {
    if (!tenantId) {
      this.entries = [];
    } else {
      this.entries = this.entries.filter((e) => e.tenantId !== tenantId);
    }
    this.listeners.forEach((fn) => fn());
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const fhirRequestLog = new FhirRequestLog();
