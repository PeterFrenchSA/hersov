import { ContactMethodType, EnrichmentRunStatus, type PrismaClient } from '@prisma/client';
import { createEnrichmentRunProcessor } from './processor';

type CompanyRecord = {
  id: string;
  name: string;
  domain: string | null;
};

type ContactRecord = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  notesRaw: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  currentTitle: string | null;
  currentCompanyId: string | null;
  lastEnrichedAt: Date | null;
};

type MethodRecord = {
  id: string;
  contactId: string;
  type: ContactMethodType;
  value: string;
  isPrimary: boolean;
  verifiedAt: Date | null;
  source: string | null;
};

type TagRecord = {
  id: string;
  name: string;
  category: string;
};

type ContactTagRecord = {
  contactId: string;
  tagId: string;
  confidence: number | null;
  source: string | null;
};

type ConfidenceRecord = {
  confidence: number;
  provider: string;
};

describe('enrichment processor integration', () => {
  it('processes a mock provider run and persists results', async () => {
    const run = {
      id: 'run-1',
      status: EnrichmentRunStatus.QUEUED,
      createdAt: new Date('2026-02-27T10:00:00.000Z'),
      startedAt: null,
      finishedAt: null,
      createdByUserId: 'usr-admin',
      configJson: {
        selection: {},
        providers: ['mock'],
        mergePolicy: 'fill_missing_only',
        dryRun: false,
      },
      statsJson: null,
      totalTargets: 0,
      processedTargets: 0,
      updatedContacts: 0,
      skippedContacts: 0,
      errorCount: 0,
      errorSampleJson: null,
    };

    const companies = new Map<string, CompanyRecord>([
      [
        'cmp-1',
        {
          id: 'cmp-1',
          name: 'Acme Partners',
          domain: 'acme.co.uk',
        },
      ],
    ]);

    const contact: ContactRecord = {
      id: 'contact-1',
      firstName: 'Jane',
      lastName: 'Doe',
      fullName: 'Jane Doe',
      notesRaw: null,
      locationCity: null,
      locationCountry: null,
      currentTitle: null,
      currentCompanyId: 'cmp-1',
      lastEnrichedAt: null,
    };

    const methods: MethodRecord[] = [
      {
        id: 'method-1',
        contactId: contact.id,
        type: ContactMethodType.EMAIL,
        value: 'jane@acme.co.uk',
        isPrimary: true,
        verifiedAt: null,
        source: 'import',
      },
    ];

    const tags = new Map<string, TagRecord>();
    const contactTags: ContactTagRecord[] = [];
    const fieldConfidence = new Map<string, ConfidenceRecord>();
    const enrichmentResults: Array<{ field: string; newValue: string | null; provider: string }> = [];

    let returnedBatch = false;

    const getContactProjection = () => ({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      notesRaw: contact.notesRaw,
      locationCity: contact.locationCity,
      locationCountry: contact.locationCountry,
      currentTitle: contact.currentTitle,
      currentCompanyId: contact.currentCompanyId,
      currentCompany: contact.currentCompanyId ? companies.get(contact.currentCompanyId) ?? null : null,
      contactMethods: methods
        .filter((item) => item.contactId === contact.id)
        .map((item) => ({
          id: item.id,
          type: item.type,
          value: item.value,
          isPrimary: item.isPrimary,
          verifiedAt: item.verifiedAt,
        })),
      tags: contactTags
        .filter((item) => item.contactId === contact.id)
        .map((item) => {
          const tag = tags.get(item.tagId);
          if (!tag) {
            throw new Error('Missing tag record');
          }

          return {
            tagId: item.tagId,
            confidence: item.confidence,
            tag: {
              id: tag.id,
              name: tag.name,
              category: tag.category,
            },
          };
        }),
      fieldConfidence: Array.from(fieldConfidence.entries()).map(([field, value]) => ({
        field,
        confidence: value.confidence,
        provider: value.provider,
      })),
    });

    const prismaMock: any = {
      enrichmentRun: {
        findUnique: jest.fn(async ({ where, select }: any) => {
          if (where.id !== run.id) {
            return null;
          }

          if (select?.status) {
            return { status: run.status };
          }

          return run;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          if (where.id !== run.id) {
            throw new Error('run not found');
          }

          Object.assign(run, data);
          return run;
        }),
      },
      contact: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async ({ cursor }: any) => {
          if (cursor?.id) {
            return [];
          }

          if (returnedBatch) {
            return [];
          }

          returnedBatch = true;
          return [getContactProjection()];
        }),
        update: jest.fn(async ({ where, data }: any) => {
          if (where.id !== contact.id) {
            throw new Error('contact not found');
          }

          if (typeof data.firstName === 'string') {
            contact.firstName = data.firstName;
          }

          if (typeof data.lastName === 'string') {
            contact.lastName = data.lastName;
          }

          if (typeof data.fullName === 'string') {
            contact.fullName = data.fullName;
          }

          if (typeof data.notesRaw === 'string') {
            contact.notesRaw = data.notesRaw;
          }

          if (typeof data.locationCity === 'string') {
            contact.locationCity = data.locationCity;
          }

          if (typeof data.locationCountry === 'string') {
            contact.locationCountry = data.locationCountry;
          }

          if (typeof data.currentTitle === 'string') {
            contact.currentTitle = data.currentTitle;
          }

          if (typeof data.currentCompanyId === 'string') {
            contact.currentCompanyId = data.currentCompanyId;
          }

          if (data.lastEnrichedAt instanceof Date) {
            contact.lastEnrichedAt = data.lastEnrichedAt;
          }

          return getContactProjection();
        }),
      },
      contactMethod: {
        upsert: jest.fn(async ({ where, update, create }: any) => {
          const existing = methods.find(
            (item) =>
              item.contactId === where.contactId_type_value.contactId
              && item.type === where.contactId_type_value.type
              && item.value === where.contactId_type_value.value,
          );

          if (existing) {
            if (typeof update.source === 'string') {
              existing.source = update.source;
            }

            if (update.verifiedAt instanceof Date) {
              existing.verifiedAt = update.verifiedAt;
            }

            return existing;
          }

          const created: MethodRecord = {
            id: `method-${methods.length + 1}`,
            contactId: create.contactId,
            type: create.type,
            value: create.value,
            isPrimary: create.isPrimary,
            verifiedAt: create.verifiedAt ?? null,
            source: create.source ?? null,
          };

          methods.push(created);
          return created;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const existing = methods.find((item) => item.id === where.id);
          if (!existing) {
            throw new Error('method not found');
          }

          if (data.verifiedAt instanceof Date) {
            existing.verifiedAt = data.verifiedAt;
          }

          return existing;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let updatedCount = 0;

          for (const method of methods) {
            if (method.contactId !== where.contactId) {
              continue;
            }

            if (where.type && method.type !== where.type) {
              continue;
            }

            if (where.value && method.value !== where.value) {
              continue;
            }

            if (typeof data.isPrimary === 'boolean') {
              method.isPrimary = data.isPrimary;
            }

            updatedCount += 1;
          }

          return { count: updatedCount };
        }),
      },
      company: {
        findFirst: jest.fn(async ({ where }: any) => {
          const target = String(where.name.equals).toLowerCase();

          for (const company of companies.values()) {
            if (company.name.toLowerCase() === target) {
              return { id: company.id };
            }
          }

          return null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const id = `cmp-${companies.size + 1}`;
          const created: CompanyRecord = {
            id,
            name: data.name,
            domain: null,
          };

          companies.set(id, created);
          return { id };
        }),
      },
      tag: {
        findUnique: jest.fn(async ({ where }: any) => {
          const targetName = String(where.name_category.name).toLowerCase();
          const targetCategory = String(where.name_category.category).toLowerCase();

          for (const tag of tags.values()) {
            if (tag.name.toLowerCase() === targetName && tag.category.toLowerCase() === targetCategory) {
              return { id: tag.id };
            }
          }

          return null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const id = `tag-${tags.size + 1}`;
          tags.set(id, {
            id,
            name: data.name,
            category: data.category,
          });

          return { id };
        }),
      },
      contactTag: {
        upsert: jest.fn(async ({ where, update, create }: any) => {
          const existing = contactTags.find(
            (item) =>
              item.contactId === where.contactId_tagId.contactId
              && item.tagId === where.contactId_tagId.tagId,
          );

          if (existing) {
            existing.confidence = update.confidence ?? null;
            existing.source = update.source ?? null;
            return existing;
          }

          const createdRecord: ContactTagRecord = {
            contactId: create.contactId,
            tagId: create.tagId,
            confidence: create.confidence ?? null,
            source: create.source ?? null,
          };
          contactTags.push(createdRecord);
          return createdRecord;
        }),
      },
      enrichmentResult: {
        createMany: jest.fn(async ({ data }: any) => {
          for (const row of data) {
            enrichmentResults.push({
              field: row.field,
              newValue: row.newValue,
              provider: row.provider,
            });
          }

          return { count: data.length };
        }),
      },
      contactFieldConfidence: {
        upsert: jest.fn(async ({ where, update, create }: any) => {
          const key = `${where.contactId_field.contactId}:${where.contactId_field.field}`;
          const existing = fieldConfidence.get(key);

          if (existing) {
            fieldConfidence.set(key, {
              confidence: update.confidence,
              provider: update.provider,
            });
            return {
              contactId: where.contactId_field.contactId,
              field: where.contactId_field.field,
              confidence: update.confidence,
              provider: update.provider,
            };
          }

          fieldConfidence.set(key, {
            confidence: create.confidence,
            provider: create.provider,
          });
          return create;
        }),
      },
      auditLog: {
        create: jest.fn(async () => ({})),
      },
    };

    prismaMock.$transaction = jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(prismaMock);
      }

      return Promise.all(arg);
    });

    const processor = createEnrichmentRunProcessor(prismaMock as PrismaClient);
    await processor({ runId: run.id });

    expect(run.status).toBe(EnrichmentRunStatus.COMPLETED);
    expect(run.processedTargets).toBe(1);
    expect(run.updatedContacts).toBeGreaterThan(0);
    expect(contact.locationCountry).toBe('United Kingdom');
    expect(contact.lastEnrichedAt).toBeInstanceOf(Date);

    expect(enrichmentResults.length).toBeGreaterThan(0);
    expect(enrichmentResults.some((row) => row.field === 'location_country')).toBe(true);

    expect(methods.some((method) => method.type === ContactMethodType.WEBSITE)).toBe(true);
    expect(methods.some((method) => method.type === ContactMethodType.LINKEDIN)).toBe(true);
  });
});
