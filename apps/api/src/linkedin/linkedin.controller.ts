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
  idParamSchema,
  linkedinMatchBackfillSchema,
  linkedinMatchContactRequestSchema,
  linkedinSuggestionsQuerySchema,
  type IdParamInput,
  type LinkedinMatchBackfillInput,
  type LinkedinMatchContactRequestInput,
  type LinkedinSuggestionsQueryInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LinkedinService } from './linkedin.service';

@Controller('linkedin/match')
@UseGuards(SessionAuthGuard)
export class LinkedinController {
  constructor(private readonly linkedinService: LinkedinService) {}

  @Post('contact/:id')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Analyst')
  async enqueueContactMatch(
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParamInput,
    @Body(new ZodValidationPipe(linkedinMatchContactRequestSchema)) body: LinkedinMatchContactRequestInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ queued: true; jobId: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.linkedinService.requestContactMatch({
      contactId: params.id,
      actorUserId: user.id,
      ip: request?.ip,
      force: body.force,
      maxResults: body.maxResults,
    });
  }

  @Post('backfill')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Analyst')
  async enqueueBackfill(
    @Body(new ZodValidationPipe(linkedinMatchBackfillSchema)) body: LinkedinMatchBackfillInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ queued: true; jobId: string; filters: LinkedinMatchBackfillInput }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.linkedinService.requestBackfill({
      filters: body,
      actorUserId: user.id,
      ip: request?.ip,
    });
  }

  @Get('suggestions')
  async listSuggestions(
    @Query(new ZodValidationPipe(linkedinSuggestionsQuerySchema)) query: LinkedinSuggestionsQueryInput,
  ) {
    return this.linkedinService.listSuggestions(query);
  }
}
