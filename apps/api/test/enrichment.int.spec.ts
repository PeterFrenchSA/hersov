import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportQueueService } from '../src/import/import-queue.service';

describe('Enrichment run integration', () => {
  let app: INestApplication;
  let originalApolloKey: string | undefined;

  const queueMock = {
    enqueueImportBatch: jest.fn(async () => undefined),
    enqueueEnrichmentRun: jest.fn(async () => undefined),
    onModuleDestroy: jest.fn(async () => undefined),
  };

  const createdRuns = new Map<string, any>();

  const prismaMock = {
    enrichmentRun: {
      create: jest.fn(async ({ data }: any) => {
        const created = {
          ...data,
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
          errorSampleJson: [],
        };
        createdRuns.set(created.id, created);
        return created;
      }),
      count: jest.fn(async () => createdRuns.size),
      findMany: jest.fn(async () => Array.from(createdRuns.values())),
      findUnique: jest.fn(async ({ where }: any) => createdRuns.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = createdRuns.get(where.id);
        if (!existing) {
          throw new Error('run not found');
        }

        const updated = { ...existing, ...data };
        createdRuns.set(where.id, updated);
        return updated;
      }),
    },
    enrichmentResult: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    auditLog: {
      create: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };

  beforeAll(async () => {
    originalApolloKey = process.env.APOLLO_API_KEY;
    process.env.APOLLO_API_KEY = '';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ImportQueueService)
      .useValue(queueMock)
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
    process.env.APOLLO_API_KEY = originalApolloKey;
  });

  it('creates and queues a mock enrichment run', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/enrichment/runs')
      .send({
        selection: {
          missingLocation: true,
        },
        providers: ['mock'],
        mergePolicy: 'fill_missing_only',
        dryRun: false,
      })
      .expect(201);

    expect(createResponse.body.id).toBeDefined();
    expect(queueMock.enqueueEnrichmentRun).toHaveBeenCalledWith(createResponse.body.id);

    const listResponse = await request(app.getHttpServer()).get('/api/enrichment/runs').expect(200);
    expect(listResponse.body.data.length).toBeGreaterThan(0);
  });
});
