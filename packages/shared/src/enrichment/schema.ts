import { z } from 'zod';

export const enrichmentJobName = 'enrichment:run';

export const enrichmentRunStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
]);
export type EnrichmentRunStatus = z.infer<typeof enrichmentRunStatusSchema>;

export const enrichmentProviderNameSchema = z.enum(['mock', 'apollo']);
export type EnrichmentProviderName = z.infer<typeof enrichmentProviderNameSchema>;

export const enrichmentMergePolicySchema = z.enum([
  'fill_missing_only',
  'overwrite_if_higher_confidence',
]);
export type EnrichmentMergePolicy = z.infer<typeof enrichmentMergePolicySchema>;

export const enrichmentRunSelectionSchema = z.object({
  explicitContactIds: z.array(z.string().trim().min(1)).max(10000).optional(),
  missingEmail: z.boolean().optional(),
  missingLinkedin: z.boolean().optional(),
  missingLocation: z.boolean().optional(),
  country: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(120).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  companyId: z.string().trim().min(1).optional(),
  importedBatchId: z.string().uuid().optional(),
});
export type EnrichmentRunSelectionInput = z.infer<typeof enrichmentRunSelectionSchema>;

export const createEnrichmentRunSchema = z.object({
  selection: enrichmentRunSelectionSchema.default({}),
  providers: z.array(enrichmentProviderNameSchema).min(1),
  mergePolicy: enrichmentMergePolicySchema.default('fill_missing_only'),
  dryRun: z.boolean().default(false),
});
export type CreateEnrichmentRunInput = z.infer<typeof createEnrichmentRunSchema>;

export const enrichmentRunIdParamSchema = z.object({
  id: z.string().uuid(),
});
export type EnrichmentRunIdParamInput = z.infer<typeof enrichmentRunIdParamSchema>;

export const enrichmentRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: enrichmentRunStatusSchema.optional(),
});
export type EnrichmentRunsQueryInput = z.infer<typeof enrichmentRunsQuerySchema>;

export const enrichmentRunResultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type EnrichmentRunResultsQueryInput = z.infer<typeof enrichmentRunResultsQuerySchema>;

export const enrichmentContactMethodTypeSchema = z.enum([
  'email',
  'phone',
  'website',
  'linkedin',
  'twitter',
  'other',
]);
export type EnrichmentContactMethodType = z.infer<typeof enrichmentContactMethodTypeSchema>;

export const enrichmentFieldNameSchema = z.enum([
  'first_name',
  'last_name',
  'full_name',
  'location_city',
  'location_country',
  'current_title',
  'notes_raw',
  'company_name',
]);
export type EnrichmentFieldName = z.infer<typeof enrichmentFieldNameSchema>;

export interface EnrichmentProviderInput {
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    notesRaw: string | null;
    locationCity: string | null;
    locationCountry: string | null;
    currentTitle: string | null;
    companyName: string | null;
    companyDomain: string | null;
    methods: Array<{
      type: EnrichmentContactMethodType;
      value: string;
      isPrimary: boolean;
      verifiedAt: string | null;
    }>;
  };
}

export interface EnrichmentProviderFieldCandidate {
  field: EnrichmentFieldName;
  value: string;
  confidence: number;
  providerRef?: string;
  evidenceUrl?: string;
}

export interface EnrichmentProviderMethodCandidate {
  type: EnrichmentContactMethodType;
  value: string;
  confidence: number;
  isPrimary?: boolean;
  verifiedAt?: string | null;
  providerRef?: string;
  evidenceUrl?: string;
}

export interface EnrichmentProviderTagCandidate {
  name: string;
  category: string;
  confidence: number;
}

export interface EnrichmentProviderOutput {
  fields: EnrichmentProviderFieldCandidate[];
  methods: EnrichmentProviderMethodCandidate[];
  tags: EnrichmentProviderTagCandidate[];
}

export interface EnrichmentProvider {
  name: EnrichmentProviderName;
  supportsFields: string[];
  rateLimit: {
    rpm: number;
    concurrency: number;
  };
  isConfigured(): boolean;
  enrichContact(input: EnrichmentProviderInput): Promise<EnrichmentProviderOutput>;
}

export const enrichmentProviderCatalog: Record<
  EnrichmentProviderName,
  {
    label: string;
    envVar: string | null;
    supportsFields: string[];
    defaultRpm: number;
    defaultConcurrency: number;
  }
> = {
  mock: {
    label: 'Mock Provider',
    envVar: null,
    supportsFields: ['location_country', 'website', 'linkedin', 'current_title', 'tags'],
    defaultRpm: 600,
    defaultConcurrency: 4,
  },
  apollo: {
    label: 'Apollo Skeleton',
    envVar: 'APOLLO_API_KEY',
    supportsFields: ['location_country', 'current_title', 'method:email', 'method:phone', 'linkedin'],
    defaultRpm: 120,
    defaultConcurrency: 2,
  },
};

export interface EnrichmentProviderStatus {
  name: EnrichmentProviderName;
  label: string;
  configured: boolean;
  enabled: boolean;
  envVar: string | null;
  supportsFields: string[];
  rateLimit: {
    rpm: number;
    concurrency: number;
  };
}
