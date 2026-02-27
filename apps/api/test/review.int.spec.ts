import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ReviewKind, ReviewStatus, RelationshipStatus } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type ReviewRow = {
  id: string;
  kind: ReviewKind;
  status: ReviewStatus;
  payloadJson: Record<string, unknown>;
  createdByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

describe('Review workflow integration', () => {
  let app: INestApplication;
  const reviewRows = new Map<string, ReviewRow>();
  const relationshipRows = new Map<string, { id: string; status: RelationshipStatus; confidence: number }>();
  const contactTags = new Map<string, { contactId: string; tagId: string; confidence: number | null; source: string | null }>();

  const prismaMock: any = {
    reviewQueue: {
      count: jest.fn(async () => reviewRows.size),
      findMany: jest.fn(async () => Array.from(reviewRows.values())),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => reviewRows.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ReviewRow> }) => {
        const existing = reviewRows.get(where.id);
        if (!existing) {
          throw new Error('review row not found');
        }

        const updated: ReviewRow = {
          ...existing,
          ...data,
        };
        reviewRows.set(where.id, updated);
        return updated;
      }),
    },
    tag: {
      upsert: jest.fn(async () => ({ id: 'tag-1' })),
    },
    contactTag: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.contactId_tagId.contactId}:${where.contactId_tagId.tagId}`;
        const existing = contactTags.get(key);
        if (existing) {
          const merged = {
            ...existing,
            ...update,
          };
          contactTags.set(key, merged);
          return merged;
        }

        const created = {
          contactId: create.contactId,
          tagId: create.tagId,
          confidence: create.confidence ?? null,
          source: create.source ?? null,
        };
        contactTags.set(key, created);
        return created;
      }),
    },
    contactEntityMention: {
      update: jest.fn(async () => ({})),
    },
    relationship: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { status?: RelationshipStatus; confidence?: number } }) => {
        const existing = relationshipRows.get(where.id);
        if (!existing) {
          throw new Error('relationship not found');
        }

        const updated = {
          ...existing,
          ...data,
        };
        relationshipRows.set(where.id, updated);
        return updated;
      }),
    },
    auditLog: {
      create: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };

  beforeAll(async () => {
    reviewRows.set('review-tag-1', {
      id: 'review-tag-1',
      kind: ReviewKind.TAG,
      status: ReviewStatus.PENDING,
      payloadJson: {
        contactId: 'contact-1',
        category: 'sector',
        value: 'energy',
        confidence: 0.9,
        evidenceSnippet: 'Discussed energy deals.',
      },
      createdByUserId: 'usr-admin',
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: new Date(),
    });

    relationshipRows.set('rel-1', {
      id: 'rel-1',
      status: RelationshipStatus.SUGGESTED,
      confidence: 0.75,
    });

    reviewRows.set('review-rel-1', {
      id: 'review-rel-1',
      kind: ReviewKind.RELATIONSHIP,
      status: ReviewStatus.PENDING,
      payloadJson: {
        relationshipId: 'rel-1',
        fromContactId: 'contact-1',
        type: 'introduced_by',
        confidence: 0.75,
        evidenceSnippet: 'Introduced by John.',
      },
      createdByUserId: 'usr-admin',
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: new Date(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.session = {
        user: {
          id: 'usr-admin',
          email: 'admin@example.com',
          role: 'Admin',
        },
      };
      next();
    });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists review queue and supports approve/reject actions', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/api/review?status=pending&page=1&pageSize=20')
      .expect(200);

    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.data.length).toBeGreaterThan(0);

    await request(app.getHttpServer()).post('/api/review/review-tag-1/approve').expect(201);
    expect(contactTags.size).toBe(1);

    await request(app.getHttpServer()).post('/api/review/review-rel-1/reject').expect(201);
    expect(relationshipRows.get('rel-1')?.status).toBe(RelationshipStatus.REJECTED);
  });
});
