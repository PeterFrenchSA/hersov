import { Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { GraphService } from './graph.service';

@Controller('graph')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('Admin')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Post('recompute')
  async recompute(
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ queued: true; jobId: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.graphService.requestRecompute({
      actorUserId: user.id,
      ip: request?.ip,
    });
  }
}
