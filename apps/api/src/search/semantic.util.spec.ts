import { buildSemanticSearchQuery, distanceToScore } from './semantic.util';

describe('semantic search utils', () => {
  it('builds SQL with optional filters and limit cap', () => {
    const built = buildSemanticSearchQuery({
      vectorLiteral: '[0.1,0.2]',
      k: 999,
      filters: {
        country: 'United Kingdom',
        tag: 'investor',
        importedBatchId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(built.params[1]).toBe(50);
    expect(built.sql).toContain("e.kind = 'profile'");
    expect(built.sql).toContain('location_country ILIKE');
    expect(built.sql).toContain('source_import_batch_id');
    expect(built.sql).toContain('contact_tags');
    expect(built.params).toContain('United Kingdom');
    expect(built.params).toContain('investor');
  });

  it('maps vector distance to bounded score', () => {
    expect(distanceToScore(0)).toBe(1);
    expect(distanceToScore(0.25)).toBe(0.75);
    expect(distanceToScore(2)).toBe(0);
    expect(distanceToScore(Number.NaN)).toBe(0);
  });
});
