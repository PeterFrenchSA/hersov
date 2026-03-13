import { z } from 'zod';
export * from './import/schema';
export * from './enrichment/schema';
export * from './ai/schema';
export * from './insights/schema';
export * from './linkedin/schema';

export const roleSchema = z.enum(['Admin', 'Analyst', 'ReadOnly']);
export type AppRole = z.infer<typeof roleSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const contactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  sortBy: z.enum(['updated_at', 'created_at', 'name', 'last_enriched', 'connector_score']).default('updated_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  importBatchId: z.string().uuid().optional(),
  company: z.string().trim().max(200).optional(),
  title: z.string().trim().max(240).optional(),
  country: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(200).optional(),
  missingEmail: z.coerce.boolean().optional().default(false),
  missingLinkedin: z.coerce.boolean().optional().default(false),
  missingLocation: z.coerce.boolean().optional().default(false),
  lastEnrichedBeforeDays: z.coerce.number().int().min(1).max(3650).optional(),
  minConnectorScore: z.coerce.number().min(0).optional(),
});

export type ContactsQueryInput = z.infer<typeof contactsQuerySchema>;

const contactMethodInputSchema = z.object({
  type: z.enum(['email', 'phone', 'website', 'linkedin', 'twitter', 'other']),
  value: z.string().trim().min(1).max(320),
  isPrimary: z.boolean().optional().default(false),
});

const contactTagInputSchema = z.object({
  category: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
});

export const contactCreateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120).optional().nullable(),
    lastName: z.string().trim().min(1).max(120).optional().nullable(),
    fullName: z.string().trim().min(1).max(240).optional().nullable(),
    notesRaw: z.string().max(5000).optional().nullable(),
    locationCity: z.string().trim().min(1).max(120).optional().nullable(),
    locationCountry: z.string().trim().min(1).max(120).optional().nullable(),
    currentTitle: z.string().trim().min(1).max(240).optional().nullable(),
    companyName: z.string().trim().min(1).max(200).optional().nullable(),
    methods: z.array(contactMethodInputSchema).max(25).default([]),
    tags: z.array(contactTagInputSchema).max(50).default([]),
  })
  .superRefine((value, ctx) => {
    const hasName = Boolean(
      value.fullName
      || value.firstName
      || value.lastName,
    );
    const hasMethod = value.methods.length > 0;

    if (!hasName && !hasMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide a name or at least one contact method.',
      });
    }
  });

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

export const contactPatchSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
    fullName: z.string().trim().min(1).max(240).optional(),
    notesRaw: z.string().max(5000).optional().nullable(),
    locationCity: z.string().trim().min(1).max(120).optional().nullable(),
    locationCountry: z.string().trim().min(1).max(120).optional().nullable(),
    currentTitle: z.string().trim().min(1).max(240).optional().nullable(),
    currentCompanyId: z.string().trim().min(1).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type ContactPatchInput = z.infer<typeof contactPatchSchema>;

export const idParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type IdParamInput = z.infer<typeof idParamSchema>;
