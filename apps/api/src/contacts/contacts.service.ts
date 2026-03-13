import { Injectable, NotFoundException } from '@nestjs/common';
import { ContactMethodType, Prisma, RelationshipStatus } from '@prisma/client';
import type { ContactCreateInput, ContactPatchInput, ContactsQueryInput } from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ContactsQueryInput): Promise<{
    data: Array<{
      id: string;
      fullName: string;
      currentTitle: string | null;
      locationCity: string | null;
      locationCountry: string | null;
      createdAt: string;
      updatedAt: string;
      lastEnrichedAt: string | null;
      currentCompany: { id: string; name: string } | null;
      contactMethods: Array<{
        id: string;
        type: string;
        value: string;
        isPrimary: boolean;
      }>;
      tags: Array<{ category: string; name: string }>;
      connectorScore: number | null;
    }>;
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const q = query.q?.trim();
    const insensitive = Prisma.QueryMode.insensitive;
    const andClauses: Prisma.ContactWhereInput[] = [];

    if (q) {
      andClauses.push({
        OR: [
          { fullName: { contains: q, mode: insensitive } },
          { firstName: { contains: q, mode: insensitive } },
          { lastName: { contains: q, mode: insensitive } },
          { notesRaw: { contains: q, mode: insensitive } },
          { currentTitle: { contains: q, mode: insensitive } },
          { currentCompany: { is: { name: { contains: q, mode: insensitive } } } },
          {
            tags: {
              some: {
                tag: {
                  OR: [
                    { name: { contains: q, mode: insensitive } },
                    { category: { contains: q, mode: insensitive } },
                  ],
                },
              },
            },
          },
        ],
      });
    }

    if (query.importBatchId) {
      andClauses.push({ sourceImportBatchId: query.importBatchId });
    }

    if (query.company) {
      andClauses.push({
        currentCompany: {
          is: {
            name: { contains: query.company, mode: insensitive },
          },
        },
      });
    }

    if (query.title) {
      andClauses.push({ currentTitle: { contains: query.title, mode: insensitive } });
    }

    if (query.country) {
      andClauses.push({ locationCountry: { contains: query.country, mode: insensitive } });
    }

    if (query.city) {
      andClauses.push({ locationCity: { contains: query.city, mode: insensitive } });
    }

    if (query.tag) {
      andClauses.push(buildTagWhereClause(query.tag));
    }

    if (query.missingEmail) {
      andClauses.push({ contactMethods: { none: { type: ContactMethodType.EMAIL } } });
    }

    if (query.missingLinkedin) {
      andClauses.push({ contactMethods: { none: { type: ContactMethodType.LINKEDIN } } });
    }

    if (query.missingLocation) {
      andClauses.push({
        OR: [
          { locationCity: null },
          { locationCountry: null },
        ],
      });
    }

    if (query.lastEnrichedBeforeDays) {
      andClauses.push({
        OR: [
          { lastEnrichedAt: null },
          { lastEnrichedAt: { lt: daysAgo(query.lastEnrichedBeforeDays) } },
        ],
      });
    }

    if (query.minConnectorScore !== undefined) {
      andClauses.push({
        score: {
          is: {
            connectorScore: { gte: query.minConnectorScore },
          },
        },
      });
    }

    const where: Prisma.ContactWhereInput = andClauses.length > 0 ? { AND: andClauses } : {};

    const orderBy =
      query.sortBy === 'created_at'
        ? { createdAt: query.sortDir }
        : query.sortBy === 'name'
          ? { fullName: query.sortDir }
          : query.sortBy === 'last_enriched'
            ? { lastEnrichedAt: query.sortDir }
            : query.sortBy === 'connector_score'
              ? { score: { connectorScore: query.sortDir } }
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
          tags: {
            include: {
              tag: true,
            },
          },
          score: true,
        },
      }),
    ]);

    return {
      data: contacts.map((contact) => ({
        id: contact.id,
        fullName: contact.fullName,
        currentTitle: contact.currentTitle,
        locationCity: contact.locationCity,
        locationCountry: contact.locationCountry,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
        lastEnrichedAt: contact.lastEnrichedAt?.toISOString() ?? null,
        currentCompany: contact.currentCompany
          ? {
              id: contact.currentCompany.id,
              name: contact.currentCompany.name,
            }
          : null,
        contactMethods: contact.contactMethods.map((method) => ({
          id: method.id,
          type: method.type,
          value: method.value,
          isPrimary: method.isPrimary,
        })),
        tags: contact.tags
          .map((entry) => ({
            category: entry.tag.category,
            name: entry.tag.name,
          }))
          .sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name)),
        connectorScore: contact.score?.connectorScore ?? null,
      })),
      pagination: {
        page,
        pageSize,
        total,
      },
    };
  }

  async getById(id: string): Promise<{
    id: string;
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    currentTitle: string | null;
    locationCity: string | null;
    locationCountry: string | null;
    notesRaw: string | null;
    createdAt: string;
    updatedAt: string;
    lastEnrichedAt: string | null;
    currentCompany: { id: string; name: string } | null;
    contactMethods: Array<{
      id: string;
      type: string;
      value: string;
      isPrimary: boolean;
      source: string | null;
    }>;
    tags: Array<{
      category: string;
      name: string;
      confidence: number | null;
      source: string | null;
    }>;
    connectorScore: number | null;
    recentEnrichmentChanges: Array<{
      id: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      provider: string;
      confidence: number | null;
      createdAt: string;
    }>;
  }> {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        currentCompany: true,
        contactMethods: true,
        tags: {
          include: {
            tag: true,
          },
        },
        score: true,
        enrichmentResults: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 20,
        },
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return {
      id: contact.id,
      fullName: contact.fullName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      currentTitle: contact.currentTitle,
      locationCity: contact.locationCity,
      locationCountry: contact.locationCountry,
      notesRaw: contact.notesRaw,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
      lastEnrichedAt: contact.lastEnrichedAt?.toISOString() ?? null,
      currentCompany: contact.currentCompany
        ? {
            id: contact.currentCompany.id,
            name: contact.currentCompany.name,
          }
        : null,
      contactMethods: contact.contactMethods.map((method) => ({
        id: method.id,
        type: method.type,
        value: method.value,
        isPrimary: method.isPrimary,
        source: method.source,
      })),
      tags: contact.tags
        .map((entry) => ({
          category: entry.tag.category,
          name: entry.tag.name,
          confidence: entry.confidence ?? null,
          source: entry.source ?? null,
        }))
        .sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name)),
      connectorScore: contact.score?.connectorScore ?? null,
      recentEnrichmentChanges: contact.enrichmentResults.map((result) => ({
        id: result.id,
        field: result.field,
        oldValue: result.oldValue,
        newValue: result.newValue,
        provider: result.provider,
        confidence: result.confidence ?? null,
        createdAt: result.createdAt.toISOString(),
      })),
    };
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

  async create(
    payload: ContactCreateInput,
    actorUserId: string,
    ip?: string,
  ): Promise<{
    id: string;
    fullName: string;
  }> {
    const companyId = payload.companyName
      ? await getOrCreateCompanyId(this.prisma, payload.companyName.trim(), new Map<string, string>())
      : null;

    const normalizedMethods = dedupeContactMethods(payload.methods);
    const fullName = deriveContactFullName(payload, normalizedMethods);

    const created = await this.prisma.contact.create({
      data: {
        firstName: nullifyString(payload.firstName),
        lastName: nullifyString(payload.lastName),
        fullName,
        notesRaw: payload.notesRaw ?? null,
        locationCity: nullifyString(payload.locationCity),
        locationCountry: nullifyString(payload.locationCountry),
        currentTitle: nullifyString(payload.currentTitle),
        currentCompanyId: companyId,
        contactMethods: normalizedMethods.length > 0
          ? {
              create: normalizedMethods.map((method) => ({
                type: contactMethodTypeFromApi(method.type),
                value: method.value.trim(),
                isPrimary: method.isPrimary,
                source: 'manual',
              })),
            }
          : undefined,
        tags: payload.tags.length > 0
          ? {
              create: await Promise.all(
                payload.tags.map(async (tag) => {
                  const tagRecord = await this.prisma.tag.upsert({
                    where: {
                      name_category: {
                        name: tag.name.trim(),
                        category: tag.category.trim(),
                      },
                    },
                    update: {},
                    create: {
                      name: tag.name.trim(),
                      category: tag.category.trim(),
                    },
                  });

                  return {
                    tagId: tagRecord.id,
                    source: 'manual',
                    confidence: 1,
                  };
                }),
              ),
            }
          : undefined,
      },
      select: {
        id: true,
        fullName: true,
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'contacts.create',
      entityType: 'contact',
      entityId: created.id,
      ip,
      metaJson: {
        companyName: payload.companyName ?? null,
        methodCount: normalizedMethods.length,
        tagCount: payload.tags.length,
      },
    });

    return created;
  }
}

function buildTagWhereClause(tagQuery: string): Prisma.ContactWhereInput {
  const trimmed = tagQuery.trim();
  const separatorIndex = trimmed.indexOf(':');
  if (separatorIndex > 0) {
    const category = trimmed.slice(0, separatorIndex).trim();
    const name = trimmed.slice(separatorIndex + 1).trim();

    if (category && name) {
      return {
        tags: {
          some: {
            tag: {
              category: { equals: category, mode: 'insensitive' },
              name: { contains: name, mode: 'insensitive' },
            },
          },
        },
      };
    }
  }

  return {
    tags: {
      some: {
        tag: {
          OR: [
            { name: { contains: trimmed, mode: 'insensitive' } },
            { category: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
      },
    },
  };
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function nullifyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function deriveContactFullName(
  payload: ContactCreateInput,
  methods: Array<{ type: string; value: string; isPrimary: boolean }>,
): string {
  const explicit = payload.fullName?.trim();
  if (explicit) {
    return explicit;
  }

  const joined = [payload.firstName?.trim(), payload.lastName?.trim()].filter(Boolean).join(' ').trim();
  if (joined) {
    return joined;
  }

  const primaryMethod = methods.find((method) => method.isPrimary) ?? methods[0];
  return primaryMethod?.value ?? `Manual Contact ${Date.now()}`;
}

function dedupeContactMethods(
  methods: ContactCreateInput['methods'],
): Array<ContactCreateInput['methods'][number]> {
  const deduped = new Map<string, ContactCreateInput['methods'][number]>();
  for (const method of methods) {
    const normalizedKey = `${method.type}:${method.value.trim().toLowerCase()}`;
    deduped.set(normalizedKey, {
      type: method.type,
      value: method.value.trim(),
      isPrimary: method.isPrimary,
    });
  }

  const items = Array.from(deduped.values());
  if (items.length > 0 && !items.some((item) => item.isPrimary)) {
    items[0] = {
      ...items[0],
      isPrimary: true,
    };
  }

  return items;
}

function contactMethodTypeFromApi(type: ContactCreateInput['methods'][number]['type']): ContactMethodType {
  const mapping: Record<ContactCreateInput['methods'][number]['type'], ContactMethodType> = {
    email: ContactMethodType.EMAIL,
    phone: ContactMethodType.PHONE,
    website: ContactMethodType.WEBSITE,
    linkedin: ContactMethodType.LINKEDIN,
    twitter: ContactMethodType.TWITTER,
    other: ContactMethodType.OTHER,
  };

  return mapping[type];
}

async function getOrCreateCompanyId(
  prismaClient: PrismaService,
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
