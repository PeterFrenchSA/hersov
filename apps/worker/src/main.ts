import IORedis from 'ioredis';
import { Worker } from 'bullmq';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'default',
  async () => {
    // Placeholder worker for PR #1.
    return;
  },
  { connection },
);

worker.on('ready', () => {
  console.log('worker started');
});

worker.on('error', (error) => {
  console.error('worker error', error);
});

const shutdown = async (): Promise<void> => {
  await worker.close();
  await connection.quit();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
