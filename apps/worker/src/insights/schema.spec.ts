import { contactInsightsExtractionSchema } from '@hersov/shared';

describe('contact insights schema validation', () => {
  it('accepts valid extraction payload', () => {
    const parsed = contactInsightsExtractionSchema.parse({
      meeting_context: {
        event_name: 'Monaco Summit',
        year: 2024,
        location: 'Monaco',
      },
      tags: [
        {
          category: 'sector',
          value: 'energy',
          confidence: 0.91,
          evidence_snippet: 'Discussed energy deals in Monaco.',
        },
      ],
      entities: [
        {
          type: 'company',
          name: 'Acme Ventures',
          confidence: 0.88,
        },
      ],
      relationship_clues: [
        {
          type: 'introduced_by',
          counterparty_name: 'Jane Doe',
          confidence: 0.84,
        },
      ],
      investor_signals: {
        is_investor: true,
        investor_type: 'VC',
        sectors: ['energy'],
      },
      topics: ['energy transition'],
    });

    expect(parsed.entities[0]?.name).toBe('Acme Ventures');
  });

  it('rejects payload with unknown keys and invalid confidence', () => {
    expect(() =>
      contactInsightsExtractionSchema.parse({
        tags: [
          {
            category: 'sector',
            value: 'energy',
            confidence: 1.2,
          },
        ],
        unknown_field: true,
      }),
    ).toThrow();
  });
});
