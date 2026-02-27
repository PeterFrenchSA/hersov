import { MockProvider } from './mock-provider';

describe('MockProvider', () => {
  it('returns deterministic structured output for same input', async () => {
    const provider = new MockProvider({ rpm: 600, concurrency: 4 });

    const input = {
      contact: {
        id: 'contact-1',
        firstName: 'Jane',
        lastName: 'Doe',
        fullName: 'Jane Doe',
        notesRaw: null,
        locationCity: null,
        locationCountry: null,
        currentTitle: null,
        companyName: 'Acme Partners',
        companyDomain: 'acme.co.uk',
        methods: [
          {
            type: 'email' as const,
            value: 'jane@acme.co.uk',
            isPrimary: true,
            verifiedAt: null,
          },
        ],
      },
    };

    const first = await provider.enrichContact(input);
    const second = await provider.enrichContact(input);

    expect(first).toEqual(second);
    expect(first.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'location_country',
          value: 'United Kingdom',
        }),
        expect.objectContaining({
          field: 'current_title',
        }),
      ]),
    );
    expect(first.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'website',
          value: 'https://acme.co.uk',
        }),
      ]),
    );
  });
});
