import { z } from 'zod';

export const linkedinMatchContactJobName = 'linkedin:matchContact';
export const linkedinMatchBackfillJobName = 'linkedin:matchBackfill';

export const linkedinMatchContactSchema = z.object({
  contactId: z.string().trim().min(1),
  requestedByUserId: z.string().trim().min(1).optional(),
  force: z.boolean().optional().default(false),
  maxResults: z.coerce.number().int().min(1).max(10).default(5),
});
export type LinkedinMatchContactInput = z.infer<typeof linkedinMatchContactSchema>;

export const linkedinMatchContactRequestSchema = linkedinMatchContactSchema.pick({
  force: true,
  maxResults: true,
});
export type LinkedinMatchContactRequestInput = z.infer<typeof linkedinMatchContactRequestSchema>;

export const linkedinMatchBackfillSchema = z.object({
  requestedByUserId: z.string().trim().min(1).optional(),
  missingLinkedinOnly: z.boolean().optional().default(true),
  country: z.string().trim().min(1).max(120).optional(),
  importedBatchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(250),
  force: z.boolean().optional().default(false),
  maxResultsPerContact: z.coerce.number().int().min(1).max(10).default(5),
});
export type LinkedinMatchBackfillInput = z.infer<typeof linkedinMatchBackfillSchema>;

export const linkedinSuggestionIdParamSchema = z.object({
  id: z.string().trim().min(1),
});
export type LinkedinSuggestionIdParamInput = z.infer<typeof linkedinSuggestionIdParamSchema>;

export const linkedinSuggestionStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type LinkedinSuggestionStatus = z.infer<typeof linkedinSuggestionStatusSchema>;

export const linkedinSuggestionsQuerySchema = z.object({
  contactId: z.string().trim().min(1).optional(),
  status: linkedinSuggestionStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type LinkedinSuggestionsQueryInput = z.infer<typeof linkedinSuggestionsQuerySchema>;
