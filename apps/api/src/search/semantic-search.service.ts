import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiService } from '../ai/openai.service';
import {
  buildSemanticSearchQuery,
  distanceToScore,
  type RawSemanticSearchRow,
  type SemanticSearchFilters,
} from './semantic.util';

@Injectable()
export class SemanticSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAiService: OpenAiService,
  ) {}

  async semanticSearch(input: {
    query: string;
    k: number;
    filters?: SemanticSearchFilters;
  }): Promise<Array<{
    id: string;
    name: string;
    title: string | null;
    company: string | null;
    country: string | null;
    previewSnippet: string | null;
    score: number;
  }>> {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const { vector } = await this.openAiService.createEmbedding(normalizedQuery);
    const vectorLiteral = `[${vector.join(',')}]`;

    const { sql, params } = buildSemanticSearchQuery({
      vectorLiteral,
      k: input.k,
      filters: input.filters,
    });

    const rows = await this.prisma.$queryRawUnsafe<RawSemanticSearchRow[]>(sql, ...params);

    return rows.map((row) => {
      const distance = Number(row.distance);
      return {
        id: row.contact_id,
        name: row.full_name,
        title: row.current_title,
        company: row.company_name,
        country: row.location_country,
        previewSnippet: row.preview_snippet,
        score: distanceToScore(distance),
      };
    });
  }
}
