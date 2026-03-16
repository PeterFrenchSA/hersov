import {
  ContactMethodType,
  PrismaClient,
  ReviewKind,
  ReviewStatus,
  Role,
  type Prisma,
} from '@prisma/client';
import {
  linkedinMatchBackfillSchema,
  linkedinMatchContactSchema,
  type LinkedinMatchBackfillInput,
  type LinkedinMatchContactInput,
} from '@hersov/shared';
import { searchLinkedinProfiles, type LinkedinSearchCandidate } from './search-api';
import { scoreLinkedinCandidate } from './heuristics';

const prisma = new PrismaClient();

export const processLinkedinMatchContactJob = createLinkedinMatchContactProcessor(prisma);
export const processLinkedinMatchBackfillJob = createLinkedinMatchBackfillProcessor(prisma);

export async function closeLinkedinMatchProcessor(): Promise<void> {
  await prisma.$disconnect();
}

export function createLinkedinMatchContactProcessor(
  prismaClient: PrismaClient,
  deps: {
    search?: (input: {
      query: string;
      maxResults: number;
    }) => Promise<{ providerName: string; candidates: LinkedinSearchCandidate[] }>;
  } = {},
) {
  const search = deps.search ?? searchLinkedinProfiles;

  return async (payload: LinkedinMatchContactInput): Promise<{
    status: 'processed' | 'skipped';
    reason?: string;
    suggestedCount?: number;
  }> => {
    const input = linkedinMatchContactSchema.parse(payload);
    const minScore = getMinimumScore();

    const contact = await prismaClient.contact.findUnique({
      where: { id: input.contactId },
      include: {
        currentCompany: {
          select: {
            name: true,
          },
        },
        contactMethods: {
          where: {
            type: {
              in: [ContactMethodType.LINKEDIN, ContactMethodType.EMAIL],
            },
          },
          select: {
            type: true,
            value: true,
          },
        },
      },
    });

    if (!contact) {
      throw new Error(`Contact ${input.contactId} not found`);
    }

    const existingLinkedinMethods = contact.contactMethods.filter((method) => method.type === ContactMethodType.LINKEDIN);
    const contactEmails = contact.contactMethods
      .filter((method) => method.type === ContactMethodType.EMAIL)
      .map((method) => method.value);

    if (!input.force && existingLinkedinMethods.length > 0) {
      return {
        status: 'skipped',
        reason: 'contact_already_has_linkedin',
      };
    }

    const query = buildSearchQuery({
      fullName: contact.fullName,
      companyName: contact.currentCompany?.name ?? null,
      currentTitle: contact.currentTitle,
      locationCountry: contact.locationCountry,
      emails: contactEmails,
    });

    const searchResponse = await search({
      query,
      maxResults: input.maxResults,
    });
    const searchResults = searchResponse.candidates;

    if (searchResults.length === 0) {
      await writeAuditLog(prismaClient, {
        actorUserId: input.requestedByUserId,
        action: 'linkedin.match_contact_no_candidates',
        entityType: 'contact',
        entityId: contact.id,
        metaJson: {
          query,
          provider: searchResponse.providerName,
        },
      });
      return {
        status: 'processed',
        suggestedCount: 0,
      };
    }

    const actorUserId = await resolveSuggestionActorUserId(prismaClient, input.requestedByUserId);
    const scoredCandidates = searchResults
      .map((candidate) => ({
        candidate,
        score: scoreLinkedinCandidate(
          {
            fullName: contact.fullName,
            firstName: contact.firstName,
            lastName: contact.lastName,
            companyName: contact.currentCompany?.name ?? null,
            currentTitle: contact.currentTitle,
            locationCity: contact.locationCity,
            locationCountry: contact.locationCountry,
          },
          candidate,
        ),
      }))
      .filter((item) => item.score.score >= minScore)
      .sort((left, right) => right.score.score - left.score.score)
      .slice(0, input.maxResults);

    let suggestedCount = 0;
    for (const item of scoredCandidates) {
      const existingSuggestion = await prismaClient.linkedinProfileSuggestion.findUnique({
        where: {
          contactId_profileUrl: {
            contactId: contact.id,
            profileUrl: item.candidate.profileUrl,
          },
        },
        select: {
          id: true,
          status: true,
          reviewQueueId: true,
        },
      });

      if (existingSuggestion && existingSuggestion.status !== ReviewStatus.PENDING && !input.force) {
        continue;
      }

      const suggestion = await prismaClient.linkedinProfileSuggestion.upsert({
        where: {
          contactId_profileUrl: {
            contactId: contact.id,
            profileUrl: item.candidate.profileUrl,
          },
        },
        update: {
          provider: searchResponse.providerName,
          profileName: item.candidate.profileName || contact.fullName,
          headline: item.candidate.headline,
          location: item.candidate.location,
          currentCompany: item.candidate.currentCompany,
          score: item.score.score,
          evidenceSnippet: item.candidate.snippet ?? item.candidate.headline ?? item.score.evidenceSnippet,
          signalsJson: item.score.signals as unknown as Prisma.InputJsonValue,
          status: ReviewStatus.PENDING,
        },
        create: {
          contactId: contact.id,
          provider: searchResponse.providerName,
          profileUrl: item.candidate.profileUrl,
          profileName: item.candidate.profileName || contact.fullName,
          headline: item.candidate.headline,
          location: item.candidate.location,
          currentCompany: item.candidate.currentCompany,
          score: item.score.score,
          evidenceSnippet: item.candidate.snippet ?? item.candidate.headline ?? item.score.evidenceSnippet,
          signalsJson: item.score.signals as unknown as Prisma.InputJsonValue,
          status: ReviewStatus.PENDING,
        },
      });

      const reviewPayload = {
        suggestionId: suggestion.id,
        contactId: contact.id,
        contactName: contact.fullName,
        profileUrl: suggestion.profileUrl,
        profileName: suggestion.profileName,
        headline: suggestion.headline,
        location: suggestion.location,
        currentCompany: suggestion.currentCompany,
        confidence: suggestion.score,
        evidenceSnippet: suggestion.evidenceSnippet,
        provider: suggestion.provider,
        signals: suggestion.signalsJson,
      };

      const currentReviewRow = suggestion.reviewQueueId
        ? await prismaClient.reviewQueue.findUnique({
            where: { id: suggestion.reviewQueueId },
            select: { id: true, status: true },
          })
        : null;

      if (currentReviewRow?.status === ReviewStatus.PENDING) {
        await prismaClient.reviewQueue.update({
          where: { id: currentReviewRow.id },
          data: {
            payloadJson: reviewPayload as unknown as Prisma.InputJsonValue,
          },
        });
      } else {
        const reviewRow = await prismaClient.reviewQueue.create({
          data: {
            kind: ReviewKind.LINKEDIN_PROFILE,
            payloadJson: reviewPayload as unknown as Prisma.InputJsonValue,
            status: ReviewStatus.PENDING,
            createdByUserId: actorUserId,
          },
        });

        await prismaClient.linkedinProfileSuggestion.update({
          where: { id: suggestion.id },
          data: {
            reviewQueueId: reviewRow.id,
            status: ReviewStatus.PENDING,
          },
        });
      }

      suggestedCount += 1;
    }

    await writeAuditLog(prismaClient, {
      actorUserId: input.requestedByUserId,
      action: 'linkedin.match_contact_completed',
      entityType: 'contact',
      entityId: contact.id,
        metaJson: {
          query,
          provider: searchResponse.providerName,
          minScore,
          candidateCount: searchResults.length,
          suggestedCount,
      },
    });

    return {
      status: 'processed',
      suggestedCount,
    };
  };
}

export function createLinkedinMatchBackfillProcessor(
  prismaClient: PrismaClient,
  deps: {
    processContact?: (payload: LinkedinMatchContactInput) => Promise<{ status: 'processed' | 'skipped' }>;
  } = {},
) {
  const processContact = deps.processContact ?? createLinkedinMatchContactProcessor(prismaClient);

  return async (payload: LinkedinMatchBackfillInput): Promise<{
    totalTargets: number;
    processedTargets: number;
    skippedTargets: number;
  }> => {
    const input = linkedinMatchBackfillSchema.parse(payload);

    await writeAuditLog(prismaClient, {
      actorUserId: input.requestedByUserId,
      action: 'linkedin.match_backfill_started',
      entityType: 'linkedin_match',
      metaJson: {
        filters: input,
      },
    });

    const contacts = await prismaClient.contact.findMany({
      where: {
        ...(input.country
          ? {
              locationCountry: {
                equals: input.country,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(input.importedBatchId
          ? {
              sourceImportBatchId: input.importedBatchId,
            }
          : {}),
        ...(input.missingLinkedinOnly
          ? {
              contactMethods: {
                none: {
                  type: ContactMethodType.LINKEDIN,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: input.limit,
    });

    let processedTargets = 0;
    let skippedTargets = 0;

    for (const contact of contacts) {
      try {
        const result = await processContact({
          contactId: contact.id,
          requestedByUserId: input.requestedByUserId,
          force: input.force,
          maxResults: input.maxResultsPerContact,
        });

        if (result.status === 'processed') {
          processedTargets += 1;
        } else {
          skippedTargets += 1;
        }
      } catch {
        skippedTargets += 1;
      }
    }

    await writeAuditLog(prismaClient, {
      actorUserId: input.requestedByUserId,
      action: 'linkedin.match_backfill_completed',
      entityType: 'linkedin_match',
      metaJson: {
        filters: input,
        totalTargets: contacts.length,
        processedTargets,
        skippedTargets,
      },
    });

    return {
      totalTargets: contacts.length,
      processedTargets,
      skippedTargets,
    };
  };
}

export function buildSearchQuery(input: {
  fullName: string;
  companyName: string | null;
  currentTitle: string | null;
  locationCountry: string | null;
  emails: string[];
}): string {
  const primaryEmail = input.emails[0] ?? null;
  const primaryDomain = primaryEmail?.split('@')[1]?.trim() ?? null;
  const parts = [
    'site:linkedin.com/in',
    quoteTerm(input.fullName),
    input.companyName ? quoteTerm(input.companyName) : '',
    input.currentTitle ? quoteTerm(input.currentTitle) : '',
    input.locationCountry ? quoteTerm(input.locationCountry) : '',
    !input.companyName && primaryDomain ? quoteTerm(primaryDomain) : '',
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.join(' ');
}

function quoteTerm(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('"')) {
    return trimmed.replace(/"/g, '');
  }

  return `"${trimmed}"`;
}

function getMinimumScore(): number {
  const parsed = Number.parseFloat(process.env.LINKEDIN_MATCH_MIN_SCORE ?? '');
  if (!Number.isFinite(parsed)) {
    return 0.45;
  }
  return Math.max(0.1, Math.min(0.95, parsed));
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
    console.warn('Failed to write linkedin match audit log', error);
  }
}
