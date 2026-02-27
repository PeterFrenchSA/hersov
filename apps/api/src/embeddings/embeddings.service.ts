import { Injectable, UnauthorizedException } from '@nestjs/common';
import { EmbeddingKind } from '@prisma/client';
import {
  embeddingsBackfillSchema,
  type EmbeddingsBackfillInput,
} from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ImportQueueService } from '../import/import-queue.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class EmbeddingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: ImportQueueService,
    private readonly auditService: AuditService,
  ) {}

  async requestBackfill(input: {
    filters: EmbeddingsBackfillInput;
    actorUserId?: string;
    ip?: string;
  }): Promise<{ queued: true; jobId: string; filters: EmbeddingsBackfillInput }> {
    if (!input.actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }

    const filters = embeddingsBackfillSchema.parse(input.filters);
    const jobId = await this.queueService.enqueueEmbeddingsBackfill(filters, input.actorUserId);

    await this.auditService.log({
      actorUserId: input.actorUserId,
      action: 'embeddings.backfill_requested',
      entityType: 'embeddings',
      entityId: jobId,
      ip: input.ip,
      metaJson: {
        filters,
      },
    });

    return {
      queued: true,
      jobId,
      filters,
    };
  }

  async getStatus(): Promise<{
    totalContacts: number;
    embeddedContacts: number;
    missingContacts: number;
    staleContacts: number;
    staleAfterDays: number;
    lastRunAt: string | null;
  }> {
    const staleAfterDays = getEmbeddingsStaleAfterDays();
    const staleBefore = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000);

    const [
      totalContacts,
      embeddedContactsRows,
      staleContactsRows,
      lastRun,
    ] = await Promise.all([
      this.prisma.contact.count(),
      this.prisma.embedding.findMany({
        where: {
          kind: EmbeddingKind.PROFILE,
        },
        distinct: ['contactId'],
        select: { contactId: true },
      }),
      this.prisma.embedding.findMany({
        where: {
          kind: EmbeddingKind.PROFILE,
          updatedAt: {
            lt: staleBefore,
          },
        },
        distinct: ['contactId'],
        select: { contactId: true },
      }),
      this.prisma.auditLog.findFirst({
        where: {
          action: {
            in: [
              'embeddings.backfill_requested',
              'embeddings.backfill_started',
              'embeddings.backfill_completed',
              'embeddings.backfill_failed',
            ],
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    const embeddedContacts = embeddedContactsRows.length;
    const staleContacts = staleContactsRows.length;
    const missingContacts = Math.max(0, totalContacts - embeddedContacts);

    return {
      totalContacts,
      embeddedContacts,
      missingContacts,
      staleContacts,
      staleAfterDays,
      lastRunAt: lastRun?.createdAt ? lastRun.createdAt.toISOString() : null,
    };
  }
}

function getEmbeddingsStaleAfterDays(): number {
  const parsed = Number(process.env.EMBEDDINGS_STALE_AFTER_DAYS ?? 30);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30;
  }

  return Math.floor(parsed);
}
