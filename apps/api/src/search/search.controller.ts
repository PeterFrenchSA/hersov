import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  semanticSearchQuerySchema,
  type SemanticSearchQueryInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SemanticSearchService } from './semantic-search.service';

@Controller('search')
@UseGuards(SessionAuthGuard)
export class SearchController {
  constructor(private readonly semanticSearchService: SemanticSearchService) {}

  @Get('semantic')
  async semanticSearch(
    @Query(new ZodValidationPipe(semanticSearchQuerySchema)) query: SemanticSearchQueryInput,
  ): Promise<{
    data: Array<{
      id: string;
      name: string;
      title: string | null;
      company: string | null;
      country: string | null;
      previewSnippet: string | null;
      score: number;
    }>;
  }> {
    const data = await this.semanticSearchService.semanticSearch({
      query: query.q,
      k: query.k,
    });

    return { data };
  }
}
