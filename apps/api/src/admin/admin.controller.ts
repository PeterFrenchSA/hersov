import { Controller, Get, UseGuards } from '@nestjs/common';
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
      linkedinSearch: {
        name: 'linkedin_search_api',
        label: 'LinkedIn Search API',
        configured: Boolean(process.env.LINKEDIN_SEARCH_API_KEY?.trim()),
        envVar: 'LINKEDIN_SEARCH_API_KEY',
      },
    };
  }
}
