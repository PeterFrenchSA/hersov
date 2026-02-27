import { z } from 'zod';

export const embeddingsUpsertContactJobName = 'embeddings:upsertContact';
export const embeddingsBackfillJobName = 'embeddings:backfill';

export const embeddingsBackfillSchema = z.object({
  missingOnly: z.boolean().optional().default(true),
  staleOnly: z.boolean().optional().default(false),
  country: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(120).optional(),
  importedBatchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});
export type EmbeddingsBackfillInput = z.infer<typeof embeddingsBackfillSchema>;

export const semanticSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(400),
  k: z.coerce.number().int().min(1).max(50).default(20),
});
export type SemanticSearchQueryInput = z.infer<typeof semanticSearchQuerySchema>;

export const chatRequestSchema = z.object({
  threadId: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(4000),
});
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

export const chatThreadIdParamSchema = z.object({
  id: z.string().trim().min(1).max(200),
});
export type ChatThreadIdParamInput = z.infer<typeof chatThreadIdParamSchema>;

export const chatThreadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ChatThreadsQueryInput = z.infer<typeof chatThreadsQuerySchema>;

export const chatToolFieldsSchema = z.enum([
  'id',
  'full_name',
  'current_title',
  'company_name',
  'location_country',
  'emails',
  'phones',
]);

export const chatToolFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  country: z.string().trim().min(1).max(120).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  tag: z.string().trim().min(1).max(120).optional(),
  importedBatchId: z.string().uuid().optional(),
});

export const chatToolSearchContactsSchema = z.object({
  filters: chatToolFiltersSchema.optional(),
  sortBy: z.enum(['updated_at', 'created_at', 'name']).default('updated_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  fields: z.array(chatToolFieldsSchema).max(10).optional(),
  includeSensitive: z.boolean().optional().default(false),
});
export type ChatToolSearchContactsInput = z.infer<typeof chatToolSearchContactsSchema>;

export const chatToolAggregateContactsSchema = z.object({
  groupBy: z.enum(['country', 'company', 'title']),
  filters: chatToolFiltersSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ChatToolAggregateContactsInput = z.infer<typeof chatToolAggregateContactsSchema>;

export const chatToolGetContactByIdSchema = z.object({
  id: z.string().trim().min(1),
  includeSensitive: z.boolean().optional().default(false),
});
export type ChatToolGetContactByIdInput = z.infer<typeof chatToolGetContactByIdSchema>;

export const chatToolSemanticSearchSchema = z.object({
  query: z.string().trim().min(2).max(400),
  k: z.coerce.number().int().min(1).max(50).default(20),
  filters: chatToolFiltersSchema.optional(),
  includeSensitive: z.boolean().optional().default(false),
});
export type ChatToolSemanticSearchInput = z.infer<typeof chatToolSemanticSearchSchema>;
