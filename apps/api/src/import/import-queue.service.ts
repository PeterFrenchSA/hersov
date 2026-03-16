import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  embeddingsBackfillJobName,
  embeddingsUpsertContactJobName,
  enrichmentJobName,
  graphRecomputeScoresJobName,
  importJobName,
  importQueueName,
  insightsBackfillJobName,
  insightsUpsertContactJobName,
  linkedinMatchBackfillJobName,
  linkedinMatchContactJobName,
  type EmbeddingsBackfillInput,
  type InsightsBackfillInput,
  type LinkedinMatchBackfillInput,
  type LinkedinMatchContactInput,
} from '@hersov/shared';
import { getBullConnectionOptions } from './redis-connection';

@Injectable()
export class ImportQueueService implements OnModuleDestroy {
  private queue?: Queue;

  async enqueueImportBatch(batchId: string): Promise<void> {
    const queue = this.getQueue();

    await queue.add(
      importJobName,
      { batchId },
      {
        jobId: buildJobId('import', 'process', batchId),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async enqueueEnrichmentRun(runId: string): Promise<void> {
    const queue = this.getQueue();

    await queue.add(
      enrichmentJobName,
      { runId },
      {
        jobId: buildJobId('enrichment', 'run', runId),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async enqueueEmbeddingsBackfill(filters: EmbeddingsBackfillInput, requestedByUserId?: string): Promise<string> {
    const queue = this.getQueue();
    const jobId = buildJobId('embeddings', 'backfill', randomUUID());

    await queue.add(
      embeddingsBackfillJobName,
      {
        filters,
        requestedByUserId,
      },
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    return jobId;
  }

  async enqueueEmbeddingUpsertContact(contactId: string, reason = 'manual'): Promise<void> {
    const queue = this.getQueue();

    await queue.add(
      embeddingsUpsertContactJobName,
      {
        contactId,
        reason,
      },
      {
        jobId: buildJobId('embeddings', 'upsert', contactId),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async enqueueInsightsBackfill(
    filters: InsightsBackfillInput,
    requestedByUserId?: string,
  ): Promise<string> {
    const queue = this.getQueue();
    const jobId = buildJobId('insights', 'backfill', randomUUID());

    await queue.add(
      insightsBackfillJobName,
      {
        filters,
        requestedByUserId,
      },
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    return jobId;
  }

  async enqueueInsightsUpsertContact(
    contactId: string,
    options?: {
      reason?: string;
      force?: boolean;
      fillMissingOnly?: boolean;
      requestedByUserId?: string;
    },
  ): Promise<void> {
    const queue = this.getQueue();

    await queue.add(
      insightsUpsertContactJobName,
      {
        contactId,
        reason: options?.reason ?? 'manual',
        force: options?.force ?? false,
        fillMissingOnly: options?.fillMissingOnly ?? true,
        requestedByUserId: options?.requestedByUserId,
      },
      {
        jobId: buildJobId('insights', 'upsert', contactId),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async enqueueGraphRecomputeScores(requestedByUserId?: string): Promise<string> {
    const queue = this.getQueue();
    const jobId = buildJobId('graph', 'recompute', randomUUID());

    await queue.add(
      graphRecomputeScoresJobName,
      {
        requestedByUserId,
      },
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    return jobId;
  }

  async enqueueLinkedinMatchContact(input: LinkedinMatchContactInput): Promise<string> {
    const queue = this.getQueue();
    const jobId = buildJobId('linkedin', 'match', 'contact', input.contactId, randomUUID());

    await queue.add(
      linkedinMatchContactJobName,
      input,
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    return jobId;
  }

  async enqueueLinkedinMatchBackfill(input: LinkedinMatchBackfillInput): Promise<string> {
    const queue = this.getQueue();
    const jobId = buildJobId('linkedin', 'match', 'backfill', randomUUID());

    await queue.add(
      linkedinMatchBackfillJobName,
      input,
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    return jobId;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = undefined;
    }
  }

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(importQueueName, {
        connection: getBullConnectionOptions(),
      });
    }

    return this.queue;
  }
}

function buildJobId(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/[^a-zA-Z0-9_-]+/g, '-'))
    .filter((part) => part.length > 0)
    .join('__');
}
