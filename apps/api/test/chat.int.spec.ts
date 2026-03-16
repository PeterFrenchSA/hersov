import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OpenAiService } from '../src/ai/openai.service';

type ThreadRecord = {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

describe('Chat integration', () => {
  let app: INestApplication;

  const threads = new Map<string, ThreadRecord>();
  const createdMessages: Array<{ role: string; contentText: string; toolName?: string | null }> = [];
  let messageCounter = 0;

  const prismaMock: any = {
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
    chatThread: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string; userId?: string } }) => {
        if (!where.id) {
          return null;
        }

        const existing = threads.get(where.id);
        if (!existing || (where.userId && existing.userId !== where.userId)) {
          return null;
        }

        return existing;
      }),
      create: jest.fn(async ({ data }: { data: { userId: string; title?: string | null } }) => {
        const now = new Date();
        const created: ThreadRecord = {
          id: 'thread_1',
          userId: data.userId,
          title: data.title ?? null,
          createdAt: now,
          updatedAt: now,
        };
        threads.set(created.id, created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { updatedAt?: Date } }) => {
        const existing = threads.get(where.id);
        if (!existing) {
          throw new Error('thread not found');
        }

        const updated: ThreadRecord = {
          ...existing,
          updatedAt: data.updatedAt ?? new Date(),
        };
        threads.set(where.id, updated);
        return updated;
      }),
      count: jest.fn(async () => threads.size),
      findMany: jest.fn(async () => []),
    },
    chatMessage: {
      create: jest.fn(async ({ data }: { data: { role: string; contentText: string; toolName?: string | null } }) => {
        const created = {
          id: `msg_${++messageCounter}`,
          createdAt: new Date(),
          ...data,
        };
        createdMessages.push({
          role: created.role,
          contentText: created.contentText,
          toolName: created.toolName ?? null,
        });
        return created;
      }),
    },
    contact: {
      findMany: jest.fn(async () => [
        {
          id: 'contact_1',
          fullName: 'Jane Doe',
          currentTitle: 'Partner',
          locationCountry: 'United Kingdom',
          currentCompany: { name: 'Acme Capital' },
          contactMethods: [],
        },
      ]),
      findUnique: jest.fn(async () => null),
    },
    contactMethod: {
      findMany: jest.fn(async () => []),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `audit_${Math.random().toString(16).slice(2)}`,
        createdAt: new Date(),
        ...data,
      })),
    },
    $queryRawUnsafe: jest.fn(async () => []),
  };

  const openAiMock = {
    getChatModel: jest.fn(() => 'gpt-4.1-mini'),
    createEmbedding: jest.fn(async () => ({
      vector: [0.01, 0.02],
      model: 'test-embedding-model',
    })),
    streamResponse: jest
      .fn()
      .mockImplementationOnce(async () => ({
        responseId: 'resp_1',
        outputText: '',
        toolCalls: [
          {
            callId: 'tool_call_1',
            name: 'crm.searchContacts',
            argumentsJson: JSON.stringify({
              filters: { q: 'Jane Doe' },
              limit: 5,
            }),
          },
        ],
      }))
      .mockImplementationOnce(async (options: { onTextDelta?: (delta: string) => void }) => {
        options.onTextDelta?.('Found ');
        options.onTextDelta?.('Jane Doe.');

        return {
          responseId: 'resp_2',
          outputText: 'Found Jane Doe.',
          toolCalls: [],
          usage: { total_tokens: 42 },
        };
      }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(OpenAiService)
      .useValue(openAiMock)
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
  });

  it('POST /api/chat executes tools and streams SSE events', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ message: 'Find Jane Doe at Acme Capital' })
      .expect(200);

    expect(String(response.headers['content-type'])).toContain('text/event-stream');
    expect(response.text).toContain('event: thread');
    expect(response.text).toContain('event: tool');
    expect(response.text).toContain('event: delta');
    expect(response.text).toContain('Found ');
    expect(response.text).toContain('Jane Doe.');
    expect(response.text).toContain('event: done');

    expect(openAiMock.streamResponse).toHaveBeenCalledTimes(2);
    expect(prismaMock.contact.findMany).toHaveBeenCalledTimes(1);

    const auditActions = (prismaMock.auditLog.create.mock.calls as Array<[{ data: { action: string } }]>).map(
      (entry) => entry[0].data.action,
    );
    expect(auditActions).toEqual(expect.arrayContaining(['chat.started', 'chat.tools_executed', 'chat.completed']));

    expect(createdMessages.some((message) => message.role === 'TOOL')).toBe(true);
    expect(createdMessages.some((message) => message.role === 'ASSISTANT')).toBe(true);
  });
});
