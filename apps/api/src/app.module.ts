import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { MeController } from './auth/me.controller';
import { ContactsController } from './contacts/contacts.controller';
import { EnrichmentController } from './enrichment/enrichment.controller';
import { ChatController } from './chat/chat.controller';
import { ImportController } from './import/import.controller';
import { AdminController } from './admin/admin.controller';
import { AuthService } from './auth/auth.service';
import { ContactsService } from './contacts/contacts.service';
import { AuditService } from './audit/audit.service';
import { RolesGuard } from './common/roles.guard';
import { ImportService } from './import/import.service';
import { ImportQueueService } from './import/import-queue.service';
import { EnrichmentService } from './enrichment/enrichment.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    ContactsController,
    EnrichmentController,
    ChatController,
    ImportController,
    AdminController,
  ],
  providers: [
    AuthService,
    ContactsService,
    AuditService,
    RolesGuard,
    ImportService,
    ImportQueueService,
    EnrichmentService,
  ],
})
export class AppModule {}
