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
import { EmbeddingsController } from './embeddings/embeddings.controller';
import { SearchController } from './search/search.controller';
import { InsightsController } from './insights/insights.controller';
import { ReviewController } from './review/review.controller';
import { GraphController } from './graph/graph.controller';
import { LinkedinController } from './linkedin/linkedin.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { AuthService } from './auth/auth.service';
import { ContactsService } from './contacts/contacts.service';
import { AuditService } from './audit/audit.service';
import { RolesGuard } from './common/roles.guard';
import { ImportService } from './import/import.service';
import { ImportQueueService } from './import/import-queue.service';
import { EnrichmentService } from './enrichment/enrichment.service';
import { EmbeddingsService } from './embeddings/embeddings.service';
import { SemanticSearchService } from './search/semantic-search.service';
import { OpenAiService } from './ai/openai.service';
import { ChatService } from './chat/chat.service';
import { ChatToolsService } from './chat/chat-tools.service';
import { InsightsService } from './insights/insights.service';
import { ReviewService } from './review/review.service';
import { GraphService } from './graph/graph.service';
import { LinkedinService } from './linkedin/linkedin.service';
import { DashboardService } from './dashboard/dashboard.service';

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
    EmbeddingsController,
    SearchController,
    InsightsController,
    ReviewController,
    GraphController,
    LinkedinController,
    DashboardController,
  ],
  providers: [
    AuthService,
    ContactsService,
    AuditService,
    RolesGuard,
    ImportService,
    ImportQueueService,
    EnrichmentService,
    EmbeddingsService,
    SemanticSearchService,
    OpenAiService,
    ChatService,
    ChatToolsService,
    InsightsService,
    ReviewService,
    GraphService,
    LinkedinService,
    DashboardService,
  ],
})
export class AppModule {}
