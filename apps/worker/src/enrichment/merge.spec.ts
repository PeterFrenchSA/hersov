import { planContactMethodChanges, shouldApplyFieldUpdate } from './merge';

describe('enrichment merge rules', () => {
  it('fills missing values under fill_missing_only', () => {
    expect(
      shouldApplyFieldUpdate({
        policy: 'fill_missing_only',
        existingValue: null,
        incomingValue: 'United Kingdom',
        existingConfidence: 0,
        incomingConfidence: 0.7,
        threshold: 0.1,
      }),
    ).toBe(true);
  });

  it('does not overwrite non-empty values under fill_missing_only', () => {
    expect(
      shouldApplyFieldUpdate({
        policy: 'fill_missing_only',
        existingValue: 'United States',
        incomingValue: 'United Kingdom',
        existingConfidence: 0.4,
        incomingConfidence: 0.9,
        threshold: 0.1,
      }),
    ).toBe(false);
  });

  it('overwrites only when confidence clears threshold under overwrite_if_higher_confidence', () => {
    expect(
      shouldApplyFieldUpdate({
        policy: 'overwrite_if_higher_confidence',
        existingValue: 'Analyst',
        incomingValue: 'Partner',
        existingConfidence: 0.7,
        incomingConfidence: 0.76,
        threshold: 0.1,
      }),
    ).toBe(false);

    expect(
      shouldApplyFieldUpdate({
        policy: 'overwrite_if_higher_confidence',
        existingValue: 'Analyst',
        incomingValue: 'Partner',
        existingConfidence: 0.7,
        incomingConfidence: 0.85,
        threshold: 0.1,
      }),
    ).toBe(true);
  });

  it('deduplicates contact methods and promotes primary candidate', () => {
    const plan = planContactMethodChanges({
      existingMethods: [
        {
          id: 'method-email',
          type: 'email',
          value: 'jane@example.com',
          isPrimary: true,
          verifiedAt: null,
        },
      ],
      candidates: [
        {
          type: 'email',
          value: 'Jane@Example.com',
          confidence: 0.9,
          provider: 'mock',
          verifiedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          type: 'website',
          value: 'https://acme.example/',
          confidence: 0.7,
          provider: 'mock',
          isPrimary: true,
        },
      ],
    });

    expect(plan.createMethods).toHaveLength(1);
    expect(plan.createMethods[0]).toMatchObject({
      type: 'website',
      value: 'https://acme.example',
      isPrimary: true,
    });

    expect(plan.verifyExistingMethodIds).toEqual([
      {
        methodId: 'method-email',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(plan.setPrimary).toEqual([
      expect.objectContaining({
        type: 'website',
        value: 'https://acme.example',
      }),
    ]);
  });
});
