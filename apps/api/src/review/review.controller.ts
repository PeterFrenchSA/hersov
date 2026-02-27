import {
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
  reviewIdParamSchema,
  reviewQueueQuerySchema,
  type ReviewIdParamInput,
  type ReviewQueueQueryInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReviewService } from './review.service';

@Controller('review')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('Admin', 'Analyst')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(reviewQueueQuerySchema)) query: ReviewQueueQueryInput) {
    return this.reviewService.list(query);
  }

  @Post(':id/approve')
  async approve(
    @Param(new ZodValidationPipe(reviewIdParamSchema)) params: ReviewIdParamInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ id: string; status: 'approved' | 'rejected'; kind: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.reviewService.approve({
      reviewId: params.id,
      actorUserId: user.id,
      ip: request?.ip,
    });
  }

  @Post(':id/reject')
  async reject(
    @Param(new ZodValidationPipe(reviewIdParamSchema)) params: ReviewIdParamInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ id: string; status: 'approved' | 'rejected'; kind: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.reviewService.reject({
      reviewId: params.id,
      actorUserId: user.id,
      ip: request?.ip,
    });
  }
}
