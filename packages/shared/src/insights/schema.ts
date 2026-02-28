import { z } from 'zod';

export const insightsUpsertContactJobName = 'insights:upsertContact';
export const insightsBackfillJobName = 'insights:backfill';
export const graphRecomputeScoresJobName = 'graph:recomputeScores';

export const insightEntityTypeSchema = z.enum(['company', 'event', 'location', 'topic', 'person_ref']);
export type InsightEntityType = z.infer<typeof insightEntityTypeSchema>;

export const reviewKindSchema = z.enum(['tag', 'entity', 'relationship', 'linkedin_profile']);
export type ReviewKind = z.infer<typeof reviewKindSchema>;

export const reviewStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

const confidenceSchema = z.number().min(0).max(1);
const yearSchema = z.number().int().min(1900).max(2100);

export const contactInsightsExtractionSchema = z.object({
  meeting_context: z.object({
    event_name: z.string().trim().min(1).max(200).optional(),
    year: yearSchema.optional(),
    location: z.string().trim().min(1).max(160).optional(),
    introduced_by_name: z.string().trim().min(1).max(200).optional(),
    evidence_snippet: z.string().trim().min(1).max(500).optional(),
  }).strict().optional(),
  tags: z.array(
    z.object({
      category: z.string().trim().min(1).max(100),
      value: z.string().trim().min(1).max(200),
      confidence: confidenceSchema,
      evidence_snippet: z.string().trim().min(1).max(500).optional(),
    }).strict(),
  ).max(100).default([]),
  entities: z.array(
    z.object({
      type: insightEntityTypeSchema,
      name: z.string().trim().min(1).max(240),
      confidence: confidenceSchema,
      evidence_snippet: z.string().trim().min(1).max(500).optional(),
    }).strict(),
  ).max(120).default([]),
  relationship_clues: z.array(
    z.object({
      type: z.string().trim().min(1).max(120),
      counterparty_name: z.string().trim().min(1).max(240).optional(),
      context_entity_name: z.string().trim().min(1).max(240).optional(),
      year: yearSchema.optional(),
      confidence: confidenceSchema,
      evidence_snippet: z.string().trim().min(1).max(500).optional(),
    }).strict(),
  ).max(100).default([]),
  investor_signals: z.object({
    is_investor: z.boolean().optional(),
    investor_type: z.string().trim().min(1).max(120).optional(),
    sectors: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  }).strict().optional(),
  topics: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
}).strict();
export type ContactInsightsExtraction = z.infer<typeof contactInsightsExtractionSchema>;

export const insightsBackfillSchema = z.object({
  missingOnly: z.boolean().optional().default(true),
  staleOnly: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
  fillMissingOnly: z.boolean().optional().default(true),
  country: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(120).optional(),
  importedBatchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});
export type InsightsBackfillInput = z.infer<typeof insightsBackfillSchema>;

export const reviewQueueQuerySchema = z.object({
  status: reviewStatusSchema.optional().default('pending'),
  kind: reviewKindSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ReviewQueueQueryInput = z.infer<typeof reviewQueueQuerySchema>;

export const reviewIdParamSchema = z.object({
  id: z.string().trim().min(1),
});
export type ReviewIdParamInput = z.infer<typeof reviewIdParamSchema>;

export const insightsDashboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type InsightsDashboardQueryInput = z.infer<typeof insightsDashboardQuerySchema>;
