import { Queue } from 'bullmq';
import {
  graphRecomputeScoresJobName,
  importQueueName,
  insightsUpsertContactJobName,
} from '@hersov/shared';
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

export async function enqueueInsightsUpsertContactJobs(
  contactIds: string[],
  options?: {
    reason?: string;
    force?: boolean;
    fillMissingOnly?: boolean;
    requestedByUserId?: string;
  },
): Promise<void> {
  const deduped = Array.from(new Set(contactIds.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (deduped.length === 0) {
    return;
  }

  const targetQueue = getQueue();
  await targetQueue.addBulk(
    deduped.map((contactId) => ({
      name: insightsUpsertContactJobName,
      data: {
        contactId,
        reason: options?.reason ?? 'unspecified',
        force: options?.force ?? false,
        fillMissingOnly: options?.fillMissingOnly ?? true,
        requestedByUserId: options?.requestedByUserId,
      },
      opts: {
        jobId: buildJobId('insights', 'upsert', contactId),
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    })),
  );
}

export async function enqueueGraphRecomputeScoresJob(requestedByUserId?: string): Promise<void> {
  const targetQueue = getQueue();
  await targetQueue.add(
    graphRecomputeScoresJobName,
    {
      requestedByUserId,
    },
    {
      jobId: buildJobId('graph', 'recompute', 'latest'),
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
}

export async function closeInsightsDispatchQueue(): Promise<void> {
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
