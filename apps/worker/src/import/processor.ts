import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse';
import {
  ContactMethodType,
  ImportBatchStatus,
  ImportRowOutcome,
  PrismaClient,
  type Prisma,
} from '@prisma/client';
import { importColumnMappingSchema, type ImportColumnMappingInput } from '@hersov/shared';
import { resolveDeterministicMatch } from './dedupe';
import { normalizeCsvRow, type NormalizedImportCandidate } from './normalization';
import { enqueueEmbeddingUpsertContactJobs } from '../embeddings/dispatch';

export interface ImportJobPayload {
  batchId: string;
}

type RowOutcome = 'inserted' | 'updated' | 'skipped' | 'duplicate' | 'error';

interface RowProcessResult {
  outcome: RowOutcome;
  contactId?: string;
  errorMessage?: string;
  normalized?: NormalizedImportCandidate;
}

interface ErrorSample {
  rowIndex: number;
  message: string;
}

interface BatchCounters {
  totalRows: number;
  processedRows: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  duplicateCount: number;
  errorCount: number;
}

const prisma = new PrismaClient();

export const processImportJob = createImportProcessor(prisma);

export async function closeImportProcessor(): Promise<void> {
  await prisma.$disconnect();
}

export function createImportProcessor(prismaClient: PrismaClient) {
  return async (payload: ImportJobPayload): Promise<void> => {
    const batchId = payload.batchId;

    const batch = await prismaClient.importBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new Error(`Import batch ${batchId} not found`);
    }

    let mapping: ImportColumnMappingInput;
    try {
      mapping = importColumnMappingSchema.parse(batch.columnMappingJson);
    } catch {
      await prismaClient.importBatch.update({
        where: { id: batchId },
        data: {
          status: ImportBatchStatus.FAILED,
          finishedAt: new Date(),
          errorSampleJson: [
            {
              rowIndex: 0,
              message: 'Import mapping is missing or invalid.',
            },
          ],
        },
      });
      throw new Error('Import mapping is missing or invalid');
    }

    const filePath = join(getImportDirectory(), `${batchId}.csv`);
    await access(filePath);

    const counters: BatchCounters = {
      totalRows: 0,
      processedRows: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
    };

    const errorSamples: ErrorSample[] = [];
    const rowRecordsBuffer: Prisma.ImportRowCreateManyInput[] = [];
    const companyCache = new Map<string, string>();
    const contactsToEmbed = new Set<string>();
    const storeRawRows = shouldStoreRawRows();

    const batchWriteIntervalRows = getBatchWriteIntervalRows();
    const batchWriteIntervalMs = 2_000;
    let lastProgressWriteAt = Date.now();

    try {
      const totalRows = await countCsvDataRows(filePath, mapping.csvDelimiter);
      counters.totalRows = totalRows;

      await prismaClient.importBatch.update({
        where: { id: batchId },
        data: {
          status: ImportBatchStatus.PROCESSING,
          startedAt: batch.startedAt ?? new Date(),
          finishedAt: null,
          totalRows,
          processedRows: 0,
          insertedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          duplicateCount: 0,
          errorCount: 0,
          errorSampleJson: [],
        },
      });

      const parser = parse({
        columns: true,
        bom: true,
        delimiter: mapping.csvDelimiter,
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });

      const stream = createReadStream(filePath);
      stream.pipe(parser);

      let rowIndex = 1;

      for await (const rawRow of parser as AsyncIterable<Record<string, unknown>>) {
        counters.processedRows += 1;

        let result: RowProcessResult;

        try {
          result = await processRow(
            prismaClient,
            batchId,
            rawRow,
            mapping,
            companyCache,
          );
        } catch (error) {
          result = {
            outcome: 'error',
            errorMessage: (error as Error).message,
          };
        }

        if (result.outcome === 'inserted') {
          counters.insertedCount += 1;
        } else if (result.outcome === 'updated') {
          counters.updatedCount += 1;
        } else if (result.outcome === 'skipped') {
          counters.skippedCount += 1;
        } else if (result.outcome === 'duplicate') {
          counters.duplicateCount += 1;
        } else {
          counters.errorCount += 1;
        }

        if ((result.outcome === 'inserted' || result.outcome === 'updated') && result.contactId) {
          contactsToEmbed.add(result.contactId);
        }

        if (result.outcome === 'error' && result.errorMessage) {
          if (errorSamples.length < getErrorSampleLimit()) {
            errorSamples.push({
              rowIndex,
              message: result.errorMessage,
            });
          }
        }

        if (storeRawRows) {
          rowRecordsBuffer.push({
            batchId,
            rowIndex,
            rawJson: rawRow as Prisma.InputJsonValue,
            normalizedJson: result.normalized
              ? (result.normalized as unknown as Prisma.InputJsonValue)
              : undefined,
            outcome: toImportRowOutcome(result.outcome),
            contactId: result.contactId,
            errorMessage: result.errorMessage,
          });
        }

        if (rowRecordsBuffer.length >= 25) {
          await flushRowsBuffer(prismaClient, rowRecordsBuffer);
        }

        const now = Date.now();
        const shouldWriteProgress =
          counters.processedRows % batchWriteIntervalRows === 0 || now - lastProgressWriteAt >= batchWriteIntervalMs;

        if (shouldWriteProgress) {
          await flushBatchCounters(prismaClient, batchId, counters, errorSamples);
          lastProgressWriteAt = now;
        }

        rowIndex += 1;
      }

      await flushRowsBuffer(prismaClient, rowRecordsBuffer);
      await flushBatchCounters(prismaClient, batchId, counters, errorSamples);

      await prismaClient.importBatch.update({
        where: { id: batchId },
        data: {
          status: ImportBatchStatus.COMPLETED,
          finishedAt: new Date(),
        },
      });

      try {
        await enqueueEmbeddingUpsertContactJobs(
          Array.from(contactsToEmbed),
          `import:${batchId}`,
        );
      } catch (error) {
        console.warn('Failed to enqueue embedding upserts after import completion', error);
      }
    } catch (error) {
      await flushRowsBuffer(prismaClient, rowRecordsBuffer);
      await flushBatchCounters(prismaClient, batchId, counters, errorSamples);

      const errorMessage = (error as Error).message;
      if (errorSamples.length < getErrorSampleLimit()) {
        errorSamples.push({ rowIndex: counters.processedRows, message: errorMessage });
      }

      await prismaClient.importBatch.update({
        where: { id: batchId },
        data: {
          status: ImportBatchStatus.FAILED,
          finishedAt: new Date(),
          errorSampleJson: errorSamples as unknown as Prisma.InputJsonValue,
        },
      });

      throw error;
    }
  };
}

async function processRow(
  prismaClient: PrismaClient,
  batchId: string,
  rawRow: Record<string, unknown>,
  mapping: ImportColumnMappingInput,
  companyCache: Map<string, string>,
): Promise<RowProcessResult> {
  const normalized = normalizeCsvRow(rawRow, mapping);

  if (!hasImportableData(normalized)) {
    return {
      outcome: 'skipped',
      normalized,
      errorMessage: 'Row contains no importable data',
    };
  }

  const deterministicMatch = await findDeterministicContactMatch(prismaClient, normalized);

  if (!deterministicMatch && normalized.fullName) {
    const fuzzyDuplicate = await findFuzzyDuplicate(prismaClient, normalized);
    if (fuzzyDuplicate) {
      return {
        outcome: 'duplicate',
        normalized,
        contactId: fuzzyDuplicate.contactId,
        errorMessage: `Potential duplicate (score=${fuzzyDuplicate.score.toFixed(3)}), skipped by default`,
      };
    }
  }

  if (deterministicMatch) {
    const updateResult = await updateExistingContact(
      prismaClient,
      deterministicMatch.contactId,
      normalized,
      batchId,
      companyCache,
    );

    return {
      outcome: updateResult.updated ? 'updated' : 'skipped',
      contactId: deterministicMatch.contactId,
      normalized,
      errorMessage: updateResult.updated ? undefined : 'Matched existing contact with no new fields to apply',
    };
  }

  const createdContactId = await createContactFromImport(
    prismaClient,
    batchId,
    normalized,
    companyCache,
  );

  return {
    outcome: 'inserted',
    contactId: createdContactId,
    normalized,
  };
}

async function findDeterministicContactMatch(
  prismaClient: PrismaClient,
  candidate: NormalizedImportCandidate,
): Promise<{ contactId: string; matchedBy: 'email' | 'phone' | 'linkedin' } | null> {
  const emailMatch =
    candidate.emails.length > 0
      ? await prismaClient.contactMethod.findFirst({
          where: {
            type: ContactMethodType.EMAIL,
            value: { in: candidate.emails },
          },
          select: { contactId: true },
        })
      : null;

  const phoneMatch =
    candidate.phones.length > 0
      ? await prismaClient.contactMethod.findFirst({
          where: {
            type: ContactMethodType.PHONE,
            value: { in: candidate.phones },
          },
          select: { contactId: true },
        })
      : null;

  const linkedinMatch =
    candidate.linkedin
      ? await prismaClient.contactMethod.findFirst({
          where: {
            type: ContactMethodType.LINKEDIN,
            value: candidate.linkedin,
          },
          select: { contactId: true },
        })
      : null;

  return resolveDeterministicMatch({
    emailContactId: emailMatch?.contactId,
    phoneContactId: phoneMatch?.contactId,
    linkedinContactId: linkedinMatch?.contactId,
  });
}

async function findFuzzyDuplicate(
  prismaClient: PrismaClient,
  candidate: NormalizedImportCandidate,
): Promise<{ contactId: string; score: number } | null> {
  if (!candidate.fullName) {
    return null;
  }

  const threshold = getFuzzyThreshold();
  const companyName = candidate.company ?? '';
  const city = candidate.city ?? '';
  const country = candidate.country ?? '';

  type FuzzyResultRow = {
    contact_id: string;
    score: number | string;
  };

  const rows = await prismaClient.$queryRaw<FuzzyResultRow[]>`
    SELECT
      c.id AS contact_id,
      (
        similarity(c.full_name, ${candidate.fullName}) * 0.7 +
        similarity(COALESCE(co.name, ''), ${companyName}) * 0.2 +
        GREATEST(
          similarity(COALESCE(c.location_city, ''), ${city}),
          similarity(COALESCE(c.location_country, ''), ${country})
        ) * 0.1
      ) AS score
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.current_company_id
    ORDER BY score DESC
    LIMIT 1
  `;

  if (!rows.length) {
    return null;
  }

  const score = Number(rows[0].score);

  if (!Number.isFinite(score) || score < threshold) {
    return null;
  }

  return {
    contactId: rows[0].contact_id,
    score,
  };
}

async function updateExistingContact(
  prismaClient: PrismaClient,
  contactId: string,
  candidate: NormalizedImportCandidate,
  batchId: string,
  companyCache: Map<string, string>,
): Promise<{ updated: boolean }> {
  const contact = await prismaClient.contact.findUnique({
    where: { id: contactId },
    include: {
      contactMethods: true,
    },
  });

  if (!contact) {
    return { updated: false };
  }

  const updateData: Prisma.ContactUncheckedUpdateInput = {};

  if (!contact.firstName && candidate.firstName) {
    updateData.firstName = candidate.firstName;
  }

  if (!contact.lastName && candidate.lastName) {
    updateData.lastName = candidate.lastName;
  }

  if (!contact.fullName && candidate.fullName) {
    updateData.fullName = candidate.fullName;
  }

  if (!contact.currentTitle && candidate.title) {
    updateData.currentTitle = candidate.title;
  }

  if (!contact.locationCity && candidate.city) {
    updateData.locationCity = candidate.city;
  }

  if (!contact.locationCountry && candidate.country) {
    updateData.locationCountry = candidate.country;
  }

  if (!contact.currentCompanyId && candidate.company) {
    const companyId = await getOrCreateCompanyId(prismaClient, candidate.company, companyCache);
    updateData.currentCompanyId = companyId;
  }

  if (candidate.notesContext) {
    const existingNotes = contact.notesRaw?.trim() ?? '';
    if (existingNotes.length === 0) {
      updateData.notesRaw = candidate.notesContext;
    } else if (!existingNotes.toLowerCase().includes(candidate.notesContext.toLowerCase())) {
      updateData.notesRaw = `${existingNotes}\n\n${candidate.notesContext}`;
    }
  }

  let updated = false;
  if (Object.keys(updateData).length > 0) {
    await prismaClient.contact.update({
      where: { id: contactId },
      data: updateData,
    });
    updated = true;
  }

  const existingMethods = new Set(contact.contactMethods.map((method) => `${method.type}:${method.value}`));
  const candidateMethods = buildCandidateMethods(candidate);
  const methodsToCreate = candidateMethods.filter(
    (method) => !existingMethods.has(`${method.type}:${method.value}`),
  );

  if (methodsToCreate.length > 0) {
    await prismaClient.contactMethod.createMany({
      data: methodsToCreate.map((method, index) => ({
        contactId,
        type: method.type,
        value: method.value,
        isPrimary: index === 0,
        source: 'import',
      })),
      skipDuplicates: true,
    });
    updated = true;
  }

  if (updated) {
    await prismaClient.auditLog.create({
      data: {
        action: 'import.contact_updated',
        entityType: 'contact',
        entityId: contactId,
        metaJson: {
          sourceImportBatchId: batchId,
        },
      },
    });
  }

  return { updated };
}

async function createContactFromImport(
  prismaClient: PrismaClient,
  batchId: string,
  candidate: NormalizedImportCandidate,
  companyCache: Map<string, string>,
): Promise<string> {
  const companyId = candidate.company
    ? await getOrCreateCompanyId(prismaClient, candidate.company, companyCache)
    : null;

  const fallbackFullName =
    candidate.fullName ||
    [candidate.firstName, candidate.lastName].filter(Boolean).join(' ').trim() ||
    candidate.emails[0] ||
    candidate.phones[0] ||
    `Imported Contact ${Date.now()}`;

  const methods = buildCandidateMethods(candidate);

  const created = await prismaClient.contact.create({
    data: {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      fullName: fallbackFullName,
      notesRaw: candidate.notesContext,
      locationCity: candidate.city,
      locationCountry: candidate.country,
      currentTitle: candidate.title,
      currentCompanyId: companyId,
      sourceImportBatchId: batchId,
      contactMethods:
        methods.length > 0
          ? {
              create: methods.map((method, index) => ({
                type: method.type,
                value: method.value,
                isPrimary: index === 0,
                source: 'import',
              })),
            }
          : undefined,
    },
  });

  await prismaClient.auditLog.create({
    data: {
      action: 'import.contact_inserted',
      entityType: 'contact',
      entityId: created.id,
      metaJson: {
        sourceImportBatchId: batchId,
      },
    },
  });

  return created.id;
}

async function getOrCreateCompanyId(
  prismaClient: PrismaClient,
  companyName: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = companyName.toLowerCase();
  const cachedCompanyId = cache.get(key);
  if (cachedCompanyId) {
    return cachedCompanyId;
  }

  const existingCompany = await prismaClient.company.findFirst({
    where: {
      name: {
        equals: companyName,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
    },
  });

  if (existingCompany) {
    cache.set(key, existingCompany.id);
    return existingCompany.id;
  }

  const createdCompany = await prismaClient.company.create({
    data: {
      name: companyName,
    },
    select: {
      id: true,
    },
  });

  cache.set(key, createdCompany.id);
  return createdCompany.id;
}

function buildCandidateMethods(candidate: NormalizedImportCandidate): Array<{ type: ContactMethodType; value: string }> {
  const methods: Array<{ type: ContactMethodType; value: string }> = [];

  for (const email of candidate.emails) {
    methods.push({ type: ContactMethodType.EMAIL, value: email });
  }

  for (const phone of candidate.phones) {
    methods.push({ type: ContactMethodType.PHONE, value: phone });
  }

  if (candidate.linkedin) {
    methods.push({ type: ContactMethodType.LINKEDIN, value: candidate.linkedin });
  }

  if (candidate.website) {
    methods.push({ type: ContactMethodType.WEBSITE, value: candidate.website });
  }

  if (candidate.twitter) {
    methods.push({ type: ContactMethodType.TWITTER, value: candidate.twitter });
  }

  const deduped = new Map<string, { type: ContactMethodType; value: string }>();
  for (const method of methods) {
    deduped.set(`${method.type}:${method.value}`, method);
  }

  return Array.from(deduped.values());
}

function hasImportableData(candidate: NormalizedImportCandidate): boolean {
  return Boolean(
    candidate.fullName ||
      candidate.firstName ||
      candidate.lastName ||
      candidate.emails.length > 0 ||
      candidate.phones.length > 0 ||
      candidate.linkedin ||
      candidate.website ||
      candidate.twitter ||
      candidate.company ||
      candidate.notesContext,
  );
}

async function flushRowsBuffer(
  prismaClient: PrismaClient,
  rows: Prisma.ImportRowCreateManyInput[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const copy = [...rows];
  rows.length = 0;

  await prismaClient.importRow.createMany({
    data: copy,
  });
}

async function flushBatchCounters(
  prismaClient: PrismaClient,
  batchId: string,
  counters: BatchCounters,
  errorSamples: ErrorSample[],
): Promise<void> {
  await prismaClient.importBatch.update({
    where: { id: batchId },
    data: {
      totalRows: counters.totalRows,
      processedRows: counters.processedRows,
      insertedCount: counters.insertedCount,
      updatedCount: counters.updatedCount,
      skippedCount: counters.skippedCount,
      duplicateCount: counters.duplicateCount,
      errorCount: counters.errorCount,
      errorSampleJson: errorSamples as unknown as Prisma.InputJsonValue,
    },
  });
}

function toImportRowOutcome(outcome: RowOutcome): ImportRowOutcome {
  const mapping: Record<RowOutcome, ImportRowOutcome> = {
    inserted: ImportRowOutcome.INSERTED,
    updated: ImportRowOutcome.UPDATED,
    skipped: ImportRowOutcome.SKIPPED,
    duplicate: ImportRowOutcome.DUPLICATE,
    error: ImportRowOutcome.ERROR,
  };

  return mapping[outcome];
}

async function countCsvDataRows(filePath: string, delimiter: ',' | ';' | '|' | '\t'): Promise<number> {
  const parser = parse({
    columns: false,
    bom: true,
    delimiter,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    from_line: 2,
  });

  createReadStream(filePath).pipe(parser);

  let count = 0;
  for await (const record of parser) {
    void record;
    count += 1;
  }

  return count;
}

function shouldStoreRawRows(): boolean {
  return (process.env.IMPORT_STORE_RAW_ROWS ?? 'false').toLowerCase() === 'true';
}

function getImportDirectory(): string {
  return process.env.IMPORT_DATA_DIR ?? '/data/imports';
}

function getFuzzyThreshold(): number {
  const parsed = Number(process.env.IMPORT_FUZZY_THRESHOLD ?? 0.86);
  if (!Number.isFinite(parsed)) {
    return 0.86;
  }

  return Math.min(1, Math.max(0, parsed));
}

function getBatchWriteIntervalRows(): number {
  const parsed = Number(process.env.IMPORT_BATCH_WRITE_INTERVAL_ROWS ?? 250);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 250;
  }

  return Math.floor(parsed);
}

function getErrorSampleLimit(): number {
  const parsed = Number(process.env.IMPORT_ERROR_SAMPLE_LIMIT ?? 25);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }

  return Math.floor(parsed);
}
