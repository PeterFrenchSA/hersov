import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const trustProxy = process.env.TRUST_PROXY === '1';
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const isProduction = process.env.NODE_ENV === 'production';
  const sessionSecret = process.env.SESSION_SECRET;

  if (isProduction && !sessionSecret) {
    throw new Error('SESSION_SECRET must be set in production');
  }

  if (trustProxy) {
    const expressApp = app.getHttpAdapter().getInstance() as {
      set?: (setting: string, value: unknown) => void;
    };
    expressApp.set?.('trust proxy', 1);
  }

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  app.use(helmet());
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || origin === appBaseUrl) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  const redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (error) => {
    // Keep process running; session middleware will fail fast on actual write attempts.
    console.error('Redis session client error', error);
  });
  await redisClient.connect();

  app.use(
    session({
      name: 'crm.sid',
      secret: sessionSecret ?? 'insecure-dev-secret',
      resave: false,
      saveUninitialized: false,
      proxy: trustProxy,
      store: new RedisStore({ client: redisClient, prefix: 'crm:sess:' }),
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Too many login attempts. Try again in a minute.' },
    }),
  );

  app.use(
    '/api/chat',
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => request.method !== 'POST',
      message: { message: 'Too many chat requests from this IP. Please slow down.' },
    }),
  );

  app.use(
    '/api/chat',
    rateLimit({
      windowMs: 60_000,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => request.method !== 'POST',
      keyGenerator: (request) => {
        const sessionUserId = (request as Request & { session?: { user?: { id?: string } } }).session?.user?.id;
        return sessionUserId ? `chat-user:${sessionUserId}` : `chat-anon:${request.ip}`;
      },
      message: { message: 'Too many chat requests for this user. Please slow down.' },
    }),
  );

  app.use(
    '/api/insights/backfill',
    rateLimit({
      windowMs: 60_000,
      limit: 8,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => request.method !== 'POST',
      message: { message: 'Too many insights backfill requests from this IP.' },
    }),
  );

  app.use(
    '/api/insights/backfill',
    rateLimit({
      windowMs: 60_000,
      limit: 4,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => request.method !== 'POST',
      keyGenerator: (request) => {
        const sessionUserId = (request as Request & { session?: { user?: { id?: string } } }).session?.user?.id;
        return sessionUserId ? `insights-user:${sessionUserId}` : `insights-anon:${request.ip}`;
      },
      message: { message: 'Too many insights backfill requests for this user.' },
    }),
  );

  app.use(
    '/api/graph/recompute',
    rateLimit({
      windowMs: 60_000,
      limit: 4,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => request.method !== 'POST',
      message: { message: 'Too many graph recompute requests. Please wait.' },
    }),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
