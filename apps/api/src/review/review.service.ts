import { Injectable, NotFoundException } from '@nestjs/common';
import { ReviewKind, ReviewStatus, RelationshipStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ReviewQueueQueryInput } from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const tagPayloadSchema = z.object({
  contactId: z.string().trim().min(1),
  category: z.string().trim().min(1),
  value: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  evidenceSnippet: z.string().trim().min(1).optional(),
});

const entityPayloadSchema = z.object({
  mentionId: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  entityId: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  evidenceSnippet: z.string().trim().min(1).optional(),
});

const relationshipPayloadSchema = z.object({
  relationshipId: z.string().trim().min(1),
  fromContactId: z.string().trim().min(1),
  toContactId: z.string().trim().min(1).nullable().optional(),
  entityId: z.string().trim().min(1).nullable().optional(),
  type: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  evidenceSnippet: z.string().trim().min(1).optional(),
});

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ReviewQueueQueryInput): Promise<{
    data: Array<{
      id: string;
      kind: string;
      status: string;
      payloadJson: unknown;
      createdByUserId: string;
      reviewedByUserId: string | null;
      reviewedAt: string | null;
      createdAt: string;
    }>;
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const where: Prisma.ReviewQueueWhereInput = {};
    if (query.status) {
      where.status = reviewStatusToDb(query.status);
    }
    if (query.kind) {
      where.kind = reviewKindToDb(query.kind);
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.reviewQueue.count({ where }),
      this.prisma.reviewQueue.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        kind: row.kind.toLowerCase(),
        status: row.status.toLowerCase(),
        payloadJson: row.payloadJson,
        createdByUserId: row.createdByUserId,
        reviewedByUserId: row.reviewedByUserId,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    };
  }

  async approve(input: {
    reviewId: string;
    actorUserId: string;
    ip?: string;
  }): Promise<{ id: string; status: 'approved' | 'rejected'; kind: string }> {
    const row = await this.prisma.reviewQueue.findUnique({
      where: { id: input.reviewId },
    });

    if (!row) {
      throw new NotFoundException('Review item not found');
    }

    if (row.status !== ReviewStatus.PENDING) {
      return {
        id: row.id,
        status: row.status.toLowerCase() as 'approved' | 'rejected',
        kind: row.kind.toLowerCase(),
      };
    }

    if (row.kind === ReviewKind.TAG) {
      const payload = tagPayloadSchema.parse(row.payloadJson);
      const tag = await this.prisma.tag.upsert({
        where: {
          name_category: {
            name: payload.value,
            category: payload.category,
          },
        },
        update: {},
        create: {
          name: payload.value,
          category: payload.category,
        },
      });

      await this.prisma.contactTag.upsert({
        where: {
          contactId_tagId: {
            contactId: payload.contactId,
            tagId: tag.id,
          },
        },
        update: {
          confidence: payload.confidence ?? null,
          source: 'insights',
        },
        create: {
          contactId: payload.contactId,
          tagId: tag.id,
          confidence: payload.confidence ?? null,
          source: 'insights',
        },
      });
    } else if (row.kind === ReviewKind.ENTITY) {
      const payload = entityPayloadSchema.parse(row.payloadJson);
      await this.prisma.contactEntityMention.update({
        where: { id: payload.mentionId },
        data: {
          source: 'insights-approved',
          confidence: payload.confidence ?? undefined,
        },
      });
    } else if (row.kind === ReviewKind.RELATIONSHIP) {
      const payload = relationshipPayloadSchema.parse(row.payloadJson);
      await this.prisma.relationship.update({
        where: { id: payload.relationshipId },
        data: {
          status: RelationshipStatus.APPROVED,
          confidence: payload.confidence ?? undefined,
        },
      });
    }

    await this.prisma.reviewQueue.update({
      where: { id: row.id },
      data: {
        status: ReviewStatus.APPROVED,
        reviewedByUserId: input.actorUserId,
        reviewedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorUserId: input.actorUserId,
      action: 'review.approved',
      entityType: 'review_queue',
      entityId: row.id,
      ip: input.ip,
      metaJson: {
        kind: row.kind.toLowerCase(),
      },
    });

    return {
      id: row.id,
      status: 'approved',
      kind: row.kind.toLowerCase(),
    };
  }

  async reject(input: {
    reviewId: string;
    actorUserId: string;
    ip?: string;
  }): Promise<{ id: string; status: 'approved' | 'rejected'; kind: string }> {
    const row = await this.prisma.reviewQueue.findUnique({
      where: { id: input.reviewId },
    });

    if (!row) {
      throw new NotFoundException('Review item not found');
    }

    if (row.status !== ReviewStatus.PENDING) {
      return {
        id: row.id,
        status: row.status.toLowerCase() as 'approved' | 'rejected',
        kind: row.kind.toLowerCase(),
      };
    }

    if (row.kind === ReviewKind.ENTITY) {
      const payload = entityPayloadSchema.parse(row.payloadJson);
      await this.prisma.contactEntityMention.update({
        where: { id: payload.mentionId },
        data: {
          source: 'insights-rejected',
        },
      });
    } else if (row.kind === ReviewKind.RELATIONSHIP) {
      const payload = relationshipPayloadSchema.parse(row.payloadJson);
      await this.prisma.relationship.update({
        where: { id: payload.relationshipId },
        data: {
          status: RelationshipStatus.REJECTED,
        },
      });
    }

    await this.prisma.reviewQueue.update({
      where: { id: row.id },
      data: {
        status: ReviewStatus.REJECTED,
        reviewedByUserId: input.actorUserId,
        reviewedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorUserId: input.actorUserId,
      action: 'review.rejected',
      entityType: 'review_queue',
      entityId: row.id,
      ip: input.ip,
      metaJson: {
        kind: row.kind.toLowerCase(),
      },
    });

    return {
      id: row.id,
      status: 'rejected',
      kind: row.kind.toLowerCase(),
    };
  }
}

function reviewStatusToDb(value: ReviewQueueQueryInput['status']): ReviewStatus {
  if (value === 'approved') {
    return ReviewStatus.APPROVED;
  }
  if (value === 'rejected') {
    return ReviewStatus.REJECTED;
  }
  return ReviewStatus.PENDING;
}

function reviewKindToDb(value: ReviewQueueQueryInput['kind']): ReviewKind {
  if (value === 'entity') {
    return ReviewKind.ENTITY;
  }
  if (value === 'relationship') {
    return ReviewKind.RELATIONSHIP;
  }
  return ReviewKind.TAG;
}
