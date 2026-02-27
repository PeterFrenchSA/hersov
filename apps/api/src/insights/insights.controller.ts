import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  insightsBackfillSchema,
  insightsDashboardQuerySchema,
  type InsightsBackfillInput,
  type InsightsDashboardQueryInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InsightsService } from './insights.service';

@Controller('insights')
@UseGuards(SessionAuthGuard)
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Post('backfill')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Analyst')
  async backfill(
    @Body(new ZodValidationPipe(insightsBackfillSchema)) filters: InsightsBackfillInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ queued: true; jobId: string; filters: InsightsBackfillInput }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.insightsService.requestBackfill({
      filters,
      actorUserId: user.id,
      ip: request?.ip,
    });
  }

  @Get('dashboard')
  async dashboard(
    @Query(new ZodValidationPipe(insightsDashboardQuerySchema)) query: InsightsDashboardQueryInput,
  ) {
    return this.insightsService.getDashboard(query.limit);
  }
}
