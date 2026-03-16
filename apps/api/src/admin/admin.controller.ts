import { Controller, Get, UseGuards } from '@nestjs/common';
import { getLinkedinSearchProviderStatus } from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { EnrichmentService } from '../enrichment/enrichment.service';

@Controller('admin')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('Admin')
export class AdminController {
  constructor(private readonly enrichmentService: EnrichmentService) {}

  @Get('provider-status')
  getProviderStatus() {
    return {
      data: this.enrichmentService.getProviderStatuses(),
      linkedinSearch: getLinkedinSearchProviderStatus(),
    };
  }
}
