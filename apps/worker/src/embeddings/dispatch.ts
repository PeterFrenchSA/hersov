import { Queue } from 'bullmq';
import { embeddingsUpsertContactJobName, importQueueName } from '@hersov/shared';
import { getBullConnectionOptions } from '../redis-connection';

let queue: Queue | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(importQueueName, {
      connection: getBullConnectionOptions(),
    });
  }

  return queue;
}

export async function enqueueEmbeddingUpsertContactJobs(contactIds: string[], reason: string): Promise<void> {
  const deduped = Array.from(new Set(contactIds.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (deduped.length === 0) {
    return;
  }

  const targetQueue = getQueue();

  await targetQueue.addBulk(
    deduped.map((contactId) => ({
      name: embeddingsUpsertContactJobName,
      data: {
        contactId,
        reason,
      },
      opts: {
        jobId: buildJobId('embeddings', 'upsert', contactId),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    })),
  );
}

export async function closeEmbeddingsDispatchQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

function buildJobId(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/[^a-zA-Z0-9_-]+/g, '-'))
    .filter((part) => part.length > 0)
    .join('__');
}
