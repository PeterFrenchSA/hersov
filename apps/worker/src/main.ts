import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { enrichmentJobName, importJobName, importQueueName } from '@hersov/shared';
import { closeImportProcessor, processImportJob } from './import/processor';
import { closeEnrichmentRunProcessor, processEnrichmentRun } from './enrichment/processor';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  importQueueName,
  async (job) => {
    if (job.name === importJobName) {
      const payload = job.data as { batchId?: string };
      if (!payload.batchId) {
        throw new Error('Missing batchId for import job');
      }

      await processImportJob({ batchId: payload.batchId });
      return;
    }

    if (job.name === enrichmentJobName) {
      const payload = job.data as { runId?: string };
      if (!payload.runId) {
        throw new Error('Missing runId for enrichment run job');
      }

      await processEnrichmentRun({ runId: payload.runId });
      return;
    }

    throw new Error(`Unsupported job name: ${job.name}`);
  },
  {
    connection,
    concurrency: 2,
  },
);

worker.on('ready', () => {
  console.log('worker started');
});

worker.on('completed', (job) => {
  console.log(`job completed: ${job.id}`);
});

worker.on('failed', (job, error) => {
  console.error(`job failed: ${job?.id}`, error);
});

worker.on('error', (error) => {
  console.error('worker error', error);
});

const shutdown = async (): Promise<void> => {
  await worker.close();
  await closeImportProcessor();
  await closeEnrichmentRunProcessor();
  await connection.quit();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
