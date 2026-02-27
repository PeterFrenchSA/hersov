import { Controller, Get, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { AuthService } from './auth.service';

@Controller('me')
@UseGuards(SessionAuthGuard)
export class MeController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  async me(
    @CurrentUser() currentUser?: { id: string },
  ): Promise<{ user: { id: string; email: string; role: string } }> {
    if (!currentUser?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.authService.getMe(currentUser.id);
    return { user };
  }
}
