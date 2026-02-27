import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface AuditInput {
  actorUserId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metaJson?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metaJson: input.metaJson,
          ip: input.ip,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to write audit log: ${(error as Error).message}`);
    }
  }
}
