import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import session from 'express-session';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword } from '../src/common/password.util';

describe('API integration', () => {
  let app: INestApplication;

  const bootstrapUser = async () => {
    const passwordHash = await hashPassword('Password123!');

    return {
      id: 'usr_1',
      email: 'admin@example.com',
      passwordHash,
      role: 'Admin',
      createdAt: new Date(),
      lastLoginAt: null,
    };
  };

  beforeAll(async () => {
    const seededUser = await bootstrapUser();

    const prismaMock = {
      user: {
        findUnique: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
          if (where.email === seededUser.email || where.id === seededUser.id) {
            return seededUser;
          }

          return null;
        }),
        update: jest.fn(async () => ({ ...seededUser, lastLoginAt: new Date() })),
      },
      auditLog: {
        create: jest.fn(async () => ({})),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(
      session({
        name: 'crm.sid',
        secret: 'test-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
        },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200).expect({ status: 'ok' });
  });

  it('POST /api/auth/login creates a session and GET /api/me works', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'Password123!' })
      .expect(200);

    expect(loginResponse.body.user.email).toBe('admin@example.com');

    const cookies = loginResponse.headers['set-cookie'] as string[];
    expect(Array.isArray(cookies)).toBe(true);

    await request(app.getHttpServer()).get('/api/me').set('Cookie', cookies).expect(200);
  });
});
