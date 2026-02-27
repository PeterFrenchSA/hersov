import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OpenAiService } from '../src/ai/openai.service';

describe('Semantic search integration', () => {
  let app: INestApplication;

  const prismaMock = {
    $queryRawUnsafe: jest.fn(async () => [
      {
        contact_id: 'contact_1',
        full_name: 'Jane Doe',
        current_title: 'Partner',
        company_name: 'Acme Capital',
        location_country: 'United Kingdom',
        preview_snippet: 'name: Jane Doe',
        distance: 0.12,
      },
    ]),
  };

  const openAiMock = {
    createEmbedding: jest.fn(async () => ({
      vector: [0.11, 0.22, 0.33],
      model: 'test-embedding-model',
    })),
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
          id: 'usr_analyst',
          email: 'analyst@example.com',
          role: 'Analyst',
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

  it('GET /api/search/semantic returns ranked results', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/search/semantic')
      .query({ q: 'uk investor', k: 5 })
      .expect(200);

    expect(openAiMock.createEmbedding).toHaveBeenCalledWith('uk investor');
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(1);

    const sqlCall = prismaMock.$queryRawUnsafe.mock.calls[0] as unknown[];
    expect(String(sqlCall[0])).toContain('FROM embeddings');
    expect(sqlCall[2]).toBe(5);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data[0]).toMatchObject({
      id: 'contact_1',
      name: 'Jane Doe',
      title: 'Partner',
      company: 'Acme Capital',
      country: 'United Kingdom',
    });
    expect(response.body.data[0].score).toBeCloseTo(0.88, 6);
  });
});
