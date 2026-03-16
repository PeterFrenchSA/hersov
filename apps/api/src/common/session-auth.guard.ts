import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const sessionUser = request.session?.user;

    if (!sessionUser) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      await destroySession(request);
      response.clearCookie('crm.sid');
      throw new UnauthorizedException('Session is invalid');
    }

    request.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    return true;
  }
}

async function destroySession(request: Request): Promise<void> {
  if (!request.session) {
    return;
  }

  await new Promise<void>((resolve) => {
    request.session.destroy(() => resolve());
  });
}
