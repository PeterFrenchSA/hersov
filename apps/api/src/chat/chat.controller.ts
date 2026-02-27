import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/session-auth.guard';

@Controller('chat')
@UseGuards(SessionAuthGuard)
export class ChatController {
  @Post()
  @HttpCode(501)
  createChatResponse(): { message: string } {
    return {
      message: 'Chat endpoint is stubbed for PR #1 and will be implemented in a later PR.',
    };
  }
}
