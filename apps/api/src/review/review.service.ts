import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ContactMethodType,
  ReviewKind,
  ReviewStatus,
  RelationshipStatus,
  type Prisma,
} from '@prisma/client';
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

const linkedinProfilePayloadSchema = z.object({
  suggestionId: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  contactName: z.string().trim().min(1).optional(),
  profileUrl: z.string().trim().url(),
  profileName: z.string().trim().min(1),
  headline: z.string().trim().min(1).optional().nullable(),
  location: z.string().trim().min(1).optional().nullable(),
  currentCompany: z.string().trim().min(1).optional().nullable(),
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
      summary: {
        title: string;
        subtitle: string | null;
        contact: {
          id: string;
          fullName: string;
        } | null;
        linkedinSuggestion: {
          profileName: string;
          profileUrl: string;
          headline: string | null;
          location: string | null;
          currentCompany: string | null;
          confidence: number | null;
        } | null;
      } | null;
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
        include: {
          linkedinSuggestions: {
            include: {
              contact: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        kind: row.kind.toLowerCase(),
        status: row.status.toLowerCase(),
        payloadJson: row.payloadJson,
        summary: buildReviewSummary(row),
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
    } else if (row.kind === ReviewKind.LINKEDIN_PROFILE) {
      const payload = linkedinProfilePayloadSchema.parse(row.payloadJson);

      await this.prisma.contactMethod.upsert({
        where: {
          contactId_type_value: {
            contactId: payload.contactId,
            type: ContactMethodType.LINKEDIN,
            value: payload.profileUrl,
          },
        },
        update: {
          isPrimary: true,
          source: 'linkedin-match',
        },
        create: {
          contactId: payload.contactId,
          type: ContactMethodType.LINKEDIN,
          value: payload.profileUrl,
          isPrimary: true,
          source: 'linkedin-match',
        },
      });

      await this.prisma.contactMethod.updateMany({
        where: {
          contactId: payload.contactId,
          type: ContactMethodType.LINKEDIN,
          NOT: {
            value: payload.profileUrl,
          },
        },
        data: {
          isPrimary: false,
        },
      });

      await this.prisma.linkedinProfileSuggestion.updateMany({
        where: {
          id: payload.suggestionId,
        },
        data: {
          status: ReviewStatus.APPROVED,
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
    } else if (row.kind === ReviewKind.LINKEDIN_PROFILE) {
      const payload = linkedinProfilePayloadSchema.parse(row.payloadJson);
      await this.prisma.linkedinProfileSuggestion.updateMany({
        where: {
          id: payload.suggestionId,
        },
        data: {
          status: ReviewStatus.REJECTED,
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

function buildReviewSummary(row: Prisma.ReviewQueueGetPayload<{
  include: {
    linkedinSuggestions: {
      include: {
        contact: {
          select: {
            id: true;
            fullName: true;
          };
        };
      };
    };
  };
}>): {
  title: string;
  subtitle: string | null;
  contact: {
    id: string;
    fullName: string;
  } | null;
  linkedinSuggestion: {
    profileName: string;
    profileUrl: string;
    headline: string | null;
    location: string | null;
    currentCompany: string | null;
    confidence: number | null;
  } | null;
} | null {
  if (row.kind === ReviewKind.LINKEDIN_PROFILE) {
    const payload = linkedinProfilePayloadSchema.safeParse(row.payloadJson);
    const suggestion = row.linkedinSuggestions[0] ?? null;
    const contact = suggestion?.contact ?? (
      payload.success && payload.data.contactName
        ? {
            id: payload.data.contactId,
            fullName: payload.data.contactName,
          }
        : null
    );

    return {
      title: contact?.fullName ?? 'LinkedIn profile suggestion',
      subtitle: payload.success ? payload.data.profileName : suggestion?.profileName ?? null,
      contact,
      linkedinSuggestion: {
        profileName: payload.success ? payload.data.profileName : suggestion?.profileName ?? 'LinkedIn candidate',
        profileUrl: payload.success ? payload.data.profileUrl : suggestion?.profileUrl ?? '',
        headline: payload.success ? payload.data.headline ?? null : suggestion?.headline ?? null,
        location: payload.success ? payload.data.location ?? null : suggestion?.location ?? null,
        currentCompany: payload.success ? payload.data.currentCompany ?? null : suggestion?.currentCompany ?? null,
        confidence: payload.success ? payload.data.confidence ?? null : suggestion?.score ?? null,
      },
    };
  }

  if (row.kind === ReviewKind.TAG) {
    const payload = tagPayloadSchema.safeParse(row.payloadJson);
    if (payload.success) {
      return {
        title: `${payload.data.category}: ${payload.data.value}`,
        subtitle: payload.data.contactId,
        contact: {
          id: payload.data.contactId,
          fullName: payload.data.contactId,
        },
        linkedinSuggestion: null,
      };
    }
  }

  if (row.kind === ReviewKind.ENTITY) {
    const payload = entityPayloadSchema.safeParse(row.payloadJson);
    if (payload.success) {
      return {
        title: `Entity mention ${payload.data.entityId}`,
        subtitle: payload.data.contactId,
        contact: {
          id: payload.data.contactId,
          fullName: payload.data.contactId,
        },
        linkedinSuggestion: null,
      };
    }
  }

  if (row.kind === ReviewKind.RELATIONSHIP) {
    const payload = relationshipPayloadSchema.safeParse(row.payloadJson);
    if (payload.success) {
      return {
        title: payload.data.type,
        subtitle: payload.data.evidenceSnippet ?? null,
        contact: {
          id: payload.data.fromContactId,
          fullName: payload.data.fromContactId,
        },
        linkedinSuggestion: null,
      };
    }
  }

  return null;
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
  if (value === 'linkedin_profile') {
    return ReviewKind.LINKEDIN_PROFILE;
  }
  return ReviewKind.TAG;
}
