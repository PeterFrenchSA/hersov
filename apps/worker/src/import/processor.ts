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
import { enqueueInsightsUpsertContactJobs } from '../insights/dispatch';

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

interface CompletedRow {
  rowIndex: number;
  rawRow: Record<string, unknown>;
  result: RowProcessResult;
}

interface InFlightRowTask {
  promise: Promise<{ task: InFlightRowTask; value: CompletedRow }>;
}

type LockMap = Map<string, Promise<void>>;

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
    const lockMap: LockMap = new Map<string, Promise<void>>();
    const contactsToEmbed = new Set<string>();
    const storeRawRows = shouldStoreRawRows();
    const rowConcurrency = getImportRowConcurrency();

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
      const inFlight = new Set<InFlightRowTask>();

      for await (const rawRow of parser as AsyncIterable<Record<string, unknown>>) {
        const currentRowIndex = rowIndex;
        const runTask = async (): Promise<CompletedRow> => {
          try {
            const result = await processRow(
              prismaClient,
              batchId,
              rawRow,
              mapping,
              companyCache,
              lockMap,
            );

            return {
              rowIndex: currentRowIndex,
              rawRow,
              result,
            };
          } catch (error) {
            return {
              rowIndex: currentRowIndex,
              rawRow,
              result: {
                outcome: 'error',
                errorMessage: (error as Error).message,
              },
            };
          }
        };

        const task = {} as InFlightRowTask;
        task.promise = runTask().then((value) => ({ task, value }));
        inFlight.add(task);

        if (inFlight.size >= rowConcurrency) {
          const completed = await Promise.race(Array.from(inFlight, (entry) => entry.promise));
          inFlight.delete(completed.task);
          await handleCompletedRow(
            batchId,
            completed.value,
            counters,
            errorSamples,
            rowRecordsBuffer,
            contactsToEmbed,
            storeRawRows,
          );

          const now = Date.now();
          const shouldWriteProgress =
            counters.processedRows % batchWriteIntervalRows === 0 || now - lastProgressWriteAt >= batchWriteIntervalMs;

          if (shouldWriteProgress) {
            await flushRowsBuffer(prismaClient, rowRecordsBuffer);
            await flushBatchCounters(prismaClient, batchId, counters, errorSamples);
            lastProgressWriteAt = now;
          }
        }

        rowIndex += 1;
      }

      while (inFlight.size > 0) {
        const completed = await Promise.race(Array.from(inFlight, (entry) => entry.promise));
        inFlight.delete(completed.task);
        await handleCompletedRow(
          batchId,
          completed.value,
          counters,
          errorSamples,
          rowRecordsBuffer,
          contactsToEmbed,
          storeRawRows,
        );
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

      if (process.env.INSIGHTS_ENABLED === '1' || process.env.INSIGHTS_ENABLED === 'true') {
        try {
          await enqueueInsightsUpsertContactJobs(Array.from(contactsToEmbed), {
            reason: `import:${batchId}`,
            fillMissingOnly: true,
            requestedByUserId: batch.createdByUserId ?? undefined,
          });
        } catch (error) {
          console.warn('Failed to enqueue insights upserts after import completion', error);
        }
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
  lockMap: LockMap,
): Promise<RowProcessResult> {
  const normalized = normalizeCsvRow(rawRow, mapping);

  if (!hasImportableData(normalized)) {
    return {
      outcome: 'skipped',
      normalized,
      errorMessage: 'Row contains no importable data',
    };
  }

  const lockKeys = buildImportLockKeys(normalized);

  return runWithLocks(lockMap, lockKeys, async () => {
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
        lockMap,
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
      lockMap,
    );

    return {
      outcome: 'inserted',
      contactId: createdContactId,
      normalized,
    };
  });
}

async function findDeterministicContactMatch(
  prismaClient: PrismaClient,
  candidate: NormalizedImportCandidate,
): Promise<{ contactId: string; matchedBy: 'email' | 'phone' | 'linkedin' } | null> {
  const [emailMatch, phoneMatch, linkedinMatch] = await Promise.all([
    candidate.emails.length > 0
      ? prismaClient.contactMethod.findFirst({
          where: {
            type: ContactMethodType.EMAIL,
            value: { in: candidate.emails },
          },
          select: { contactId: true },
        })
      : Promise.resolve(null),
    candidate.phones.length > 0
      ? prismaClient.contactMethod.findFirst({
          where: {
            type: ContactMethodType.PHONE,
            value: { in: candidate.phones },
          },
          select: { contactId: true },
        })
      : Promise.resolve(null),
    candidate.linkedin
      ? prismaClient.contactMethod.findFirst({
          where: {
            type: ContactMethodType.LINKEDIN,
            value: candidate.linkedin,
          },
          select: { contactId: true },
        })
      : Promise.resolve(null),
  ]);

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
  lockMap: LockMap,
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
    const companyId = await getOrCreateCompanyId(prismaClient, candidate.company, companyCache, lockMap);
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
  lockMap: LockMap,
): Promise<string> {
  const companyId = candidate.company
    ? await getOrCreateCompanyId(prismaClient, candidate.company, companyCache, lockMap)
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
  lockMap: LockMap,
): Promise<string> {
  return runWithLocks(lockMap, [`company:${companyName.toLowerCase()}`], async () => {
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
  });
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

async function handleCompletedRow(
  batchId: string,
  completedRow: CompletedRow,
  counters: BatchCounters,
  errorSamples: ErrorSample[],
  rowRecordsBuffer: Prisma.ImportRowCreateManyInput[],
  contactsToEmbed: Set<string>,
  storeRawRows: boolean,
): Promise<void> {
  counters.processedRows += 1;

  switch (completedRow.result.outcome) {
    case 'inserted':
      counters.insertedCount += 1;
      break;
    case 'updated':
      counters.updatedCount += 1;
      break;
    case 'skipped':
      counters.skippedCount += 1;
      break;
    case 'duplicate':
      counters.duplicateCount += 1;
      break;
    case 'error':
      counters.errorCount += 1;
      if (completedRow.result.errorMessage && errorSamples.length < getErrorSampleLimit()) {
        errorSamples.push({
          rowIndex: completedRow.rowIndex,
          message: completedRow.result.errorMessage,
        });
      }
      break;
  }

  if (
    completedRow.result.contactId &&
    (completedRow.result.outcome === 'inserted' || completedRow.result.outcome === 'updated')
  ) {
    contactsToEmbed.add(completedRow.result.contactId);
  }

  if (!storeRawRows) {
    return;
  }

  rowRecordsBuffer.push({
    batchId,
    rowIndex: completedRow.rowIndex,
    rawJson: completedRow.rawRow as unknown as Prisma.InputJsonValue,
    normalizedJson: completedRow.result.normalized as unknown as Prisma.InputJsonValue | undefined,
    outcome: toImportRowOutcome(completedRow.result.outcome),
    contactId: completedRow.result.contactId,
    errorMessage: completedRow.result.errorMessage,
  });
}

function buildImportLockKeys(candidate: NormalizedImportCandidate): string[] {
  const keys = new Set<string>();

  for (const email of candidate.emails) {
    keys.add(`email:${email}`);
  }

  for (const phone of candidate.phones) {
    keys.add(`phone:${phone}`);
  }

  if (candidate.linkedin) {
    keys.add(`linkedin:${candidate.linkedin}`);
  }

  if (keys.size === 0 && candidate.fullName) {
    const fallbackParts = [
      candidate.fullName,
      candidate.company ?? '',
      candidate.city ?? '',
      candidate.country ?? '',
    ]
      .map((part) => sanitizeLockKeyPart(part))
      .filter((part) => part.length > 0);

    if (fallbackParts.length > 0) {
      keys.add(`identity:${fallbackParts.join('|')}`);
    }
  }

  return Array.from(keys).sort();
}

async function runWithLocks<T>(
  lockMap: LockMap,
  keys: string[],
  callback: () => Promise<T>,
): Promise<T> {
  const uniqueKeys = Array.from(new Set(keys.filter((key) => key.length > 0))).sort();
  const releases: Array<() => void> = [];

  for (const key of uniqueKeys) {
    const previous = lockMap.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    lockMap.set(key, queued);
    await previous.catch(() => undefined);

    releases.push(() => {
      releaseCurrent();
      if (lockMap.get(key) === queued) {
        lockMap.delete(key);
      }
    });
  }

  try {
    return await callback();
  } finally {
    for (const release of releases.reverse()) {
      release();
    }
  }
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

function getImportRowConcurrency(): number {
  const parsed = Number(process.env.IMPORT_ROW_CONCURRENCY ?? 8);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8;
  }

  return Math.min(32, Math.floor(parsed));
}

function sanitizeLockKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
