import { randomUUID } from 'node:crypto';
import {
  ContactMethodType,
  EnrichmentRunStatus,
  PrismaClient,
  type Prisma,
} from '@prisma/client';
import {
  createEnrichmentRunSchema,
  type CreateEnrichmentRunInput,
  type EnrichmentContactMethodType,
  type EnrichmentFieldName,
  type EnrichmentProvider,
  type EnrichmentProviderMethodCandidate,
  type EnrichmentProviderName,
  type EnrichmentProviderStatus,
  type EnrichmentRunSelectionInput,
} from '@hersov/shared';
import { planContactMethodChanges, shouldApplyFieldUpdate } from './merge';
import { createEnrichmentProviderRegistry } from './providers/registry';
import { ProviderRateLimiter } from './rate-limiter';
import { enqueueEmbeddingUpsertContactJobs } from '../embeddings/dispatch';
import { enqueueInsightsUpsertContactJobs } from '../insights/dispatch';

const prisma = new PrismaClient();

export interface EnrichmentRunJobPayload {
  runId: string;
}

interface RunCounters {
  [key: string]: number;
  totalTargets: number;
  processedTargets: number;
  updatedContacts: number;
  skippedContacts: number;
  errorCount: number;
}

interface EnrichmentChangeRow {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  confidence: number;
  provider: string;
  providerRef?: string;
  evidenceUrl?: string;
}

interface ErrorSample {
  rowIndex: number;
  message: string;
}

type EnrichmentContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  notesRaw: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  currentTitle: string | null;
  currentCompanyId: string | null;
  currentCompany: { id: string; name: string; domain: string | null } | null;
  contactMethods: Array<{
    id: string;
    type: ContactMethodType;
    value: string;
    isPrimary: boolean;
    verifiedAt: Date | null;
  }>;
  tags: Array<{
    tagId: string;
    confidence: number | null;
    tag: {
      id: string;
      name: string;
      category: string;
    };
  }>;
  fieldConfidence: Array<{
    field: string;
    confidence: number;
    provider: string;
  }>;
};

const contactScalarFieldConfig: Record<
  Exclude<EnrichmentFieldName, 'company_name'>,
  {
    getValue: (contact: {
      firstName: string | null;
      lastName: string | null;
      fullName: string;
      locationCity: string | null;
      locationCountry: string | null;
      currentTitle: string | null;
      notesRaw: string | null;
    }) => string | null;
    assign: (payload: Prisma.ContactUncheckedUpdateInput, value: string) => void;
  }
> = {
  first_name: {
    getValue: (contact) => contact.firstName,
    assign: (payload, value) => {
      payload.firstName = value;
    },
  },
  last_name: {
    getValue: (contact) => contact.lastName,
    assign: (payload, value) => {
      payload.lastName = value;
    },
  },
  full_name: {
    getValue: (contact) => contact.fullName,
    assign: (payload, value) => {
      payload.fullName = value;
    },
  },
  location_city: {
    getValue: (contact) => contact.locationCity,
    assign: (payload, value) => {
      payload.locationCity = value;
    },
  },
  location_country: {
    getValue: (contact) => contact.locationCountry,
    assign: (payload, value) => {
      payload.locationCountry = value;
    },
  },
  current_title: {
    getValue: (contact) => contact.currentTitle,
    assign: (payload, value) => {
      payload.currentTitle = value;
    },
  },
  notes_raw: {
    getValue: (contact) => contact.notesRaw,
    assign: (payload, value) => {
      payload.notesRaw = value;
    },
  },
};

const methodTypeToPrisma: Record<EnrichmentContactMethodType, ContactMethodType> = {
  email: ContactMethodType.EMAIL,
  phone: ContactMethodType.PHONE,
  website: ContactMethodType.WEBSITE,
  linkedin: ContactMethodType.LINKEDIN,
  twitter: ContactMethodType.TWITTER,
  other: ContactMethodType.OTHER,
};

export const processEnrichmentRun = createEnrichmentRunProcessor(prisma);

export async function closeEnrichmentRunProcessor(): Promise<void> {
  await prisma.$disconnect();
}

export function createEnrichmentRunProcessor(prismaClient: PrismaClient) {
  return async (payload: EnrichmentRunJobPayload): Promise<void> => {
    const run = await prismaClient.enrichmentRun.findUnique({
      where: { id: payload.runId },
    });

    if (!run) {
      throw new Error(`Enrichment run ${payload.runId} not found`);
    }

    if (
      run.status === EnrichmentRunStatus.CANCELED
      || run.status === EnrichmentRunStatus.COMPLETED
      || run.status === EnrichmentRunStatus.FAILED
    ) {
      return;
    }

    const parsedConfig = createEnrichmentRunSchema.safeParse(run.configJson);
    if (!parsedConfig.success) {
      await markRunFailed(prismaClient, run.id, undefined, [
        {
          rowIndex: 0,
          message: 'Invalid enrichment run config',
        },
      ]);
      throw new Error('Invalid enrichment run config');
    }

    const config = parsedConfig.data;

    const providerRegistry = createEnrichmentProviderRegistry();
    const providerMap = resolveProviders(config.providers, providerRegistry.statuses, providerRegistry.enabledProviders);

    const runWhere = buildSelectionWhere(config.selection);
    const totalTargets = await prismaClient.contact.count({ where: runWhere });

    const counters: RunCounters = {
      totalTargets,
      processedTargets: 0,
      updatedContacts: 0,
      skippedContacts: 0,
      errorCount: 0,
    };

    const errorSamples: ErrorSample[] = [];

    await prismaClient.enrichmentRun.update({
      where: { id: run.id },
      data: {
        status: EnrichmentRunStatus.PROCESSING,
        startedAt: run.startedAt ?? new Date(),
        finishedAt: null,
        totalTargets,
        processedTargets: 0,
        updatedContacts: 0,
        skippedContacts: 0,
        errorCount: 0,
        errorSampleJson: [],
      },
    });

    await writeAuditLog(prismaClient, {
      actorUserId: run.createdByUserId ?? undefined,
      action: 'enrichment.run_started',
      entityType: 'enrichment_run',
      entityId: run.id,
      metaJson: {
        totalTargets,
      },
    });

    if (totalTargets === 0) {
      await prismaClient.enrichmentRun.update({
        where: { id: run.id },
        data: {
          status: EnrichmentRunStatus.COMPLETED,
          finishedAt: new Date(),
          statsJson: {
            providers: config.providers,
            mergePolicy: config.mergePolicy,
            dryRun: config.dryRun,
            totalTargets,
            processedTargets: 0,
            updatedContacts: 0,
            skippedContacts: 0,
            errorCount: 0,
          },
        },
      });

      await writeAuditLog(prismaClient, {
        actorUserId: run.createdByUserId ?? undefined,
        action: 'enrichment.run_completed',
        entityType: 'enrichment_run',
        entityId: run.id,
        metaJson: {
          updatedContacts: 0,
          skippedContacts: 0,
          errorCount: 0,
        },
      });

      return;
    }

    const providerLimiters = createProviderLimiters(providerRegistry.statuses);
    const companyCache = new Map<string, string>();
    const tagCache = new Map<string, string>();
    const contactsToEmbed = new Set<string>();
    const confidenceThreshold = getConfidenceThreshold();
    const writeIntervalRows = getWriteIntervalRows();
    const writeIntervalMs = 2_000;
    let lastWriteAt = Date.now();

    try {
      let cursorId: string | null = null;

      while (true) {
        const shouldCancel = await isRunCanceled(prismaClient, run.id);
        if (shouldCancel) {
          await prismaClient.enrichmentRun.update({
            where: { id: run.id },
            data: {
              status: EnrichmentRunStatus.CANCELED,
              finishedAt: new Date(),
              errorSampleJson: errorSamples as unknown as Prisma.InputJsonValue,
              statsJson: {
                providers: config.providers,
                mergePolicy: config.mergePolicy,
                dryRun: config.dryRun,
                ...counters,
              },
            },
          });
          return;
        }

        const contacts: EnrichmentContactRow[] = await prismaClient.contact.findMany({
          where: runWhere,
          take: getBatchSize(),
          ...(cursorId
            ? {
                skip: 1,
                cursor: {
                  id: cursorId,
                },
              }
            : {}),
          orderBy: { id: 'asc' },
          include: {
            currentCompany: true,
            contactMethods: true,
            tags: {
              include: {
                tag: true,
              },
            },
            fieldConfidence: true,
          },
        });

        if (contacts.length === 0) {
          break;
        }

        for (const contact of contacts) {
          counters.processedTargets += 1;

          try {
            const outcome = await processSingleContact({
              prismaClient,
              runId: run.id,
              contact,
              config,
              providers: providerMap,
              limiters: providerLimiters,
              companyCache,
              tagCache,
              confidenceThreshold,
            });

            if (outcome.updated) {
              counters.updatedContacts += 1;
              if (!config.dryRun) {
                contactsToEmbed.add(contact.id);
              }
            } else {
              counters.skippedContacts += 1;
            }
          } catch (error) {
            counters.errorCount += 1;

            if (errorSamples.length < getErrorSampleLimit()) {
              errorSamples.push({
                rowIndex: counters.processedTargets,
                message: (error as Error).message,
              });
            }
          }

          const now = Date.now();
          const shouldFlush =
            counters.processedTargets % writeIntervalRows === 0 || now - lastWriteAt >= writeIntervalMs;

          if (shouldFlush) {
            await flushRunProgress(prismaClient, run.id, counters, errorSamples, config);
            lastWriteAt = now;
          }
        }

        cursorId = contacts[contacts.length - 1]?.id ?? null;
      }

      await flushRunProgress(prismaClient, run.id, counters, errorSamples, config);

      await prismaClient.enrichmentRun.update({
        where: { id: run.id },
        data: {
          status: EnrichmentRunStatus.COMPLETED,
          finishedAt: new Date(),
          statsJson: {
            providers: config.providers,
            mergePolicy: config.mergePolicy,
            dryRun: config.dryRun,
            ...counters,
          },
        },
      });

      await writeAuditLog(prismaClient, {
        actorUserId: run.createdByUserId ?? undefined,
        action: 'enrichment.run_completed',
        entityType: 'enrichment_run',
        entityId: run.id,
        metaJson: counters,
      });

      if (!config.dryRun) {
        try {
          await enqueueEmbeddingUpsertContactJobs(
            Array.from(contactsToEmbed),
            `enrichment:${run.id}`,
          );
        } catch (error) {
          console.warn('Failed to enqueue embedding upserts after enrichment completion', error);
        }

        if (process.env.INSIGHTS_ENABLED === '1' || process.env.INSIGHTS_ENABLED === 'true') {
          try {
            await enqueueInsightsUpsertContactJobs(Array.from(contactsToEmbed), {
              reason: `enrichment:${run.id}`,
              fillMissingOnly: true,
              requestedByUserId: run.createdByUserId ?? undefined,
            });
          } catch (error) {
            console.warn('Failed to enqueue insights upserts after enrichment completion', error);
          }
        }
      }
    } catch (error) {
      if (errorSamples.length < getErrorSampleLimit()) {
        errorSamples.push({
          rowIndex: counters.processedTargets,
          message: (error as Error).message,
        });
      }

      await markRunFailed(prismaClient, run.id, run.createdByUserId ?? undefined, errorSamples, counters, config);
      throw error;
    }
  };
}

function resolveProviders(
  providerNames: EnrichmentProviderName[],
  statuses: EnrichmentProviderStatus[],
  enabledProviders: Map<EnrichmentProviderName, EnrichmentProvider>,
): Map<EnrichmentProviderName, EnrichmentProvider> {
  const resolved = new Map<EnrichmentProviderName, EnrichmentProvider>();

  for (const providerName of providerNames) {
    const status = statuses.find((item) => item.name === providerName);
    const provider = enabledProviders.get(providerName);

    if (!status || !status.enabled || !provider) {
      throw new Error(`Provider ${providerName} is not configured`);
    }

    resolved.set(providerName, provider);
  }

  return resolved;
}

async function processSingleContact(input: {
  prismaClient: PrismaClient;
  runId: string;
  contact: EnrichmentContactRow;
  config: CreateEnrichmentRunInput;
  providers: Map<EnrichmentProviderName, EnrichmentProvider>;
  limiters: Map<EnrichmentProviderName, ProviderRateLimiter>;
  companyCache: Map<string, string>;
  tagCache: Map<string, string>;
  confidenceThreshold: number;
}): Promise<{ updated: boolean }> {
  const { prismaClient, runId, contact, config, providers, limiters, companyCache, tagCache, confidenceThreshold } = input;

  const fieldConfidence = new Map<string, number>();
  for (const item of contact.fieldConfidence) {
    fieldConfidence.set(item.field, item.confidence);
  }

  const workingFields: Record<EnrichmentFieldName, string | null> = {
    first_name: contact.firstName,
    last_name: contact.lastName,
    full_name: contact.fullName,
    location_city: contact.locationCity,
    location_country: contact.locationCountry,
    current_title: contact.currentTitle,
    notes_raw: contact.notesRaw,
    company_name: contact.currentCompany?.name ?? null,
  };

  const methodCandidates: Array<EnrichmentProviderMethodCandidate & { provider: string }> = [];
  const tagCandidates: Array<{
    name: string;
    category: string;
    confidence: number;
    provider: string;
  }> = [];
  const fieldChanges: EnrichmentChangeRow[] = [];
  const updatedConfidenceEntries = new Map<string, { confidence: number; provider: string }>();

  for (const providerName of config.providers) {
    const provider = providers.get(providerName);
    const limiter = limiters.get(providerName);

    if (!provider || !limiter) {
      continue;
    }

    const providerOutput = await limiter.schedule(async () => {
      return provider.enrichContact({
        contact: {
          id: contact.id,
          firstName: workingFields.first_name,
          lastName: workingFields.last_name,
          fullName: workingFields.full_name ?? contact.fullName,
          notesRaw: workingFields.notes_raw,
          locationCity: workingFields.location_city,
          locationCountry: workingFields.location_country,
          currentTitle: workingFields.current_title,
          companyName: workingFields.company_name,
          companyDomain: contact.currentCompany?.domain ?? null,
          methods: contact.contactMethods.map((method) => ({
            type: prismaMethodToShared(method.type),
            value: method.value,
            isPrimary: method.isPrimary,
            verifiedAt: method.verifiedAt ? method.verifiedAt.toISOString() : null,
          })),
        },
      });
    });

    for (const fieldCandidate of providerOutput.fields) {
      const normalizedValue = normalizeString(fieldCandidate.value);
      if (!normalizedValue) {
        continue;
      }

      const key = `field:${fieldCandidate.field}`;
      const existingValue = workingFields[fieldCandidate.field];
      const existingConfidence = fieldConfidence.get(key) ?? 0;
      const incomingConfidence = clampConfidence(fieldCandidate.confidence);

      const shouldApply = shouldApplyFieldUpdate({
        policy: config.mergePolicy,
        existingValue,
        incomingValue: normalizedValue,
        existingConfidence,
        incomingConfidence,
        threshold: confidenceThreshold,
      });

      if (!shouldApply) {
        continue;
      }

      fieldChanges.push({
        field: fieldCandidate.field,
        oldValue: existingValue,
        newValue: normalizedValue,
        confidence: incomingConfidence,
        provider: providerName,
        providerRef: fieldCandidate.providerRef,
        evidenceUrl: fieldCandidate.evidenceUrl,
      });

      workingFields[fieldCandidate.field] = normalizedValue;
      fieldConfidence.set(key, incomingConfidence);
      updatedConfidenceEntries.set(key, {
        confidence: incomingConfidence,
        provider: providerName,
      });
    }

    for (const methodCandidate of providerOutput.methods) {
      methodCandidates.push({
        ...methodCandidate,
        provider: providerName,
      });
    }

    for (const tagCandidate of providerOutput.tags) {
      const name = normalizeString(tagCandidate.name);
      const category = normalizeString(tagCandidate.category);
      if (!name || !category) {
        continue;
      }

      tagCandidates.push({
        name,
        category,
        confidence: clampConfidence(tagCandidate.confidence),
        provider: providerName,
      });
    }
  }

  const methodPlan = planContactMethodChanges({
    existingMethods: contact.contactMethods.map((method) => ({
      id: method.id,
      type: prismaMethodToShared(method.type),
      value: method.value,
      isPrimary: method.isPrimary,
      verifiedAt: method.verifiedAt ? method.verifiedAt.toISOString() : null,
    })),
    candidates: methodCandidates,
  });

  for (const method of methodPlan.createMethods) {
    fieldChanges.push({
      field: `method:${method.type}`,
      oldValue: null,
      newValue: method.value,
      confidence: clampConfidence(method.confidence),
      provider: method.provider,
      providerRef: method.providerRef,
      evidenceUrl: method.evidenceUrl,
    });

    fieldConfidence.set(`method:${method.type}:${method.value}`, clampConfidence(method.confidence));
    updatedConfidenceEntries.set(`method:${method.type}:${method.value}`, {
      confidence: clampConfidence(method.confidence),
      provider: method.provider,
    });
  }

  for (const primaryChange of methodPlan.setPrimary) {
    const existingPrimary = contact.contactMethods.find(
      (method) => prismaMethodToShared(method.type) === primaryChange.type && method.isPrimary,
    );

    fieldChanges.push({
      field: `method:${primaryChange.type}:primary`,
      oldValue: existingPrimary?.value ?? null,
      newValue: primaryChange.value,
      confidence: clampConfidence(primaryChange.confidence),
      provider: primaryChange.provider,
      providerRef: primaryChange.providerRef,
      evidenceUrl: primaryChange.evidenceUrl,
    });

    fieldConfidence.set(
      `method:${primaryChange.type}:${primaryChange.value}`,
      clampConfidence(primaryChange.confidence),
    );
    updatedConfidenceEntries.set(`method:${primaryChange.type}:${primaryChange.value}`, {
      confidence: clampConfidence(primaryChange.confidence),
      provider: primaryChange.provider,
    });
  }

  const existingTagKeys = new Set(
    contact.tags.map((tag) => `${tag.tag.category.toLowerCase()}:${tag.tag.name.toLowerCase()}`),
  );

  const mergedTagCandidates = new Map<
    string,
    {
      name: string;
      category: string;
      confidence: number;
      provider: string;
    }
  >();

  for (const tagCandidate of tagCandidates) {
    const key = `${tagCandidate.category.toLowerCase()}:${tagCandidate.name.toLowerCase()}`;
    const existing = mergedTagCandidates.get(key);

    if (!existing || tagCandidate.confidence >= existing.confidence) {
      mergedTagCandidates.set(key, tagCandidate);
    }
  }

  for (const tagCandidate of mergedTagCandidates.values()) {
    const key = `${tagCandidate.category.toLowerCase()}:${tagCandidate.name.toLowerCase()}`;

    if (!existingTagKeys.has(key)) {
      fieldChanges.push({
        field: `tag:${tagCandidate.category}`,
        oldValue: null,
        newValue: tagCandidate.name,
        confidence: tagCandidate.confidence,
        provider: tagCandidate.provider,
      });
    }
  }

  const hasChanges = fieldChanges.length > 0;

  if (config.dryRun) {
    if (hasChanges) {
      await prismaClient.enrichmentResult.createMany({
        data: fieldChanges.map((change) => ({
          id: randomUUID(),
          runId,
          contactId: contact.id,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          confidence: change.confidence,
          provider: change.provider,
          providerRef: change.providerRef,
          evidenceUrl: change.evidenceUrl,
        })),
      });
    }

    return { updated: hasChanges };
  }

  await prismaClient.$transaction(async (transaction) => {
    const contactUpdatePayload: Prisma.ContactUncheckedUpdateInput = {};

    for (const change of fieldChanges) {
      if (change.field.startsWith('method:') || change.field.startsWith('tag:')) {
        continue;
      }

      if (change.field === 'company_name') {
        if (change.newValue) {
          const companyId = await getOrCreateCompanyId(transaction, change.newValue, companyCache);
          contactUpdatePayload.currentCompanyId = companyId;
        }
        continue;
      }

      const fieldName = change.field as Exclude<EnrichmentFieldName, 'company_name'>;
      contactScalarFieldConfig[fieldName].assign(contactUpdatePayload, change.newValue ?? '');
    }

    contactUpdatePayload.lastEnrichedAt = new Date();

    if (Object.keys(contactUpdatePayload).length > 0) {
      await transaction.contact.update({
        where: { id: contact.id },
        data: contactUpdatePayload,
      });
    }

    for (const createMethod of methodPlan.createMethods) {
      await transaction.contactMethod.upsert({
        where: {
          contactId_type_value: {
            contactId: contact.id,
            type: methodTypeToPrisma[createMethod.type],
            value: createMethod.value,
          },
        },
        update: {
          source: 'enrichment',
          verifiedAt: createMethod.verifiedAt ? new Date(createMethod.verifiedAt) : undefined,
        },
        create: {
          contactId: contact.id,
          type: methodTypeToPrisma[createMethod.type],
          value: createMethod.value,
          isPrimary: false,
          source: 'enrichment',
          verifiedAt: createMethod.verifiedAt ? new Date(createMethod.verifiedAt) : null,
        },
      });
    }

    for (const verifyMethod of methodPlan.verifyExistingMethodIds) {
      await transaction.contactMethod.update({
        where: { id: verifyMethod.methodId },
        data: {
          verifiedAt: new Date(verifyMethod.verifiedAt),
        },
      });
    }

    for (const primary of methodPlan.setPrimary) {
      await transaction.contactMethod.updateMany({
        where: {
          contactId: contact.id,
          type: methodTypeToPrisma[primary.type],
        },
        data: {
          isPrimary: false,
        },
      });

      await transaction.contactMethod.updateMany({
        where: {
          contactId: contact.id,
          type: methodTypeToPrisma[primary.type],
          value: primary.value,
        },
        data: {
          isPrimary: true,
        },
      });
    }

    for (const tagCandidate of mergedTagCandidates.values()) {
      const existingContactTag = contact.tags.find(
        (item) =>
          item.tag.name.toLowerCase() === tagCandidate.name.toLowerCase() &&
          item.tag.category.toLowerCase() === tagCandidate.category.toLowerCase(),
      );

      if (
        existingContactTag
        && existingContactTag.confidence !== null
        && existingContactTag.confidence >= tagCandidate.confidence
      ) {
        continue;
      }

      const tagId = await getOrCreateTagId(transaction, tagCandidate.name, tagCandidate.category, tagCache);

      await transaction.contactTag.upsert({
        where: {
          contactId_tagId: {
            contactId: contact.id,
            tagId,
          },
        },
        update: {
          confidence: tagCandidate.confidence,
          source: `enrichment:${tagCandidate.provider}`,
        },
        create: {
          contactId: contact.id,
          tagId,
          confidence: tagCandidate.confidence,
          source: `enrichment:${tagCandidate.provider}`,
        },
      });
    }

    if (hasChanges) {
      await transaction.enrichmentResult.createMany({
        data: fieldChanges.map((change) => ({
          id: randomUUID(),
          runId,
          contactId: contact.id,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          confidence: change.confidence,
          provider: change.provider,
          providerRef: change.providerRef,
          evidenceUrl: change.evidenceUrl,
        })),
      });
    }

    for (const [field, entry] of updatedConfidenceEntries.entries()) {
      const confidence = entry.confidence;
      const provider = entry.provider;

      await transaction.contactFieldConfidence.upsert({
        where: {
          contactId_field: {
            contactId: contact.id,
            field,
          },
        },
        update: {
          confidence,
          provider,
        },
        create: {
          contactId: contact.id,
          field,
          confidence,
          provider,
        },
      });
    }
  });

  return {
    updated: hasChanges,
  };
}

function createProviderLimiters(statuses: EnrichmentProviderStatus[]): Map<EnrichmentProviderName, ProviderRateLimiter> {
  const output = new Map<EnrichmentProviderName, ProviderRateLimiter>();

  for (const status of statuses) {
    output.set(status.name, new ProviderRateLimiter(status.rateLimit.rpm, status.rateLimit.concurrency));
  }

  return output;
}

function buildSelectionWhere(selection: EnrichmentRunSelectionInput): Prisma.ContactWhereInput {
  const andConditions: Prisma.ContactWhereInput[] = [];

  if (selection.explicitContactIds && selection.explicitContactIds.length > 0) {
    andConditions.push({
      id: {
        in: selection.explicitContactIds,
      },
    });
  }

  if (selection.missingEmail) {
    andConditions.push({
      contactMethods: {
        none: {
          type: ContactMethodType.EMAIL,
        },
      },
    });
  }

  if (selection.missingLinkedin) {
    andConditions.push({
      contactMethods: {
        none: {
          type: ContactMethodType.LINKEDIN,
        },
      },
    });
  }

  if (selection.missingLocation) {
    andConditions.push({
      OR: [
        { locationCity: null },
        { locationCity: '' },
        { locationCountry: null },
        { locationCountry: '' },
      ],
    });
  }

  if (selection.country) {
    andConditions.push({
      locationCountry: {
        equals: selection.country,
        mode: 'insensitive',
      },
    });
  }

  if (selection.companyId) {
    andConditions.push({
      currentCompanyId: selection.companyId,
    });
  }

  if (selection.company) {
    andConditions.push({
      currentCompany: {
        is: {
          name: {
            contains: selection.company,
            mode: 'insensitive',
          },
        },
      },
    });
  }

  if (selection.importedBatchId) {
    andConditions.push({
      sourceImportBatchId: selection.importedBatchId,
    });
  }

  if (selection.tag) {
    andConditions.push({
      tags: {
        some: {
          OR: [
            {
              tagId: selection.tag,
            },
            {
              tag: {
                name: {
                  equals: selection.tag,
                  mode: 'insensitive',
                },
              },
            },
          ],
        },
      },
    });
  }

  if (andConditions.length === 0) {
    return {};
  }

  return {
    AND: andConditions,
  };
}

async function isRunCanceled(prismaClient: PrismaClient, runId: string): Promise<boolean> {
  const run = await prismaClient.enrichmentRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });

  return run?.status === EnrichmentRunStatus.CANCELED;
}

async function flushRunProgress(
  prismaClient: PrismaClient,
  runId: string,
  counters: RunCounters,
  errorSamples: ErrorSample[],
  config: CreateEnrichmentRunInput,
): Promise<void> {
  await prismaClient.enrichmentRun.update({
    where: { id: runId },
    data: {
      totalTargets: counters.totalTargets,
      processedTargets: counters.processedTargets,
      updatedContacts: counters.updatedContacts,
      skippedContacts: counters.skippedContacts,
      errorCount: counters.errorCount,
      errorSampleJson: errorSamples as unknown as Prisma.InputJsonValue,
      statsJson: {
        providers: config.providers,
        mergePolicy: config.mergePolicy,
        dryRun: config.dryRun,
        ...counters,
      },
    },
  });
}

async function markRunFailed(
  prismaClient: PrismaClient,
  runId: string,
  actorUserId: string | undefined,
  errorSamples: ErrorSample[],
  counters?: RunCounters,
  config?: CreateEnrichmentRunInput,
): Promise<void> {
  await prismaClient.enrichmentRun.update({
    where: { id: runId },
    data: {
      status: EnrichmentRunStatus.FAILED,
      finishedAt: new Date(),
      errorCount: counters?.errorCount ?? errorSamples.length,
      errorSampleJson: errorSamples as unknown as Prisma.InputJsonValue,
      statsJson: config
        ? {
            providers: config.providers,
            mergePolicy: config.mergePolicy,
            dryRun: config.dryRun,
            ...(counters ?? {}),
          }
        : undefined,
    },
  });

  await writeAuditLog(prismaClient, {
    actorUserId,
    action: 'enrichment.run_failed',
    entityType: 'enrichment_run',
    entityId: runId,
    metaJson: {
      errorCount: counters?.errorCount ?? errorSamples.length,
    },
  });
}

async function writeAuditLog(
  prismaClient: PrismaClient,
  input: {
    actorUserId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    metaJson?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await prismaClient.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metaJson: input.metaJson as Prisma.InputJsonValue | undefined,
        },
      });
  } catch (error) {
    console.warn('Failed to write enrichment audit log', error);
  }
}

async function getOrCreateCompanyId(
  prismaClient: Prisma.TransactionClient,
  companyName: string,
  companyCache: Map<string, string>,
): Promise<string> {
  const normalized = normalizeString(companyName);
  const cacheKey = normalized.toLowerCase();

  const cached = companyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existing = await prismaClient.company.findFirst({
    where: {
      name: {
        equals: normalized,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    companyCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await prismaClient.company.create({
    data: {
      name: normalized,
    },
    select: {
      id: true,
    },
  });

  companyCache.set(cacheKey, created.id);
  return created.id;
}

async function getOrCreateTagId(
  prismaClient: Prisma.TransactionClient,
  name: string,
  category: string,
  tagCache: Map<string, string>,
): Promise<string> {
  const normalizedName = normalizeString(name);
  const normalizedCategory = normalizeString(category);
  const cacheKey = `${normalizedCategory.toLowerCase()}:${normalizedName.toLowerCase()}`;

  const cached = tagCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existing = await prismaClient.tag.findUnique({
    where: {
      name_category: {
        name: normalizedName,
        category: normalizedCategory,
      },
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    tagCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await prismaClient.tag.create({
    data: {
      name: normalizedName,
      category: normalizedCategory,
    },
    select: {
      id: true,
    },
  });

  tagCache.set(cacheKey, created.id);
  return created.id;
}

function prismaMethodToShared(type: ContactMethodType): EnrichmentContactMethodType {
  const mapping: Record<ContactMethodType, EnrichmentContactMethodType> = {
    [ContactMethodType.EMAIL]: 'email',
    [ContactMethodType.PHONE]: 'phone',
    [ContactMethodType.WEBSITE]: 'website',
    [ContactMethodType.LINKEDIN]: 'linkedin',
    [ContactMethodType.TWITTER]: 'twitter',
    [ContactMethodType.OTHER]: 'other',
  };

  return mapping[type];
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeString(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function getBatchSize(): number {
  const parsed = Number(process.env.ENRICHMENT_BATCH_SIZE ?? 50);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.floor(parsed);
}

function getWriteIntervalRows(): number {
  const parsed = Number(process.env.ENRICHMENT_BATCH_WRITE_INTERVAL_TARGETS ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.floor(parsed);
}

function getConfidenceThreshold(): number {
  const parsed = Number(process.env.ENRICHMENT_OVERWRITE_CONFIDENCE_DELTA ?? 0.1);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0.1;
  }

  return parsed;
}

function getErrorSampleLimit(): number {
  const parsed = Number(process.env.ENRICHMENT_ERROR_SAMPLE_LIMIT ?? 25);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }

  return Math.floor(parsed);
}
