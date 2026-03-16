import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportQueueService } from '../src/import/import-queue.service';

type BatchRecord = {
  id: string;
  filename: string;
  originalHeadersJson: string[];
  columnMappingJson: Record<string, unknown> | null;
  status: string;
  createdByUserId: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  totalRows: number;
  processedRows: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  duplicateCount: number;
  errorCount: number;
  errorSampleJson: unknown[];
};

describe('Import flow integration', () => {
  let app: INestApplication;
  let uploadDir: string;
  const batches = new Map<string, BatchRecord>();

  const queueMock = {
    enqueueImportBatch: jest.fn(async () => undefined),
    onModuleDestroy: jest.fn(async () => undefined),
  };

  const prismaMock = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) => {
        if (where.id === 'usr_admin') {
          return {
            id: 'usr_admin',
            email: 'admin@example.com',
            role: 'Admin',
          };
        }

        return null;
      }),
    },
    importBatch: {
      create: jest.fn(async ({ data }: { data: BatchRecord }) => {
        const now = new Date();
        const created: BatchRecord = {
          ...data,
          createdAt: now,
          startedAt: null,
          finishedAt: null,
          totalRows: data.totalRows ?? 0,
          processedRows: data.processedRows ?? 0,
          insertedCount: data.insertedCount ?? 0,
          updatedCount: data.updatedCount ?? 0,
          skippedCount: data.skippedCount ?? 0,
          duplicateCount: data.duplicateCount ?? 0,
          errorCount: data.errorCount ?? 0,
          errorSampleJson: Array.isArray(data.errorSampleJson) ? data.errorSampleJson : [],
          columnMappingJson: data.columnMappingJson ?? null,
        };
        batches.set(data.id, created);
        return created;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return batches.get(where.id) ?? null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<BatchRecord> }) => {
        const existing = batches.get(where.id);
        if (!existing) {
          throw new Error('batch not found');
        }

        const updated = {
          ...existing,
          ...data,
        } as BatchRecord;

        batches.set(where.id, updated);
        return updated;
      }),
    },
    importRow: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    auditLog: {
      create: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };

  beforeAll(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'mini-crm-import-test-'));
    process.env.IMPORT_DATA_DIR = uploadDir;
    process.env.IMPORT_STORE_RAW_ROWS = 'false';

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
          id: 'usr_admin',
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
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('uploads CSV, saves mapping, starts import, and reads status', async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post('/api/import/csv')
      .attach(
        'file',
        Buffer.from('First Name,Last Name,Emails\nJane,Doe,jane@example.com\n', 'utf8'),
        'contacts.csv',
      )
      .expect(201);

    expect(Array.isArray(uploadResponse.body.headersDetected)).toBe(true);
    const batchId = uploadResponse.body.batchId as string;
    expect(batchId).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/import/${batchId}/mapping`)
      .send({
        mapping: {
          first_name: 'First Name',
          last_name: 'Last Name',
          full_name: null,
          emails: 'Emails',
          phones: null,
          company: null,
          title: null,
          notes_context: null,
          city: null,
          country: null,
          linkedin: null,
          website: null,
          twitter: null,
        },
        emailDelimiters: [',', ';'],
        phoneDelimiters: [',', ';'],
        csvDelimiter: ',',
      })
      .expect(201);

    await request(app.getHttpServer()).post(`/api/import/${batchId}/start`).expect(201);

    expect(queueMock.enqueueImportBatch).toHaveBeenCalledWith(batchId);

    const statusResponse = await request(app.getHttpServer())
      .get(`/api/import/${batchId}/status`)
      .expect(200);

    expect(statusResponse.body.batchId).toBe(batchId);
    expect(statusResponse.body.status).toBe('processing');
  });
});
