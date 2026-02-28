import { EmbeddingKind, PrismaClient, type Prisma } from '@prisma/client';
import { embeddingsBackfillSchema, type EmbeddingsBackfillInput } from '@hersov/shared';
import { enqueueEmbeddingUpsertContactJobs } from './dispatch';
import { createEmbeddingVector } from './openai';
import { buildContactEmbeddingText, hashEmbeddingText } from './text-builder';

const prisma = new PrismaClient();

export interface EmbeddingsUpsertContactPayload {
  contactId: string;
  force?: boolean;
  reason?: string;
}

export interface EmbeddingsBackfillPayload {
  filters?: EmbeddingsBackfillInput;
  requestedByUserId?: string;
}

export const processEmbeddingsUpsertContactJob = createEmbeddingsUpsertContactProcessor(prisma);
export const processEmbeddingsBackfillJob = createEmbeddingsBackfillProcessor(prisma);

export async function closeEmbeddingsProcessor(): Promise<void> {
  await prisma.$disconnect();
}

export function createEmbeddingsUpsertContactProcessor(prismaClient: PrismaClient) {
  return async (payload: EmbeddingsUpsertContactPayload): Promise<{ updated: boolean; skippedReason?: string }> => {
    const contactId = payload.contactId?.trim();
    if (!contactId) {
      throw new Error('Missing contactId for embeddings upsert job');
    }

    const contact = await prismaClient.contact.findUnique({
      where: { id: contactId },
      include: {
        currentCompany: true,
        tags: {
          include: {
            tag: true,
          },
        },
        embeddings: {
          where: { kind: EmbeddingKind.PROFILE },
          take: 1,
        },
      },
    });

    if (!contact) {
      return { updated: false, skippedReason: 'contact_missing' };
    }

    const embeddingText = buildContactEmbeddingText({
      fullName: contact.fullName,
      currentTitle: contact.currentTitle,
      companyName: contact.currentCompany?.name ?? null,
      locationCity: contact.locationCity,
      locationCountry: contact.locationCountry,
      notesRaw: contact.notesRaw,
      tags: contact.tags.map((item) => item.tag.name),
    });

    const hash = hashEmbeddingText(embeddingText);
    const existing = contact.embeddings[0] ?? null;
    const staleAfterDays = getEmbeddingsStaleAfterDays();
    const staleBefore = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000);

    const shouldUpdate =
      payload.force === true
      || !existing
      || existing.hash !== hash
      || existing.updatedAt < staleBefore;

    if (!shouldUpdate) {
      return { updated: false, skippedReason: 'unchanged' };
    }

    const { vector, model } = await createEmbeddingVector(embeddingText);
    const dims = vector.length;
    const vectorLiteral = `[${vector.join(',')}]`;

    const embeddingRecord = await prismaClient.embedding.upsert({
      where: {
        contactId_kind: {
          contactId,
          kind: EmbeddingKind.PROFILE,
        },
      },
      update: {
        text: embeddingText,
        hash,
        model,
        dims,
      },
      create: {
        contactId,
        kind: EmbeddingKind.PROFILE,
        text: embeddingText,
        hash,
        model,
        dims,
      },
    });

    await prismaClient.$executeRaw`
      UPDATE embeddings
      SET vector = ${vectorLiteral}::vector,
          model = ${model},
          dims = ${dims},
          hash = ${hash},
          text = ${embeddingText},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${embeddingRecord.id}
    `;

    await writeAuditLog(prismaClient, {
      action: 'embeddings.contact_upserted',
      entityType: 'contact',
      entityId: contactId,
      metaJson: {
        reason: payload.reason ?? 'unspecified',
        model,
        dims,
      },
    });

    return { updated: true };
  };
}

export function createEmbeddingsBackfillProcessor(prismaClient: PrismaClient) {
  return async (payload: EmbeddingsBackfillPayload): Promise<{ queuedCount: number }> => {
    const filters = embeddingsBackfillSchema.parse(payload.filters ?? {});
    const where = buildBackfillWhere(filters);
    const totalLimit = filters.limit;
    const batchSize = Math.min(getEmbeddingsBatchSize(), totalLimit);
    let queuedCount = 0;
    let cursorId: string | null = null;

    await writeAuditLog(prismaClient, {
      actorUserId: payload.requestedByUserId,
      action: 'embeddings.backfill_started',
      entityType: 'embeddings',
      metaJson: {
        filters,
        limit: totalLimit,
      },
    });

    try {
      while (queuedCount < totalLimit) {
        const remaining = totalLimit - queuedCount;

        const contacts: Array<{ id: string }> = await prismaClient.contact.findMany({
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

        const contactIds = contacts.map((item: { id: string }) => item.id);
        await enqueueEmbeddingUpsertContactJobs(contactIds, 'backfill');
        queuedCount += contactIds.length;
        cursorId = contacts[contacts.length - 1]?.id ?? null;
      }

      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'embeddings.backfill_completed',
        entityType: 'embeddings',
        metaJson: {
          filters,
          queuedCount,
        },
      });

      return { queuedCount };
    } catch (error) {
      await writeAuditLog(prismaClient, {
        actorUserId: payload.requestedByUserId,
        action: 'embeddings.backfill_failed',
        entityType: 'embeddings',
        metaJson: {
          filters,
          error: (error as Error).message,
        },
      });

      throw error;
    }
  };
}

function buildBackfillWhere(filters: EmbeddingsBackfillInput): Prisma.ContactWhereInput {
  const andConditions: Prisma.ContactWhereInput[] = [];

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
            {
              tagId: filters.tag,
            },
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

  const staleCutoff = new Date(Date.now() - getEmbeddingsStaleAfterDays() * 24 * 60 * 60 * 1000);
  const missingCondition: Prisma.ContactWhereInput = {
    embeddings: {
      none: {
        kind: EmbeddingKind.PROFILE,
      },
    },
  };
  const staleCondition: Prisma.ContactWhereInput = {
    embeddings: {
      some: {
        kind: EmbeddingKind.PROFILE,
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

  if (andConditions.length === 0) {
    return {};
  }

  return {
    AND: andConditions,
  };
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
    console.warn('Failed to write embeddings audit log', error);
  }
}

function getEmbeddingsStaleAfterDays(): number {
  const parsed = Number(process.env.EMBEDDINGS_STALE_AFTER_DAYS ?? 30);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30;
  }

  return Math.floor(parsed);
}

function getEmbeddingsBatchSize(): number {
  const parsed = Number(process.env.EMBEDDINGS_BATCH_SIZE ?? 100);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.floor(parsed);
}
