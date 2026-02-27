import { z } from 'zod';

export const importQueueName = 'default';
export const importJobName = 'import:process';

export const importBatchStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
]);
export type ImportBatchStatus = z.infer<typeof importBatchStatusSchema>;

export const importRowOutcomeSchema = z.enum([
  'inserted',
  'updated',
  'skipped',
  'duplicate',
  'error',
]);
export type ImportRowOutcome = z.infer<typeof importRowOutcomeSchema>;

export const importCanonicalFieldSchema = z.enum([
  'first_name',
  'last_name',
  'full_name',
  'emails',
  'phones',
  'company',
  'title',
  'notes_context',
  'city',
  'country',
  'linkedin',
  'website',
  'twitter',
]);
export type ImportCanonicalField = z.infer<typeof importCanonicalFieldSchema>;

export const importCanonicalFields = importCanonicalFieldSchema.options;

export const allowedMultiValueDelimiters = [',', ';', '|'] as const;
export const multiValueDelimitersSchema = z
  .array(z.enum(allowedMultiValueDelimiters))
  .min(1)
  .max(3);

export const importColumnMappingSchema = z
  .object({
    mapping: z.object({
      first_name: z.string().trim().min(1).nullable().optional(),
      last_name: z.string().trim().min(1).nullable().optional(),
      full_name: z.string().trim().min(1).nullable().optional(),
      emails: z.string().trim().min(1).nullable().optional(),
      phones: z.string().trim().min(1).nullable().optional(),
      company: z.string().trim().min(1).nullable().optional(),
      title: z.string().trim().min(1).nullable().optional(),
      notes_context: z.string().trim().min(1).nullable().optional(),
      city: z.string().trim().min(1).nullable().optional(),
      country: z.string().trim().min(1).nullable().optional(),
      linkedin: z.string().trim().min(1).nullable().optional(),
      website: z.string().trim().min(1).nullable().optional(),
      twitter: z.string().trim().min(1).nullable().optional(),
    }),
    emailDelimiters: multiValueDelimitersSchema.default([',', ';']),
    phoneDelimiters: multiValueDelimitersSchema.default([',', ';']),
    csvDelimiter: z.enum([',', ';', '|', '\t']).default(','),
  })
  .superRefine((value, ctx) => {
    const hasIdentityField = Boolean(value.mapping.emails || value.mapping.phones || value.mapping.linkedin);
    const hasNameField = Boolean(value.mapping.full_name || value.mapping.first_name || value.mapping.last_name);

    if (!hasIdentityField && !hasNameField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Mapping must include at least one identity field (emails/phones/linkedin) or a name field.',
      });
    }
  });

export type ImportColumnMappingInput = z.infer<typeof importColumnMappingSchema>;

export const importStatusResponseSchema = z.object({
  batchId: z.string().uuid(),
  status: importBatchStatusSchema,
  totalRows: z.number().int().min(0),
  processedRows: z.number().int().min(0),
  insertedCount: z.number().int().min(0),
  updatedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  errorCount: z.number().int().min(0),
  percentComplete: z.number().min(0).max(100),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const importResultsQuerySchema = z.object({
  outcome: importRowOutcomeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ImportResultsQueryInput = z.infer<typeof importResultsQuerySchema>;

export const importBatchIdParamSchema = z.object({
  batchId: z.string().uuid(),
});
export type ImportBatchIdParamInput = z.infer<typeof importBatchIdParamSchema>;
