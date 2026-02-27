import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { MeController } from './auth/me.controller';
import { ContactsController } from './contacts/contacts.controller';
import { EnrichmentController } from './enrichment/enrichment.controller';
import { ChatController } from './chat/chat.controller';
import { AuthService } from './auth/auth.service';
import { ContactsService } from './contacts/contacts.service';
import { AuditService } from './audit/audit.service';
import { RolesGuard } from './common/roles.guard';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    ContactsController,
    EnrichmentController,
    ChatController,
  ],
  providers: [AuthService, ContactsService, AuditService, RolesGuard],
})
export class AppModule {}
