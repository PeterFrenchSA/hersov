import { Worker } from 'bullmq';
import {
  embeddingsBackfillJobName,
  embeddingsUpsertContactJobName,
  enrichmentJobName,
  graphRecomputeScoresJobName,
  importJobName,
  importQueueName,
  linkedinMatchBackfillJobName,
  linkedinMatchContactJobName,
  type LinkedinMatchBackfillInput,
  type LinkedinMatchContactInput,
  type EmbeddingsBackfillInput,
  type InsightsBackfillInput,
  insightsBackfillJobName,
  insightsUpsertContactJobName,
} from '@hersov/shared';
import { closeImportProcessor, processImportJob } from './import/processor';
import { closeEnrichmentRunProcessor, processEnrichmentRun } from './enrichment/processor';
import {
  closeEmbeddingsProcessor,
  processEmbeddingsBackfillJob,
  processEmbeddingsUpsertContactJob,
} from './embeddings/processor';
import { closeEmbeddingsDispatchQueue } from './embeddings/dispatch';
import {
  closeInsightsProcessor,
  processGraphRecomputeScoresJob,
  processInsightsBackfillJob,
  processInsightsUpsertContactJob,
} from './insights/processor';
import { closeInsightsDispatchQueue } from './insights/dispatch';
import { getBullConnectionOptions } from './redis-connection';
import {
  closeLinkedinMatchProcessor,
  processLinkedinMatchBackfillJob,
  processLinkedinMatchContactJob,
} from './linkedin/processor';

const connection = getBullConnectionOptions();

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

    if (job.name === insightsUpsertContactJobName) {
      const payload = job.data as {
        contactId?: string;
        force?: boolean;
        fillMissingOnly?: boolean;
        requestedByUserId?: string;
        reason?: string;
      };
      if (!payload.contactId) {
        throw new Error('Missing contactId for insights upsert job');
      }

      await processInsightsUpsertContactJob({
        contactId: payload.contactId,
        force: payload.force,
        fillMissingOnly: payload.fillMissingOnly,
        requestedByUserId: payload.requestedByUserId,
        reason: payload.reason,
      });
      return;
    }

    if (job.name === insightsBackfillJobName) {
      const payload = job.data as { filters?: unknown; requestedByUserId?: string };
      await processInsightsBackfillJob({
        filters: payload.filters as InsightsBackfillInput | undefined,
        requestedByUserId: payload.requestedByUserId,
      });
      return;
    }

    if (job.name === graphRecomputeScoresJobName) {
      const payload = job.data as { requestedByUserId?: string };
      await processGraphRecomputeScoresJob({
        requestedByUserId: payload.requestedByUserId,
      });
      return;
    }

    if (job.name === linkedinMatchContactJobName) {
      const payload = job.data as LinkedinMatchContactInput;
      await processLinkedinMatchContactJob(payload);
      return;
    }

    if (job.name === linkedinMatchBackfillJobName) {
      const payload = job.data as LinkedinMatchBackfillInput;
      await processLinkedinMatchBackfillJob(payload);
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
  await closeInsightsProcessor();
  await closeEmbeddingsDispatchQueue();
  await closeInsightsDispatchQueue();
  await closeLinkedinMatchProcessor();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
