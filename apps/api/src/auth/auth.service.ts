import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { LoginInput } from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from '../common/password.util';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async login(payload: LoginInput, request: Request): Promise<{ id: string; email: string; role: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await verifyPassword(payload.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    request.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await this.auditService.log({
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ip: request.ip,
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  async logout(request: Request): Promise<void> {
    const actorUserId = request.session?.user?.id;

    if (actorUserId) {
      await this.auditService.log({
        actorUserId,
        action: 'auth.logout',
        entityType: 'user',
        entityId: actorUserId,
        ip: request.ip,
      });
    }

    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async getMe(userId: string): Promise<{ id: string; email: string; role: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException('Session is invalid');
    }

    return user;
  }
}
