import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginSchema, type LoginInput } from '@hersov/shared';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionAuthGuard } from '../common/session-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
  ): Promise<{ user: { id: string; email: string; role: string } }> {
    const user = await this.authService.login(body, request);
    return { user };
  }

  @Post('logout')
  @UseGuards(SessionAuthGuard)
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ ok: true }> {
    await this.authService.logout(request);
    response.clearCookie('crm.sid');
    return { ok: true };
  }
}
