import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ImportQueueService } from '../import/import-queue.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class GraphService {
  constructor(
    private readonly queueService: ImportQueueService,
    private readonly auditService: AuditService,
  ) {}

  async requestRecompute(input: {
    actorUserId?: string;
    ip?: string;
  }): Promise<{ queued: true; jobId: string }> {
    if (!input.actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }

    const jobId = await this.queueService.enqueueGraphRecomputeScores(input.actorUserId);

    await this.auditService.log({
      actorUserId: input.actorUserId,
      action: 'graph.recompute_requested',
      entityType: 'graph',
      entityId: jobId,
      ip: input.ip,
    });

    return {
      queued: true,
      jobId,
    };
  }
}
