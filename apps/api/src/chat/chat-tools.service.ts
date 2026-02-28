import { Injectable } from '@nestjs/common';
import { ContactMethodType, type Prisma } from '@prisma/client';
import type { AppRole } from '@hersov/shared';
import {
  chatToolAggregateContactsSchema,
  chatToolGetContactByIdSchema,
  chatToolSearchContactsSchema,
  chatToolSemanticSearchSchema,
  type ChatToolAggregateContactsInput,
  type ChatToolGetContactByIdInput,
  type ChatToolSearchContactsInput,
  type ChatToolSemanticSearchInput,
} from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SemanticSearchService } from '../search/semantic-search.service';

interface ToolContext {
  userRole: AppRole;
  sensitiveRequestAllowed: boolean;
}

interface ToolExecutionResult {
  name: string;
  rows: number;
  output: Record<string, unknown>;
}

const CHAT_TOOL_NAMES = {
  searchContacts: 'crm_search_contacts',
  aggregateContacts: 'crm_aggregate_contacts',
  getContactById: 'crm_get_contact_by_id',
  semanticSearch: 'crm_semantic_search',
} as const;

const LEGACY_CHAT_TOOL_NAME_ALIASES: Record<string, string> = {
  'crm.searchContacts': CHAT_TOOL_NAMES.searchContacts,
  'crm.aggregateContacts': CHAT_TOOL_NAMES.aggregateContacts,
  'crm.getContactById': CHAT_TOOL_NAMES.getContactById,
  'crm.semanticSearch': CHAT_TOOL_NAMES.semanticSearch,
};

@Injectable()
export class ChatToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly semanticSearchService: SemanticSearchService,
  ) {}

  getToolDefinitions(): unknown[] {
    return [
      {
        type: 'function',
        name: CHAT_TOOL_NAMES.searchContacts,
        description: 'Search contacts with filters and sorting.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            filters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                q: { type: 'string' },
                country: { type: 'string' },
                company: { type: 'string' },
                tag: { type: 'string' },
                importedBatchId: { type: 'string' },
              },
            },
            sortBy: { type: 'string', enum: ['updated_at', 'created_at', 'name'] },
            sortDir: { type: 'string', enum: ['asc', 'desc'] },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
            includeSensitive: { type: 'boolean' },
          },
        },
      },
      {
        type: 'function',
        name: CHAT_TOOL_NAMES.aggregateContacts,
        description: 'Aggregate contacts by country, company, or title.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            groupBy: { type: 'string', enum: ['country', 'company', 'title'] },
            filters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                q: { type: 'string' },
                country: { type: 'string' },
                company: { type: 'string' },
                tag: { type: 'string' },
                importedBatchId: { type: 'string' },
              },
            },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          required: ['groupBy'],
        },
      },
      {
        type: 'function',
        name: CHAT_TOOL_NAMES.getContactById,
        description: 'Get a single contact by id.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            includeSensitive: { type: 'boolean' },
          },
          required: ['id'],
        },
      },
      {
        type: 'function',
        name: CHAT_TOOL_NAMES.semanticSearch,
        description: 'Run semantic vector search over contact embeddings.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            k: { type: 'integer', minimum: 1, maximum: 50 },
            filters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                country: { type: 'string' },
                tag: { type: 'string' },
                importedBatchId: { type: 'string' },
              },
            },
            includeSensitive: { type: 'boolean' },
          },
          required: ['query'],
        },
      },
    ];
  }

  async executeTool(name: string, argumentsJson: string, context: ToolContext): Promise<ToolExecutionResult> {
    const args = parseToolArguments(argumentsJson);
    const normalizedName = normalizeToolName(name);
    if (!normalizedName) {
      throw new Error(`Unsupported tool: ${name}`);
    }

    if (normalizedName === CHAT_TOOL_NAMES.searchContacts) {
      const parsed = chatToolSearchContactsSchema.parse(args);
      const output = await this.searchContacts(parsed, context);
      return { name: normalizedName, rows: Number(output.count ?? 0), output };
    }

    if (normalizedName === CHAT_TOOL_NAMES.aggregateContacts) {
      const parsed = chatToolAggregateContactsSchema.parse(args);
      const output = await this.aggregateContacts(parsed);
      return { name: normalizedName, rows: Number(output.count ?? 0), output };
    }

    if (normalizedName === CHAT_TOOL_NAMES.getContactById) {
      const parsed = chatToolGetContactByIdSchema.parse(args);
      const output = await this.getContactById(parsed, context);
      return { name: normalizedName, rows: output.found ? 1 : 0, output };
    }

    if (normalizedName === CHAT_TOOL_NAMES.semanticSearch) {
      const parsed = chatToolSemanticSearchSchema.parse(args);
      const output = await this.semanticSearch(parsed, context);
      return { name: normalizedName, rows: Number(output.count ?? 0), output };
    }

    throw new Error(`Unsupported tool: ${name}`);
  }

  private async searchContacts(
    input: ChatToolSearchContactsInput,
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const limit = applyResultLimit(input.limit);
    const includeSensitive = canIncludeSensitive(
      context.userRole,
      input.includeSensitive,
      context.sensitiveRequestAllowed,
    );

    if (includeSensitive && limit > 20) {
      throw new Error('Sensitive bulk extraction is not allowed in chat. Use export flow.');
    }

    const where = buildContactWhere(input.filters);

    const orderBy: Prisma.ContactOrderByWithRelationInput =
      input.sortBy === 'created_at'
        ? { createdAt: input.sortDir }
        : input.sortBy === 'name'
          ? { fullName: input.sortDir }
          : { updatedAt: input.sortDir };

    const contacts = await this.prisma.contact.findMany({
      where,
      orderBy,
      take: limit,
      include: {
        currentCompany: true,
        contactMethods: includeSensitive
          ? {
              where: {
                type: {
                  in: [ContactMethodType.EMAIL, ContactMethodType.PHONE],
                },
              },
            }
          : false,
      },
    });

    return {
      count: contacts.length,
      limit,
      includeSensitive,
      data: contacts.map((contact) => ({
        id: contact.id,
        fullName: contact.fullName,
        currentTitle: contact.currentTitle,
        companyName: contact.currentCompany?.name ?? null,
        locationCountry: contact.locationCountry,
        ...(includeSensitive
          ? {
              emails: contact.contactMethods
                .filter((method) => method.type === ContactMethodType.EMAIL)
                .map((method) => method.value),
              phones: contact.contactMethods
                .filter((method) => method.type === ContactMethodType.PHONE)
                .map((method) => method.value),
            }
          : {}),
      })),
    };
  }

  private async aggregateContacts(input: ChatToolAggregateContactsInput): Promise<Record<string, unknown>> {
    const limit = applyResultLimit(input.limit);
    const { clause, params } = buildFilterClause(input.filters);

    const bucketExpression =
      input.groupBy === 'country'
        ? "COALESCE(NULLIF(c.location_country, ''), 'unknown')"
        : input.groupBy === 'company'
          ? "COALESCE(NULLIF(co.name, ''), 'unknown')"
          : "COALESCE(NULLIF(c.current_title, ''), 'unknown')";

    const sql = `
      SELECT
        ${bucketExpression} AS bucket,
        COUNT(*)::int AS count
      FROM contacts c
      LEFT JOIN companies co ON co.id = c.current_company_id
      ${clause}
      GROUP BY bucket
      ORDER BY count DESC, bucket ASC
      LIMIT $${params.length + 1}
    `;

    const rows = await this.prisma.$queryRawUnsafe<Array<{ bucket: string; count: number | string }>>(
      sql,
      ...params,
      limit,
    );

    return {
      count: rows.length,
      groupBy: input.groupBy,
      data: rows.map((row) => ({
        bucket: row.bucket,
        count: Number(row.count),
      })),
    };
  }

  private async getContactById(
    input: ChatToolGetContactByIdInput,
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const includeSensitive = canIncludeSensitive(
      context.userRole,
      input.includeSensitive,
      context.sensitiveRequestAllowed,
    );

    const contact = await this.prisma.contact.findUnique({
      where: { id: input.id },
      include: {
        currentCompany: true,
        contactMethods: true,
      },
    });

    if (!contact) {
      return {
        found: false,
      };
    }

    return {
      found: true,
      includeSensitive,
      data: {
        id: contact.id,
        fullName: contact.fullName,
        currentTitle: contact.currentTitle,
        companyName: contact.currentCompany?.name ?? null,
        locationCity: contact.locationCity,
        locationCountry: contact.locationCountry,
        methods: contact.contactMethods
          .filter((method) => {
            if (method.type === ContactMethodType.EMAIL || method.type === ContactMethodType.PHONE) {
              return includeSensitive;
            }

            return true;
          })
          .map((method) => ({
            type: method.type,
            value: method.value,
            isPrimary: method.isPrimary,
          })),
      },
    };
  }

  private async semanticSearch(
    input: ChatToolSemanticSearchInput,
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const k = applyResultLimit(input.k);
    const includeSensitive = canIncludeSensitive(
      context.userRole,
      input.includeSensitive,
      context.sensitiveRequestAllowed,
    );

    if (includeSensitive && k > 20) {
      throw new Error('Sensitive bulk extraction is not allowed in chat. Use export flow.');
    }

    const results = await this.semanticSearchService.semanticSearch({
      query: input.query,
      k,
      filters: {
        country: input.filters?.country,
        tag: input.filters?.tag,
        importedBatchId: input.filters?.importedBatchId,
      },
    });

    if (!includeSensitive) {
      return {
        count: results.length,
        data: results,
      };
    }

    const methods = await this.prisma.contactMethod.findMany({
      where: {
        contactId: {
          in: results.map((item) => item.id),
        },
        type: {
          in: [ContactMethodType.EMAIL, ContactMethodType.PHONE],
        },
      },
      select: {
        contactId: true,
        type: true,
        value: true,
      },
    });

    const methodsByContact = new Map<string, Array<{ type: ContactMethodType; value: string }>>();
    for (const method of methods) {
      const existing = methodsByContact.get(method.contactId) ?? [];
      existing.push({ type: method.type, value: method.value });
      methodsByContact.set(method.contactId, existing);
    }

    return {
      count: results.length,
      includeSensitive,
      data: results.map((result) => {
        const contactMethods = methodsByContact.get(result.id) ?? [];

        return {
          ...result,
          emails: contactMethods.filter((method) => method.type === ContactMethodType.EMAIL).map((method) => method.value),
          phones: contactMethods.filter((method) => method.type === ContactMethodType.PHONE).map((method) => method.value),
        };
      }),
    };
  }
}

function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson);
  } catch {
    throw new Error('Invalid tool arguments JSON');
  }
}

function normalizeToolName(name: string): string | null {
  if (Object.values(CHAT_TOOL_NAMES).includes(name as (typeof CHAT_TOOL_NAMES)[keyof typeof CHAT_TOOL_NAMES])) {
    return name;
  }

  return LEGACY_CHAT_TOOL_NAME_ALIASES[name] ?? null;
}

function canIncludeSensitive(
  role: AppRole,
  includeSensitive: boolean | undefined,
  sensitiveRequestAllowed: boolean,
): boolean {
  return Boolean(
    includeSensitive
    && sensitiveRequestAllowed
    && (role === 'Admin' || role === 'Analyst'),
  );
}

function applyResultLimit(requested: number): number {
  const configured = Number(process.env.CHAT_MAX_RESULTS_PER_TOOL ?? 20);
  const configuredLimit = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : 20;

  const hardMax = 50;
  return Math.max(1, Math.min(requested, configuredLimit, hardMax));
}

function buildContactWhere(filters: ChatToolSearchContactsInput['filters']): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {};

  if (filters?.q) {
    where.OR = [
      { fullName: { contains: filters.q, mode: 'insensitive' } },
      { firstName: { contains: filters.q, mode: 'insensitive' } },
      { lastName: { contains: filters.q, mode: 'insensitive' } },
      { currentCompany: { is: { name: { contains: filters.q, mode: 'insensitive' } } } },
    ];
  }

  if (filters?.country) {
    where.locationCountry = {
      equals: filters.country,
      mode: 'insensitive',
    };
  }

  if (filters?.company) {
    where.currentCompany = {
      is: {
        name: {
          contains: filters.company,
          mode: 'insensitive',
        },
      },
    };
  }

  if (filters?.importedBatchId) {
    where.sourceImportBatchId = filters.importedBatchId;
  }

  if (filters?.tag) {
    where.tags = {
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
    };
  }

  return where;
}

function buildFilterClause(filters: ChatToolAggregateContactsInput['filters']): { clause: string; params: unknown[] } {
  if (!filters) {
    return {
      clause: '',
      params: [],
    };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const index = params.length;
    conditions.push(`(
      c.full_name ILIKE $${index}
      OR COALESCE(c.first_name, '') ILIKE $${index}
      OR COALESCE(c.last_name, '') ILIKE $${index}
      OR COALESCE(co.name, '') ILIKE $${index}
    )`);
  }

  if (filters.country) {
    params.push(filters.country);
    conditions.push(`c.location_country ILIKE $${params.length}`);
  }

  if (filters.company) {
    params.push(`%${filters.company}%`);
    conditions.push(`COALESCE(co.name, '') ILIKE $${params.length}`);
  }

  if (filters.importedBatchId) {
    params.push(filters.importedBatchId);
    conditions.push(`c.source_import_batch_id = $${params.length}::uuid`);
  }

  if (filters.tag) {
    params.push(filters.tag);
    const index = params.length;
    conditions.push(`EXISTS (
      SELECT 1
      FROM contact_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id
        AND (ct.tag_id = $${index} OR t.name ILIKE $${index})
    )`);
  }

  if (conditions.length === 0) {
    return {
      clause: '',
      params,
    };
  }

  return {
    clause: `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}
