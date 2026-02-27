import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  insightsBackfillSchema,
  type InsightsBackfillInput,
} from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ImportQueueService } from '../import/import-queue.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: ImportQueueService,
    private readonly auditService: AuditService,
  ) {}

  async requestBackfill(input: {
    filters: InsightsBackfillInput;
    actorUserId?: string;
    ip?: string;
  }): Promise<{ queued: true; jobId: string; filters: InsightsBackfillInput }> {
    if (!input.actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }

    const filters = insightsBackfillSchema.parse(input.filters);
    const jobId = await this.queueService.enqueueInsightsBackfill(filters, input.actorUserId);

    await this.auditService.log({
      actorUserId: input.actorUserId,
      action: 'insights.backfill_requested',
      entityType: 'insights',
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

  async getDashboard(limit: number): Promise<{
    topTags: Array<{ category: string; value: string; count: number }>;
    topEvents: Array<{ entityId: string; name: string; count: number }>;
    topLocations: Array<{ entityId: string; name: string; count: number }>;
    topConnectors: Array<{ contactId: string; fullName: string; connectorScore: number; computedAt: string }>;
  }> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    const [topTags, topEvents, topLocations, topConnectors] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ category: string; value: string; count: number | string }>>(
        `
          SELECT
            t.category AS category,
            t.name AS value,
            COUNT(*)::int AS count
          FROM contact_tags ct
          JOIN tags t ON t.id = ct.tag_id
          GROUP BY t.category, t.name
          ORDER BY count DESC, t.category ASC, t.name ASC
          LIMIT $1
        `,
        safeLimit,
      ),
      this.prisma.$queryRawUnsafe<Array<{ entity_id: string; name: string; count: number | string }>>(
        `
          SELECT
            e.id AS entity_id,
            e.canonical_name AS name,
            COUNT(*)::int AS count
          FROM contact_entity_mentions m
          JOIN entities e ON e.id = m.entity_id
          WHERE m.source = 'insights-approved'
            AND e.type = 'event'
          GROUP BY e.id, e.canonical_name
          ORDER BY count DESC, e.canonical_name ASC
          LIMIT $1
        `,
        safeLimit,
      ),
      this.prisma.$queryRawUnsafe<Array<{ entity_id: string; name: string; count: number | string }>>(
        `
          SELECT
            e.id AS entity_id,
            e.canonical_name AS name,
            COUNT(*)::int AS count
          FROM contact_entity_mentions m
          JOIN entities e ON e.id = m.entity_id
          WHERE m.source = 'insights-approved'
            AND e.type = 'location'
          GROUP BY e.id, e.canonical_name
          ORDER BY count DESC, e.canonical_name ASC
          LIMIT $1
        `,
        safeLimit,
      ),
      this.prisma.$queryRawUnsafe<Array<{
        contact_id: string;
        full_name: string;
        connector_score: number | string;
        computed_at: Date;
      }>>(
        `
          SELECT
            cs.contact_id,
            c.full_name,
            cs.connector_score,
            cs.computed_at
          FROM contact_scores cs
          JOIN contacts c ON c.id = cs.contact_id
          ORDER BY cs.connector_score DESC, cs.computed_at DESC
          LIMIT $1
        `,
        safeLimit,
      ),
    ]);

    return {
      topTags: topTags.map((row) => ({
        category: row.category,
        value: row.value,
        count: Number(row.count),
      })),
      topEvents: topEvents.map((row) => ({
        entityId: row.entity_id,
        name: row.name,
        count: Number(row.count),
      })),
      topLocations: topLocations.map((row) => ({
        entityId: row.entity_id,
        name: row.name,
        count: Number(row.count),
      })),
      topConnectors: topConnectors.map((row) => ({
        contactId: row.contact_id,
        fullName: row.full_name,
        connectorScore: Number(row.connector_score),
        computedAt: row.computed_at.toISOString(),
      })),
    };
  }
}
