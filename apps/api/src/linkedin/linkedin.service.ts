import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ContactMethodType, ReviewStatus, type Prisma } from '@prisma/client';
import type {
  LinkedinMatchBackfillInput,
  LinkedinMatchContactInput,
  LinkedinSearchProvider,
  LinkedinSuggestionsQueryInput,
} from '@hersov/shared';
import { getLinkedinSearchProviderStatus } from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ImportQueueService } from '../import/import-queue.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LinkedinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: ImportQueueService,
    private readonly auditService: AuditService,
  ) {}

  async requestContactMatch(input: {
    contactId: string;
    actorUserId?: string;
    ip?: string;
    force: boolean;
    maxResults: number;
  }): Promise<{ queued: true; jobId: string }> {
    if (!input.actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }

    ensureLinkedinProviderConfigured();

    const contact = await this.prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { id: true },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const jobPayload: LinkedinMatchContactInput = {
      contactId: input.contactId,
      requestedByUserId: input.actorUserId,
      force: input.force,
      maxResults: input.maxResults,
    };
    const jobId = await this.queueService.enqueueLinkedinMatchContact(jobPayload);

    await this.auditService.log({
      actorUserId: input.actorUserId,
      action: 'linkedin.match_contact_requested',
      entityType: 'contact',
      entityId: input.contactId,
      ip: input.ip,
      metaJson: {
        jobId,
        force: input.force,
        maxResults: input.maxResults,
      },
    });

    return {
      queued: true,
      jobId,
    };
  }

  async requestBackfill(input: {
    filters: LinkedinMatchBackfillInput;
    actorUserId?: string;
    ip?: string;
  }): Promise<{ queued: true; jobId: string; filters: LinkedinMatchBackfillInput }> {
    if (!input.actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }

    ensureLinkedinProviderConfigured();

    const jobId = await this.queueService.enqueueLinkedinMatchBackfill({
      ...input.filters,
      requestedByUserId: input.actorUserId,
    });

    await this.auditService.log({
      actorUserId: input.actorUserId,
      action: 'linkedin.match_backfill_requested',
      entityType: 'linkedin_match',
      entityId: jobId,
      ip: input.ip,
      metaJson: {
        filters: input.filters,
      },
    });

    return {
      queued: true,
      jobId,
      filters: input.filters,
    };
  }

  async listSuggestions(query: LinkedinSuggestionsQueryInput): Promise<{
    data: Array<{
      id: string;
      contactId: string;
      contactName: string;
      provider: string;
      profileUrl: string;
      profileName: string;
      headline: string | null;
      location: string | null;
      currentCompany: string | null;
      score: number;
      evidenceSnippet: string | null;
      status: 'pending' | 'approved' | 'rejected';
      reviewQueueId: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const where: Prisma.LinkedinProfileSuggestionWhereInput = {
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.status ? { status: reviewStatusFromApi(query.status) } : {}),
      ...(query.provider ? { provider: providerNameFromFilter(query.provider) } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.linkedinProfileSuggestion.count({ where }),
      this.prisma.linkedinProfileSuggestion.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
        orderBy: [
          { score: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        contactId: row.contact.id,
        contactName: row.contact.fullName,
        provider: row.provider,
        profileUrl: row.profileUrl,
        profileName: row.profileName,
        headline: row.headline,
        location: row.location,
        currentCompany: row.currentCompany,
        score: row.score,
        evidenceSnippet: row.evidenceSnippet,
        status: row.status.toLowerCase() as 'pending' | 'approved' | 'rejected',
        reviewQueueId: row.reviewQueueId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    };
  }

  async getStatus(): Promise<{
    provider: {
      provider: LinkedinSearchProvider;
      name: string;
      label: string;
      configured: boolean;
      envVars: string[];
      apiUrl: string;
    };
    totals: {
      contactsMissingLinkedin: number;
      pendingSuggestions: number;
      approvedSuggestions: number;
      rejectedSuggestions: number;
      suggestedContacts: number;
    };
    lastSuggestionAt: string | null;
  }> {
    const provider = getLinkedinSearchProviderStatus();

    const [
      contactsMissingLinkedin,
      pendingSuggestions,
      approvedSuggestions,
      rejectedSuggestions,
      suggestedContactsRaw,
      latestSuggestion,
    ] = await Promise.all([
      this.prisma.contact.count({
        where: {
          contactMethods: {
            none: {
              type: ContactMethodType.LINKEDIN,
            },
          },
        },
      }),
      this.prisma.linkedinProfileSuggestion.count({
        where: { status: ReviewStatus.PENDING },
      }),
      this.prisma.linkedinProfileSuggestion.count({
        where: { status: ReviewStatus.APPROVED },
      }),
      this.prisma.linkedinProfileSuggestion.count({
        where: { status: ReviewStatus.REJECTED },
      }),
      this.prisma.linkedinProfileSuggestion.findMany({
        distinct: ['contactId'],
        select: { contactId: true },
      }),
      this.prisma.linkedinProfileSuggestion.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      provider,
      totals: {
        contactsMissingLinkedin,
        pendingSuggestions,
        approvedSuggestions,
        rejectedSuggestions,
        suggestedContacts: suggestedContactsRaw.length,
      },
      lastSuggestionAt: latestSuggestion?.createdAt.toISOString() ?? null,
    };
  }
}

function reviewStatusFromApi(value: 'pending' | 'approved' | 'rejected'): ReviewStatus {
  if (value === 'approved') {
    return ReviewStatus.APPROVED;
  }
  if (value === 'rejected') {
    return ReviewStatus.REJECTED;
  }
  return ReviewStatus.PENDING;
}

function providerNameFromFilter(value: 'serpapi' | 'brave' | 'google_custom_search'): string {
  if (value === 'brave') {
    return 'brave_search';
  }

  return value;
}

function ensureLinkedinProviderConfigured(): void {
  const provider = getLinkedinSearchProviderStatus();
  if (!provider.configured) {
    throw new BadRequestException(
      `LinkedIn search provider is not configured. Set ${provider.envVars.join(', ')} first.`,
    );
  }
}
