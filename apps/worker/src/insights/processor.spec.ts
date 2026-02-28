import { EntityType, LlmRunStatus, ReviewKind, ReviewStatus } from '@prisma/client';
import { createInsightsUpsertContactProcessor } from './processor';
import type { InsightsExtractionResult } from './openai';

describe('insights processor integration', () => {
  let originalInsightsEnabled: string | undefined;

  beforeAll(() => {
    originalInsightsEnabled = process.env.INSIGHTS_ENABLED;
    process.env.INSIGHTS_ENABLED = 'true';
  });

  afterAll(() => {
    process.env.INSIGHTS_ENABLED = originalInsightsEnabled;
  });

  it('processes notes, stores insights, and creates review suggestions with mocked LLM output', async () => {
    const createdReviewRows: Array<{ kind: ReviewKind; status: ReviewStatus; payloadJson: Record<string, unknown> }> = [];

    const prismaMock: any = {
      contact: {
        findUnique: jest.fn(async () => ({
          id: 'contact-1',
          fullName: 'Jane Doe',
          notesRaw: 'Introduced by John Smith at Monaco Summit. Focus on climate tech.',
          currentTitle: 'Partner',
          locationCity: 'London',
          locationCountry: 'United Kingdom',
          currentCompany: { id: 'cmp-1', name: 'Acme Capital' },
          insights: null,
        })),
        findFirst: jest.fn(async () => null),
      },
      llmPromptVersion: {
        upsert: jest.fn(async () => ({})),
      },
      llmRun: {
        create: jest.fn(async () => ({
          id: 'llm-run-1',
          status: LlmRunStatus.PROCESSING,
        })),
        update: jest.fn(async () => ({})),
      },
      contactInsight: {
        upsert: jest.fn(async () => ({})),
      },
      contactTag: {
        findMany: jest.fn(async () => []),
        upsert: jest.fn(async () => ({})),
      },
      tag: {
        upsert: jest.fn(async () => ({ id: 'tag-1' })),
      },
      entityAlias: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
      },
      entity: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({
          id: 'ent-1',
          type: EntityType.COMPANY,
          canonicalName: 'Acme Capital',
        })),
      },
      contactEntityMention: {
        upsert: jest.fn(async () => ({
          id: 'mention-1',
          entityId: 'ent-1',
        })),
      },
      relationship: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({
          id: 'rel-1',
          toContactId: null,
          entityId: null,
        })),
        update: jest.fn(async () => ({})),
      },
      reviewQueue: {
        create: jest.fn(async ({ data }: { data: { kind: ReviewKind; status: ReviewStatus; payloadJson: Record<string, unknown> } }) => {
          createdReviewRows.push({
            kind: data.kind,
            status: data.status,
            payloadJson: data.payloadJson,
          });
          return { id: `review-${createdReviewRows.length}`, ...data };
        }),
      },
      auditLog: {
        create: jest.fn(async () => ({})),
      },
    };

    const mockExtractionResult: InsightsExtractionResult = {
      model: 'gpt-test',
      tokensIn: 100,
      tokensOut: 80,
      output: {
        meeting_context: {
          event_name: 'Monaco Summit',
          year: 2025,
        },
        tags: [
          {
            category: 'sector',
            value: 'climate tech',
            confidence: 0.95,
            evidence_snippet: 'Focus on climate tech.',
          },
        ],
        entities: [
          {
            type: 'company',
            name: 'Acme Capital',
            confidence: 0.82,
            evidence_snippet: 'Acme Capital',
          },
        ],
        relationship_clues: [],
        investor_signals: {
          is_investor: true,
          investor_type: 'PE',
          sectors: ['climate tech'],
        },
        topics: ['climate tech'],
      },
    };

    const processor = createInsightsUpsertContactProcessor(prismaMock, {
      extractInsights: jest.fn(async () => mockExtractionResult),
      enqueueGraphRecompute: jest.fn(async () => undefined),
    });

    const result = await processor({
      contactId: 'contact-1',
      requestedByUserId: 'usr-admin',
      fillMissingOnly: true,
      reason: 'test',
    });

    expect(result.updated).toBe(true);
    expect(prismaMock.contactInsight.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.llmRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'llm-run-1' },
        data: expect.objectContaining({
          status: LlmRunStatus.COMPLETED,
        }),
      }),
    );

    expect(createdReviewRows.length).toBeGreaterThan(0);
    expect(createdReviewRows.some((row) => row.kind === ReviewKind.TAG)).toBe(true);
    expect(createdReviewRows.some((row) => row.kind === ReviewKind.ENTITY)).toBe(true);
    expect(createdReviewRows.every((row) => typeof row.payloadJson.evidenceSnippet === 'string')).toBe(true);
  });
});
