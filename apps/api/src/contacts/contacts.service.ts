import { Injectable, NotFoundException } from '@nestjs/common';
import { RelationshipStatus } from '@prisma/client';
import type { ContactPatchInput, ContactsQueryInput } from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ContactsQueryInput): Promise<{
    data: unknown[];
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const q = query.q?.trim();

    const where = {
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' as const } },
              { firstName: { contains: q, mode: 'insensitive' as const } },
              { lastName: { contains: q, mode: 'insensitive' as const } },
              { currentCompany: { is: { name: { contains: q, mode: 'insensitive' as const } } } },
            ],
          }
        : {}),
      ...(query.importBatchId ? { sourceImportBatchId: query.importBatchId } : {}),
    };

    const orderBy =
      query.sortBy === 'created_at'
        ? { createdAt: query.sortDir }
        : query.sortBy === 'name'
          ? { fullName: query.sortDir }
          : { updatedAt: query.sortDir };

    const [total, contacts] = await this.prisma.$transaction([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
        include: {
          currentCompany: true,
          contactMethods: true,
        },
      }),
    ]);

    return {
      data: contacts,
      pagination: {
        page,
        pageSize,
        total,
      },
    };
  }

  async getById(id: string): Promise<unknown> {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        currentCompany: true,
        contactMethods: true,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return contact;
  }

  async getInsights(id: string): Promise<{
    contactId: string;
    insights: unknown | null;
    provenance: {
      model: string;
      promptVersion: string;
      confidenceOverall: number;
      updatedAt: string;
    } | null;
    approvedEntities: Array<{
      mentionId: string;
      entityId: string;
      type: string;
      name: string;
      confidence: number;
      evidenceSnippet: string;
      createdAt: string;
    }>;
    pendingReviewCount: number;
  }> {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        insights: true,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const [approvedMentions, pendingRows] = await Promise.all([
      this.prisma.contactEntityMention.findMany({
        where: {
          contactId: id,
          source: 'insights-approved',
        },
        include: {
          entity: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100,
      }),
      this.prisma.$queryRawUnsafe<Array<{ count: number | string }>>(
        `
          SELECT COUNT(*)::int AS count
          FROM review_queue rq
          WHERE rq.status = 'pending'
            AND (
              rq.payload_json ->> 'contactId' = $1
              OR rq.payload_json ->> 'fromContactId' = $1
            )
        `,
        id,
      ),
    ]);

    return {
      contactId: id,
      insights: contact.insights?.insightsJson ?? null,
      provenance: contact.insights
        ? {
            model: contact.insights.model,
            promptVersion: contact.insights.promptVersion,
            confidenceOverall: contact.insights.confidenceOverall,
            updatedAt: contact.insights.updatedAt.toISOString(),
          }
        : null,
      approvedEntities: approvedMentions.map((mention) => ({
        mentionId: mention.id,
        entityId: mention.entityId,
        type: mention.entity.type.toLowerCase(),
        name: mention.entity.canonicalName,
        confidence: mention.confidence,
        evidenceSnippet: mention.evidenceSnippet,
        createdAt: mention.createdAt.toISOString(),
      })),
      pendingReviewCount: Number(pendingRows[0]?.count ?? 0),
    };
  }

  async getNetwork(id: string): Promise<{
    contactId: string;
    approvedRelationships: Array<{
      id: string;
      type: string;
      confidence: number;
      evidenceSnippet: string;
      counterparty: { id: string; fullName: string } | null;
      entity: { id: string; type: string; name: string } | null;
      createdAt: string;
    }>;
    sharedEntities: Array<{
      entityId: string;
      type: string;
      name: string;
      count: number;
      why: string[];
      sharedWith: Array<{ contactId: string; fullName: string }>;
    }>;
  }> {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const [relationships, sharedRows] = await Promise.all([
      this.prisma.relationship.findMany({
        where: {
          status: RelationshipStatus.APPROVED,
          OR: [
            { fromContactId: id },
            { toContactId: id },
          ],
        },
        include: {
          fromContact: {
            select: {
              id: true,
              fullName: true,
            },
          },
          toContact: {
            select: {
              id: true,
              fullName: true,
            },
          },
          entity: {
            select: {
              id: true,
              type: true,
              canonicalName: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100,
      }),
      this.prisma.$queryRawUnsafe<Array<{
        entity_id: string;
        entity_type: string;
        entity_name: string;
        other_contact_id: string;
        other_full_name: string;
        evidence_snippet: string;
      }>>(
        `
          SELECT
            e.id AS entity_id,
            e.type::text AS entity_type,
            e.canonical_name AS entity_name,
            c2.id AS other_contact_id,
            c2.full_name AS other_full_name,
            COALESCE(m2.evidence_snippet, m1.evidence_snippet) AS evidence_snippet
          FROM contact_entity_mentions m1
          JOIN contact_entity_mentions m2
            ON m1.entity_id = m2.entity_id
            AND m2.contact_id <> m1.contact_id
            AND m2.source = 'insights-approved'
          JOIN entities e ON e.id = m1.entity_id
          JOIN contacts c2 ON c2.id = m2.contact_id
          WHERE m1.contact_id = $1
            AND m1.source = 'insights-approved'
          ORDER BY e.canonical_name ASC, c2.full_name ASC
          LIMIT 500
        `,
        id,
      ),
    ]);

    const sharedByEntity = new Map<
      string,
      {
        entityId: string;
        type: string;
        name: string;
        sharedWithMap: Map<string, { contactId: string; fullName: string }>;
        whySet: Set<string>;
      }
    >();

    for (const row of sharedRows) {
      const existing = sharedByEntity.get(row.entity_id) ?? {
        entityId: row.entity_id,
        type: row.entity_type,
        name: row.entity_name,
        sharedWithMap: new Map<string, { contactId: string; fullName: string }>(),
        whySet: new Set<string>(),
      };

      existing.sharedWithMap.set(row.other_contact_id, {
        contactId: row.other_contact_id,
        fullName: row.other_full_name,
      });
      if (row.evidence_snippet) {
        existing.whySet.add(row.evidence_snippet);
      }
      sharedByEntity.set(row.entity_id, existing);
    }

    const sharedEntities = Array.from(sharedByEntity.values())
      .map((item) => ({
        entityId: item.entityId,
        type: item.type,
        name: item.name,
        count: item.sharedWithMap.size,
        why: Array.from(item.whySet).slice(0, 3),
        sharedWith: Array.from(item.sharedWithMap.values()).slice(0, 8),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 20);

    return {
      contactId: id,
      approvedRelationships: relationships.map((relationship) => {
        const counterparty =
          relationship.fromContactId === id
            ? relationship.toContact
            : relationship.fromContact;

        return {
          id: relationship.id,
          type: relationship.type,
          confidence: relationship.confidence,
          evidenceSnippet: relationship.evidenceSnippet,
          counterparty: counterparty
            ? {
                id: counterparty.id,
                fullName: counterparty.fullName,
              }
            : null,
          entity: relationship.entity
            ? {
                id: relationship.entity.id,
                type: relationship.entity.type.toLowerCase(),
                name: relationship.entity.canonicalName,
              }
            : null,
          createdAt: relationship.createdAt.toISOString(),
        };
      }),
      sharedEntities,
    };
  }

  async update(
    id: string,
    payload: ContactPatchInput,
    actorUserId: string,
    ip?: string,
  ): Promise<unknown> {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Contact not found');
    }

    const updated = await this.prisma.contact.update({
      where: { id },
      data: {
        firstName: payload.firstName,
        lastName: payload.lastName,
        fullName: payload.fullName,
        notesRaw: payload.notesRaw,
        locationCity: payload.locationCity,
        locationCountry: payload.locationCountry,
        currentTitle: payload.currentTitle,
        currentCompanyId: payload.currentCompanyId,
      },
      include: {
        currentCompany: true,
        contactMethods: true,
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'contacts.update',
      entityType: 'contact',
      entityId: id,
      ip,
      metaJson: {
        updatedFields: Object.keys(payload),
      },
    });

    return updated;
  }
}
