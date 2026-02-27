import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createEnrichmentRunSchema,
  enrichmentRunIdParamSchema,
  enrichmentRunResultsQuerySchema,
  enrichmentRunsQuerySchema,
  type CreateEnrichmentRunInput,
  type EnrichmentRunIdParamInput,
  type EnrichmentRunResultsQueryInput,
  type EnrichmentRunsQueryInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EnrichmentService } from './enrichment.service';

@Controller('enrichment/runs')
@UseGuards(SessionAuthGuard)
export class EnrichmentController {
  constructor(private readonly enrichmentService: EnrichmentService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Analyst')
  async createRun(
    @Body(new ZodValidationPipe(createEnrichmentRunSchema)) body: CreateEnrichmentRunInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ id: string; status: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.enrichmentService.createRun(body, user.id, request?.ip);
  }

  @Get()
  async listRuns(
    @Query(new ZodValidationPipe(enrichmentRunsQuerySchema)) query: EnrichmentRunsQueryInput,
  ) {
    return this.enrichmentService.listRuns(query);
  }

  @Get('providers')
  async getProviders() {
    return {
      data: this.enrichmentService.getProviderStatuses(),
    };
  }

  @Get(':id')
  async getRun(
    @Param(new ZodValidationPipe(enrichmentRunIdParamSchema)) params: EnrichmentRunIdParamInput,
  ) {
    return this.enrichmentService.getRun(params);
  }

  @Get(':id/results')
  async getRunResults(
    @Param(new ZodValidationPipe(enrichmentRunIdParamSchema)) params: EnrichmentRunIdParamInput,
    @Query(new ZodValidationPipe(enrichmentRunResultsQuerySchema)) query: EnrichmentRunResultsQueryInput,
  ) {
    return this.enrichmentService.getRunResults(params, query);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Analyst')
  async cancelRun(
    @Param(new ZodValidationPipe(enrichmentRunIdParamSchema)) params: EnrichmentRunIdParamInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ id: string; status: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.enrichmentService.cancelRun(params, user.id, request?.ip);
  }
}
