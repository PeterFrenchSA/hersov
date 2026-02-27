import { buildContactEmbeddingText, hashEmbeddingText } from './text-builder';

describe('embedding text builder', () => {
  it('builds deterministic text and hash for same input', () => {
    const input = {
      fullName: 'Jane Doe',
      currentTitle: 'Partner',
      companyName: 'Acme Capital',
      locationCity: 'London',
      locationCountry: 'United Kingdom',
      notesRaw: 'Met at conference.',
      tags: ['Investor', 'UK', 'Investor'],
    };

    const firstText = buildContactEmbeddingText(input);
    const secondText = buildContactEmbeddingText(input);

    expect(firstText).toBe(secondText);
    expect(hashEmbeddingText(firstText)).toBe(hashEmbeddingText(secondText));
  });

  it('changes hash when source text changes', () => {
    const base = buildContactEmbeddingText({
      fullName: 'Jane Doe',
      currentTitle: null,
      companyName: null,
      locationCity: null,
      locationCountry: null,
      notesRaw: 'Initial note',
      tags: [],
    });

    const changed = buildContactEmbeddingText({
      fullName: 'Jane Doe',
      currentTitle: null,
      companyName: null,
      locationCity: null,
      locationCountry: null,
      notesRaw: 'Initial note + updated',
      tags: [],
    });

    expect(hashEmbeddingText(base)).not.toBe(hashEmbeddingText(changed));
  });
});
