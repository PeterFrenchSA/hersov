import { createHash } from 'node:crypto';
import {
  EntityType,
  LlmRunStatus,
  PrismaClient,
  Role,
  RelationshipStatus,
  ReviewKind,
  ReviewStatus,
  type Prisma,
} from '@prisma/client';
import {
  insightsBackfillSchema,
  type ContactInsightsExtraction,
  type InsightsBackfillInput,
} from '@hersov/shared';
import { enqueueGraphRecomputeScoresJob } from './dispatch';
import { extractInsightsWithModel, type InsightsExtractionResult } from './openai';
import {
  canonicalizeLabel,
  extractEvidenceSnippet,
  normalizeAlias,
  normalizeRelationshipType,
} from './normalization';

const prisma = new PrismaClient();

const PROMPT_NAME = 'contact_notes_insights';
const PROMPT_VERSION = 'v1';
const PROMPT_CONTENT = [
  'Extract CRM insights from notes into JSON.',
  'Only output fields grounded in text evidence.',
  'For each tag/entity/relationship include confidence and evidence snippet when available.',
].join('\n');

export interface InsightsUpsertContactPayload {
  contactId: string;
  force?: boolean;
  fillMissingOnly?: boolean;
  requestedByUserId?: string;
  reason?: string;
}

export interface InsightsBackfillPayload {
  filters?: InsightsBackfillInput;
  requestedByUserId?: string;
}

export interface GraphRecomputePayload {
  requestedByUserId?: string;
}

interface InsightsProcessorDeps {
  extractInsights: (input: {
    fullName: string;
    companyName: string | null;
    currentTitle: string | null;
    locationCity: string | null;
    locationCountry: string | null;
    notesRaw: string;
  }) => Promise<InsightsExtractionResult>;
  enqueueGraphRecompute: (requestedByUserId?: string) => Promise<void>;
}

const defaultDeps: InsightsProcessorDeps = {
  extractInsights: extractInsightsWithModel,
  enqueueGraphRecompute: enqueueGraphRecomputeScoresJob,
};

export const processInsightsUpsertContactJob = createInsightsUpsertContactProcessor(prisma, defaultDeps);
export const processInsightsBackfillJob = createInsightsBackfillProcessor(prisma, defaultDeps);
export const processGraphRecomputeScoresJob = createGraphRecomputeProcessor(prisma);

export async function closeInsightsProcessor(): Promise<void> {
  await prisma.$disconnect();
}

export function createInsightsUpsertContactProcessor(
  prismaClient: PrismaClient,
  deps: InsightsProcessorDeps,
) {
  return async (
    payload: InsightsUpsertContactPayload,
  ): Promise<{ updated: boolean; skippedReason?: string; llmRunId?: string }> => {
    if (!isInsightsEnabled()) {
      return { updated: false, skippedReason: 'insights_disabled' };
    }

    const contactId = payload.contactId?.trim();
    if (!contactId) {
      throw new Error('Missing contactId for insights upsert job');
    }

    const contact = await prismaClient.contact.findUnique({
      where: { id: contactId },
      include: {
        currentCompany: true,
        insights: true,
      },
    });

    if (!contact) {
      return { updated: false, skippedReason: 'contact_missing' };
    }

    const notesRaw = (contact.notesRaw ?? '').trim();
    if (!notesRaw) {
      return { updated: false, skippedReason: 'notes_empty' };
    }

    const notesHash = hashValue(notesRaw);
    const staleBefore = new Date(Date.now() - getInsightsStaleAfterDays() * 24 * 60 * 60 * 1000);
    const shouldUpdate =
      payload.force === true
      || !contact.insights
      || contact.insights.notesHash !== notesHash
      || contact.insights.updatedAt < staleBefore;

    if (!shouldUpdate) {
      return { updated: false, skippedReason: 'unchanged' };
    }

    await prismaClient.llmPromptVersion.upsert({
      where: {
        name_version: {
          name: PROMPT_NAME,
          version: PROMPT_VERSION,
        },
      },
      update: {
        content: PROMPT_CONTENT,
      },
      create: {
        name: PROMPT_NAME,
        version: PROMPT_VERSION,
        content: PROMPT_CONTENT,
      },
    });

    const truncatedNotes = notesRaw.slice(0, getInsightsMaxNotesChars());
    const llmInputHash = hashValue(
      JSON.stringify({
        fullName: contact.fullName,
        companyName: contact.currentCompany?.name ?? null,
        currentTitle: contact.currentTitle ?? null,
        locationCity: contact.locationCity ?? null,
        locationCountry: contact.locationCountry ?? null,
        notesRaw: truncatedNotes,
      }),
    );

    const llmRun = await prismaClient.llmRun.create({
      data: {
        purpose: 'insights.extract_contact',
        model: process.env.OPENAI_INSIGHTS_MODEL?.trim() || 'gpt-4.1-mini',
        promptVersion: `${PROMPT_NAME}:${PROMPT_VERSION}`,
        inputHash: llmInputHash,
        status: LlmRunStatus.PROCESSING,
      },
    });

    const startedAt = Date.now();

    try {
      const extraction = await deps.extractInsights({
        fullName: contact.fullName,
        companyName: contact.currentCompany?.name ?? null,
        currentTitle: contact.currentTitle,
        locationCity: contact.locationCity,
        locationCountry: contact.locationCountry,
        notesRaw: truncatedNotes,
      });

      const confidenceOverall = computeOverallConfidence(extraction.output);

      await prismaClient.contactInsight.upsert({
        where: {
          contactId,
        },
        update: {
          notesHash,
          insightsJson: extraction.output as unknown as Prisma.InputJsonValue,
          model: extraction.model,
          promptVersion: `${PROMPT_NAME}:${PROMPT_VERSION}`,
          confidenceOverall,
        },
        create: {
          contactId,
          notesHash,
          insightsJson: extraction.output as unknown as Prisma.InputJsonValue,
          model: extraction.model,
          promptVersion: `${PROMPT_NAME}:${PROMPT_VERSION}`,
          confidenceOverall,
        },
      });

      const suggestionCounts = await applySuggestions({
        prismaClient,
        contactId,
        notesRaw,
        extraction: extraction.output,
        model: extraction.model,
        promptVersion: `${PROMPT_NAME}:${PROMPT_VERSION}`,
        llmRunId: llmRun.id,
        createdByUserId: await resolveSuggestionActorUserId(prismaClient, payload.requestedByUserId),
        fillMissingOnly: payload.fillMissingOnly ?? true,
      });

      await prismaClient.llmRun.update({
        where: { id: llmRun.id },
        data: {
          model: extraction.model,
          status: LlmRunStatus.COMPLETED,
          tokensIn: extraction.tokensIn,
          tokensOut: extraction.tokensOut,
          latencyMs: Math.max(1, Date.now() - startedAt),
        },
      });

      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'insights.contact_processed',
        entityType: 'contact',
        entityId: contactId,
        metaJson: {
          reason: payload.reason ?? 'unspecified',
          llmRunId: llmRun.id,
          suggestionCounts,
        },
      });

      return { updated: true, llmRunId: llmRun.id };
    } catch (error) {
      await prismaClient.llmRun.update({
        where: { id: llmRun.id },
        data: {
          status: LlmRunStatus.FAILED,
          latencyMs: Math.max(1, Date.now() - startedAt),
          errorJson: {
            message: (error as Error).message,
          },
        },
      });

      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'insights.contact_failed',
        entityType: 'contact',
        entityId: contactId,
        metaJson: {
          llmRunId: llmRun.id,
          error: (error as Error).message,
        },
      });

      throw error;
    }
  };
}

export function createInsightsBackfillProcessor(
  prismaClient: PrismaClient,
  deps: InsightsProcessorDeps,
) {
  const upsertProcessor = createInsightsUpsertContactProcessor(prismaClient, deps);

  return async (
    payload: InsightsBackfillPayload,
  ): Promise<{ processed: number; updated: number; skipped: number; failed: number }> => {
    if (!isInsightsEnabled()) {
      return {
        processed: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
    }

    const filters = insightsBackfillSchema.parse(payload.filters ?? {});
    const where = buildBackfillWhere(filters);
    const totalLimit = filters.limit;
    const batchSize = Math.min(getInsightsBatchSize(), totalLimit);

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let cursorId: string | null = null;

    await writeAuditLog(prismaClient, {
      actorUserId: payload.requestedByUserId,
      action: 'insights.backfill_started',
      entityType: 'insights',
      metaJson: {
        filters,
      },
    });

    try {
      while (processed < totalLimit) {
        const remaining = totalLimit - processed;

        const contacts = await prismaClient.contact.findMany({
          where,
          orderBy: { id: 'asc' },
          take: Math.min(batchSize, remaining),
          ...(cursorId
            ? {
                skip: 1,
                cursor: { id: cursorId },
              }
            : {}),
          select: { id: true },
        });

        if (contacts.length === 0) {
          break;
        }

        for (const contact of contacts) {
          processed += 1;
          try {
            const result = await upsertProcessor({
              contactId: contact.id,
              force: filters.force,
              fillMissingOnly: filters.fillMissingOnly,
              requestedByUserId: payload.requestedByUserId,
              reason: 'backfill',
            });

            if (result.updated) {
              updated += 1;
            } else {
              skipped += 1;
            }
          } catch {
            failed += 1;
          }
        }

        cursorId = contacts[contacts.length - 1]?.id ?? null;
      }

      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'insights.backfill_completed',
        entityType: 'insights',
        metaJson: {
          filters,
          processed,
          updated,
          skipped,
          failed,
        },
      });

      if (updated > 0) {
        await deps.enqueueGraphRecompute(payload.requestedByUserId);
      }

      return { processed, updated, skipped, failed };
    } catch (error) {
      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'insights.backfill_failed',
        entityType: 'insights',
        metaJson: {
          filters,
          processed,
          updated,
          skipped,
          failed,
          error: (error as Error).message,
        },
      });
      throw error;
    }
  };
}

export function createGraphRecomputeProcessor(prismaClient: PrismaClient) {
  return async (payload: GraphRecomputePayload): Promise<{ updatedContacts: number }> => {
    await writeAuditLog(prismaClient, {
      actorUserId: payload.requestedByUserId,
      action: 'graph.recompute_started',
      entityType: 'graph',
    });

    try {
      const rows = await prismaClient.$queryRawUnsafe<Array<{
        contact_id: string;
        relationship_count: number | string;
        entity_count: number | string;
        event_count: number | string;
      }>>(`
        WITH rel_counts AS (
          SELECT x.contact_id, COUNT(DISTINCT x.relationship_id)::int AS relationship_count
          FROM (
            SELECT r.id AS relationship_id, r.from_contact_id AS contact_id
            FROM relationships r
            WHERE r.status = 'approved'
            UNION ALL
            SELECT r.id AS relationship_id, r.to_contact_id AS contact_id
            FROM relationships r
            WHERE r.status = 'approved' AND r.to_contact_id IS NOT NULL
          ) x
          GROUP BY x.contact_id
        ),
        entity_counts AS (
          SELECT m.contact_id, COUNT(DISTINCT m.entity_id)::int AS entity_count
          FROM contact_entity_mentions m
          WHERE m.source = 'insights-approved'
          GROUP BY m.contact_id
        ),
        event_counts AS (
          SELECT m.contact_id, COUNT(DISTINCT m.entity_id)::int AS event_count
          FROM contact_entity_mentions m
          JOIN entities e ON e.id = m.entity_id
          WHERE m.source = 'insights-approved' AND e.type = 'event'
          GROUP BY m.contact_id
        )
        SELECT
          c.id AS contact_id,
          COALESCE(rc.relationship_count, 0) AS relationship_count,
          COALESCE(ec.entity_count, 0) AS entity_count,
          COALESCE(ev.event_count, 0) AS event_count
        FROM contacts c
        LEFT JOIN rel_counts rc ON rc.contact_id = c.id
        LEFT JOIN entity_counts ec ON ec.contact_id = c.id
        LEFT JOIN event_counts ev ON ev.contact_id = c.id
      `);

      let updatedContacts = 0;

      for (const row of rows) {
        const relationshipCount = Number(row.relationship_count);
        const entityCount = Number(row.entity_count);
        const eventCount = Number(row.event_count);
        const connectorScore = relationshipCount * 3 + entityCount + eventCount * 2;

        await prismaClient.contactScore.upsert({
          where: { contactId: row.contact_id },
          update: {
            connectorScore,
            computedAt: new Date(),
          },
          create: {
            contactId: row.contact_id,
            connectorScore,
            computedAt: new Date(),
          },
        });

        updatedContacts += 1;
      }

      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'graph.recompute_completed',
        entityType: 'graph',
        metaJson: {
          updatedContacts,
        },
      });

      return { updatedContacts };
    } catch (error) {
      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'graph.recompute_failed',
        entityType: 'graph',
        metaJson: {
          error: (error as Error).message,
        },
      });
      throw error;
    }
  };
}

async function applySuggestions(input: {
  prismaClient: PrismaClient;
  contactId: string;
  notesRaw: string;
  extraction: ContactInsightsExtraction;
  model: string;
  promptVersion: string;
  llmRunId: string;
  createdByUserId: string;
  fillMissingOnly: boolean;
}): Promise<{
  tagsPending: number;
  tagsAutoApproved: number;
  entitiesPending: number;
  entitiesAutoApproved: number;
  relationshipsPending: number;
  relationshipsAutoApproved: number;
}> {
  const {
    prismaClient,
    contactId,
    notesRaw,
    extraction,
    model,
    promptVersion,
    llmRunId,
    createdByUserId,
    fillMissingOnly,
  } = input;

  const confidenceThreshold = getInsightsConfidenceThreshold();
  const provenance = {
    model,
    promptVersion,
    llmRunId,
    generatedAt: new Date().toISOString(),
  };

  let tagsPending = 0;
  let tagsAutoApproved = 0;
  let entitiesPending = 0;
  let entitiesAutoApproved = 0;
  let relationshipsPending = 0;
  let relationshipsAutoApproved = 0;

  const existingContactTags = await prismaClient.contactTag.findMany({
    where: { contactId },
    include: { tag: true },
  });
  const existingTagKeys = new Set(
    existingContactTags.map((item) => `${item.tag.category.toLowerCase()}::${item.tag.name.toLowerCase()}`),
  );

  for (const tag of extraction.tags) {
    const category = canonicalizeLabel(tag.category);
    const value = canonicalizeLabel(tag.value);
    if (!category || !value) {
      continue;
    }

    const tagKey = `${category.toLowerCase()}::${value.toLowerCase()}`;
    const isMissing = !existingTagKeys.has(tagKey);
    if (!isMissing) {
      continue;
    }

    const evidenceSnippet = canonicalizeLabel(
      tag.evidence_snippet || extractEvidenceSnippet(notesRaw, [value, category]),
    );
    const autoApprove = fillMissingOnly && tag.confidence >= confidenceThreshold && isMissing;

    if (autoApprove) {
      const tagRecord = await prismaClient.tag.upsert({
        where: {
          name_category: {
            name: value,
            category,
          },
        },
        update: {},
        create: {
          name: value,
          category,
        },
      });

      await prismaClient.contactTag.upsert({
        where: {
          contactId_tagId: {
            contactId,
            tagId: tagRecord.id,
          },
        },
        update: {
          confidence: tag.confidence,
          source: 'insights',
        },
        create: {
          contactId,
          tagId: tagRecord.id,
          confidence: tag.confidence,
          source: 'insights',
        },
      });
      existingTagKeys.add(tagKey);
      tagsAutoApproved += 1;
    } else {
      tagsPending += 1;
    }

    await prismaClient.reviewQueue.create({
      data: {
        kind: ReviewKind.TAG,
        payloadJson: {
          contactId,
          category,
          value,
          confidence: tag.confidence,
          evidenceSnippet,
          provenance,
        },
        status: autoApprove ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
        createdByUserId,
        reviewedByUserId: autoApprove ? createdByUserId : null,
        reviewedAt: autoApprove ? new Date() : null,
      },
    });
  }

  for (const entityCandidate of extraction.entities) {
    const entityType = entityTypeFromInsight(entityCandidate.type);
    const entityName = canonicalizeLabel(entityCandidate.name);
    if (!entityName) {
      continue;
    }

    const evidenceSnippet = canonicalizeLabel(
      entityCandidate.evidence_snippet || extractEvidenceSnippet(notesRaw, [entityName]),
    );

    const entity = await resolveEntity(prismaClient, entityType, entityName);
    const existingMention = await prismaClient.contactEntityMention.findUnique({
      where: {
        contactId_entityId: {
          contactId,
          entityId: entity.id,
        },
      },
      select: {
        source: true,
      },
    });
    const isMissing = !existingMention;
    const autoApprove = fillMissingOnly && entityCandidate.confidence >= confidenceThreshold && isMissing;
    const source = autoApprove
      ? 'insights-approved'
      : existingMention?.source ?? 'insights-suggested';

    const mention = await prismaClient.contactEntityMention.upsert({
      where: {
        contactId_entityId: {
          contactId,
          entityId: entity.id,
        },
      },
      update: {
        source,
        evidenceSnippet,
        confidence: Math.max(entityCandidate.confidence, 0),
      },
      create: {
        contactId,
        entityId: entity.id,
        source,
        evidenceSnippet,
        confidence: Math.max(entityCandidate.confidence, 0),
      },
    });

    if (!isMissing) {
      continue;
    }

    await prismaClient.reviewQueue.create({
      data: {
        kind: ReviewKind.ENTITY,
        payloadJson: {
          mentionId: mention.id,
          contactId,
          entityId: entity.id,
          entityType: entity.type,
          entityName: entity.canonicalName,
          confidence: entityCandidate.confidence,
          evidenceSnippet,
          provenance,
        },
        status: autoApprove ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
        createdByUserId,
        reviewedByUserId: autoApprove ? createdByUserId : null,
        reviewedAt: autoApprove ? new Date() : null,
      },
    });

    if (autoApprove) {
      entitiesAutoApproved += 1;
    } else {
      entitiesPending += 1;
    }
  }

  for (const clue of extraction.relationship_clues) {
    const normalizedType = normalizeRelationshipType(clue.type);
    if (!normalizedType) {
      continue;
    }

    const counterpartyName = canonicalizeLabel(clue.counterparty_name ?? '');
    const contextEntityName = canonicalizeLabel(clue.context_entity_name ?? '');
    const evidenceSnippet = canonicalizeLabel(
      clue.evidence_snippet || extractEvidenceSnippet(notesRaw, [counterpartyName, contextEntityName, normalizedType]),
    );
    const confidence = Math.max(clue.confidence, 0);

    let toContactId: string | null = null;
    let entityId: string | null = null;

    if (counterpartyName) {
      const resolvedContact = await prismaClient.contact.findFirst({
        where: {
          fullName: {
            equals: counterpartyName,
            mode: 'insensitive',
          },
        },
        select: { id: true },
      });

      if (resolvedContact) {
        toContactId = resolvedContact.id;
      } else {
        const personRef = await resolveEntity(prismaClient, EntityType.PERSON_REF, counterpartyName);
        entityId = personRef.id;
      }
    }

    if (!entityId && contextEntityName) {
      const contextEntity = await resolveEntity(prismaClient, EntityType.TOPIC, contextEntityName);
      entityId = contextEntity.id;
    }

    const existingRelationship = await prismaClient.relationship.findFirst({
      where: {
        fromContactId: contactId,
        toContactId,
        type: normalizedType,
        entityId,
        evidenceSnippet,
      },
    });

    const autoApprove = fillMissingOnly && confidence >= confidenceThreshold && !existingRelationship;
    const targetStatus = autoApprove ? RelationshipStatus.APPROVED : RelationshipStatus.SUGGESTED;

    const relationship = existingRelationship
      ? await prismaClient.relationship.update({
          where: { id: existingRelationship.id },
          data: {
            confidence: Math.max(existingRelationship.confidence, confidence),
            status:
              existingRelationship.status === RelationshipStatus.REJECTED
                ? existingRelationship.status
                : targetStatus,
          },
        })
      : await prismaClient.relationship.create({
          data: {
            fromContactId: contactId,
            toContactId,
            type: normalizedType,
            entityId,
            evidenceSnippet,
            confidence,
            status: targetStatus,
          },
        });

    if (existingRelationship?.status === RelationshipStatus.REJECTED) {
      continue;
    }

    if (existingRelationship) {
      continue;
    }

    await prismaClient.reviewQueue.create({
      data: {
        kind: ReviewKind.RELATIONSHIP,
        payloadJson: {
          relationshipId: relationship.id,
          fromContactId: contactId,
          toContactId: relationship.toContactId,
          entityId: relationship.entityId,
          type: normalizedType,
          confidence,
          evidenceSnippet,
          provenance,
        },
        status: autoApprove ? ReviewStatus.APPROVED : ReviewStatus.PENDING,
        createdByUserId,
        reviewedByUserId: autoApprove ? createdByUserId : null,
        reviewedAt: autoApprove ? new Date() : null,
      },
    });

    if (autoApprove) {
      relationshipsAutoApproved += 1;
    } else {
      relationshipsPending += 1;
    }
  }

  return {
    tagsPending,
    tagsAutoApproved,
    entitiesPending,
    entitiesAutoApproved,
    relationshipsPending,
    relationshipsAutoApproved,
  };
}

async function resolveEntity(
  prismaClient: PrismaClient,
  type: EntityType,
  rawName: string,
): Promise<{ id: string; type: EntityType; canonicalName: string }> {
  const canonicalName = canonicalizeLabel(rawName);
  const alias = normalizeAlias(rawName);

  const byAlias = await prismaClient.entityAlias.findUnique({
    where: { alias },
    include: {
      entity: true,
    },
  });
  if (byAlias && byAlias.entity.type === type) {
    return {
      id: byAlias.entity.id,
      type: byAlias.entity.type,
      canonicalName: byAlias.entity.canonicalName,
    };
  }

  const existing = await prismaClient.entity.findFirst({
    where: {
      type,
      canonicalName: {
        equals: canonicalName,
        mode: 'insensitive',
      },
    },
  });

  const entity = existing
    ?? await prismaClient.entity.create({
      data: {
        type,
        canonicalName,
      },
    });

  await prismaClient.entityAlias.upsert({
    where: { alias },
    update: {
      entityId: entity.id,
    },
    create: {
      entityId: entity.id,
      alias,
    },
  });

  return {
    id: entity.id,
    type: entity.type,
    canonicalName: entity.canonicalName,
  };
}

function entityTypeFromInsight(type: string): EntityType {
  if (type === 'company') {
    return EntityType.COMPANY;
  }
  if (type === 'event') {
    return EntityType.EVENT;
  }
  if (type === 'location') {
    return EntityType.LOCATION;
  }
  if (type === 'topic') {
    return EntityType.TOPIC;
  }
  return EntityType.PERSON_REF;
}

function buildBackfillWhere(filters: InsightsBackfillInput): Prisma.ContactWhereInput {
  const andConditions: Prisma.ContactWhereInput[] = [
    {
      notesRaw: {
        not: null,
      },
    },
  ];

  if (filters.country) {
    andConditions.push({
      locationCountry: {
        equals: filters.country,
        mode: 'insensitive',
      },
    });
  }

  if (filters.tag) {
    andConditions.push({
      tags: {
        some: {
          OR: [
            { tagId: filters.tag },
            {
              tag: {
                name: {
                  equals: filters.tag,
                  mode: 'insensitive',
                },
              },
            },
          ],
        },
      },
    });
  }

  if (filters.importedBatchId) {
    andConditions.push({
      sourceImportBatchId: filters.importedBatchId,
    });
  }

  const staleCutoff = new Date(Date.now() - getInsightsStaleAfterDays() * 24 * 60 * 60 * 1000);
  const missingCondition: Prisma.ContactWhereInput = {
    insights: {
      is: null,
    },
  };
  const staleCondition: Prisma.ContactWhereInput = {
    insights: {
      is: {
        updatedAt: {
          lt: staleCutoff,
        },
      },
    },
  };

  if (filters.missingOnly && filters.staleOnly) {
    andConditions.push({
      OR: [missingCondition, staleCondition],
    });
  } else if (filters.missingOnly) {
    andConditions.push(missingCondition);
  } else if (filters.staleOnly) {
    andConditions.push(staleCondition);
  }

  return {
    AND: andConditions,
  };
}

function computeOverallConfidence(extraction: ContactInsightsExtraction): number {
  const values: number[] = [];
  for (const tag of extraction.tags) {
    values.push(tag.confidence);
  }
  for (const entity of extraction.entities) {
    values.push(entity.confidence);
  }
  for (const clue of extraction.relationship_clues) {
    values.push(clue.confidence);
  }

  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return Number((sum / values.length).toFixed(6));
}

function getInsightsConfidenceThreshold(): number {
  const parsed = Number(process.env.INSIGHTS_CONFIDENCE_THRESHOLD ?? 0.9);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return 0.9;
  }

  return parsed;
}

function getInsightsMaxNotesChars(): number {
  const parsed = Number(process.env.INSIGHTS_MAX_NOTES_CHARS ?? 4000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 4000;
  }

  return Math.min(20000, Math.floor(parsed));
}

function getInsightsStaleAfterDays(): number {
  const parsed = Number(process.env.INSIGHTS_STALE_AFTER_DAYS ?? 30);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30;
  }

  return Math.floor(parsed);
}

function getInsightsBatchSize(): number {
  const parsed = Number(process.env.INSIGHTS_BATCH_SIZE ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.min(1000, Math.floor(parsed));
}

function isInsightsEnabled(): boolean {
  return process.env.INSIGHTS_ENABLED === '1' || process.env.INSIGHTS_ENABLED === 'true';
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
        metaJson: input.metaJson,
      },
    });
  } catch (error) {
    console.warn('Failed to write insights audit log', error);
  }
}

async function resolveSuggestionActorUserId(
  prismaClient: PrismaClient,
  preferredUserId?: string,
): Promise<string> {
  if (preferredUserId) {
    return preferredUserId;
  }

  const fallback = await prismaClient.user.findFirst({
    where: {
      role: {
        in: [Role.Admin, Role.Analyst],
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
    },
  });

  if (!fallback?.id) {
    throw new Error('No eligible Admin/Analyst user available for review queue attribution');
  }

  return fallback.id;
}
