import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/session-auth.guard';

@Controller('enrichment/runs')
@UseGuards(SessionAuthGuard)
export class EnrichmentController {
  @Post()
  @HttpCode(501)
  createRun(): { message: string } {
    return {
      message: 'Enrichment is deferred to a later PR.',
    };
  }

  @Get()
  @HttpCode(501)
  listRuns(): { message: string } {
    return {
      message: 'Enrichment is deferred to a later PR.',
    };
  }

  @Get(':id')
  @HttpCode(501)
  getRun(@Param('id') id: string): { message: string; id: string } {
    return {
      message: 'Enrichment is deferred to a later PR.',
      id,
    };
  }
}
