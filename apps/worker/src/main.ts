import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import {
  embeddingsBackfillJobName,
  embeddingsUpsertContactJobName,
  enrichmentJobName,
  importJobName,
  importQueueName,
  type EmbeddingsBackfillInput,
} from '@hersov/shared';
import { closeImportProcessor, processImportJob } from './import/processor';
import { closeEnrichmentRunProcessor, processEnrichmentRun } from './enrichment/processor';
import {
  closeEmbeddingsProcessor,
  processEmbeddingsBackfillJob,
  processEmbeddingsUpsertContactJob,
} from './embeddings/processor';
import { closeEmbeddingsDispatchQueue } from './embeddings/dispatch';

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

    if (job.name === embeddingsUpsertContactJobName) {
      const payload = job.data as { contactId?: string; force?: boolean; reason?: string };
      if (!payload.contactId) {
        throw new Error('Missing contactId for embeddings upsert job');
      }

      await processEmbeddingsUpsertContactJob({
        contactId: payload.contactId,
        force: payload.force,
        reason: payload.reason,
      });
      return;
    }

    if (job.name === embeddingsBackfillJobName) {
      const payload = job.data as { filters?: unknown; requestedByUserId?: string };
      await processEmbeddingsBackfillJob({
        filters: payload.filters as EmbeddingsBackfillInput | undefined,
        requestedByUserId: payload.requestedByUserId,
      });
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
  await closeEmbeddingsProcessor();
  await closeEmbeddingsDispatchQueue();
  await connection.quit();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
