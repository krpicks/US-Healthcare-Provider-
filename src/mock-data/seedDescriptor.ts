export const PROTOTYPE_BANNER_TEXT = 'Prototype - synthetic data only';

export interface SyntheticSeedSummary {
  tenants: number;
  providers: number;
  plans: number;
  samplePatients: number;
  clinicalSampleBundle: string;
}

export const PLANNED_SYNTHETIC_SEED_SUMMARY: SyntheticSeedSummary = {
  tenants: 2,
  providers: 10,
  plans: 3,
  samplePatients: 1,
  clinicalSampleBundle:
    'Jane Doe (MRN-1001), ambulatory Encounter, COVID-19 Condition (SNOMED 840539006), SARS-CoV-2 RNA Observation (LOINC 94500-6 / SNOMED 260373001 Detected)',
};
