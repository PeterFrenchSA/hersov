import { z } from 'zod';
export * from './import/schema';
export * from './enrichment/schema';

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
  sortBy: z.enum(['updated_at', 'created_at', 'name']).default('updated_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  importBatchId: z.string().uuid().optional(),
});

export type ContactsQueryInput = z.infer<typeof contactsQuerySchema>;

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
