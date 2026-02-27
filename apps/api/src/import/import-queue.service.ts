import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { enrichmentJobName, importJobName, importQueueName } from '@hersov/shared';

@Injectable()
export class ImportQueueService implements OnModuleDestroy {
  private connection?: IORedis;
  private queue?: Queue;

  async enqueueImportBatch(batchId: string): Promise<void> {
    const queue = this.getQueue();

    await queue.add(
      importJobName,
      { batchId },
      {
        jobId: `import:process:${batchId}`,
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
        jobId: `enrichment:run:${runId}`,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = undefined;
    }

    if (this.connection) {
      await this.connection.quit();
      this.connection = undefined;
    }
  }

  private getQueue(): Queue {
    if (!this.queue) {
      const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
      this.connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
      });
      this.queue = new Queue(importQueueName, {
        connection: this.connection,
      });
    }

    return this.queue;
  }
}
