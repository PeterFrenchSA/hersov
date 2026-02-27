import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  chatRequestSchema,
  chatThreadIdParamSchema,
  chatThreadsQuerySchema,
  type ChatRequestInput,
  type ChatThreadIdParamInput,
  type ChatThreadsQueryInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(SessionAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('threads')
  async listThreads(
    @Query(new ZodValidationPipe(chatThreadsQuerySchema)) query: ChatThreadsQueryInput,
    @CurrentUser() user?: { id: string },
  ) {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.chatService.listThreads(user.id, query);
  }

  @Get('threads/:id')
  async getThread(
    @Param(new ZodValidationPipe(chatThreadIdParamSchema)) params: ChatThreadIdParamInput,
    @CurrentUser() user?: { id: string },
  ) {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.chatService.getThreadMessages(user.id, params.id);
  }

  @Post()
  async streamChat(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequestInput,
    @CurrentUser() user?: { id: string; role: 'Admin' | 'Analyst' | 'ReadOnly' },
    @Req() request?: Request,
    @Res() response?: Response,
  ): Promise<void> {
    if (!user?.id || !response) {
      throw new UnauthorizedException('Authentication required');
    }

    await this.chatService.streamChat(
      {
        payload: body,
        actor: {
          id: user.id,
          role: user.role,
        },
        ip: request?.ip,
      },
      response,
    );
  }
}
