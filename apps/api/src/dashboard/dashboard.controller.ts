import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(SessionAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async getSummary() {
    return this.dashboardService.getSummary();
  }
}
