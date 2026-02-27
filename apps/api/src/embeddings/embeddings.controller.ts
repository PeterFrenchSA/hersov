import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  embeddingsBackfillSchema,
  type EmbeddingsBackfillInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EmbeddingsService } from './embeddings.service';

@Controller('embeddings')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('Admin', 'Analyst')
export class EmbeddingsController {
  constructor(private readonly embeddingsService: EmbeddingsService) {}

  @Post('backfill')
  async backfill(
    @Body(new ZodValidationPipe(embeddingsBackfillSchema)) filters: EmbeddingsBackfillInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ queued: true; jobId: string; filters: EmbeddingsBackfillInput }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.embeddingsService.requestBackfill({
      filters,
      actorUserId: user.id,
      ip: request?.ip,
    });
  }

  @Get('status')
  async status(): Promise<{
    totalContacts: number;
    embeddedContacts: number;
    missingContacts: number;
    staleContacts: number;
    staleAfterDays: number;
    lastRunAt: string | null;
  }> {
    return this.embeddingsService.getStatus();
  }
}
