import { normalizeCsvRow, normalizePhone, splitMultiValue } from './normalization';
import type { ImportColumnMappingInput } from '@hersov/shared';

describe('import normalization', () => {
  it('splits and normalizes multi-value email/phone fields', () => {
    const mapping: ImportColumnMappingInput = {
      mapping: {
        first_name: 'First Name',
        last_name: 'Last Name',
        full_name: null,
        emails: 'Emails',
        phones: 'Phones',
        company: 'Company',
        title: 'Title',
        notes_context: 'Notes',
        city: 'City',
        country: 'Country',
        linkedin: 'LinkedIn',
        website: 'Website',
        twitter: 'Twitter',
      },
      emailDelimiters: [',', ';', '|'],
      phoneDelimiters: [',', ';'],
      csvDelimiter: ',',
    };

    const normalized = normalizeCsvRow(
      {
        'First Name': ' Jane ',
        'Last Name': ' Doe ',
        Emails: 'JANE@EXAMPLE.COM; alt@example.com | third@example.com',
        Phones: ' +1 (415) 555-2671 ; 020 7946 0958 ',
        Company: '  Acme Capital ',
        Title: ' Partner ',
        Notes: ' Important contact ',
        City: ' London ',
        Country: ' UK ',
        LinkedIn: 'HTTPS://LINKEDIN.COM/IN/JANE-DOE/',
        Website: 'HTTP://example.com/',
        Twitter: 'https://twitter.com/Jane',
      },
      mapping,
    );

    expect(normalized.firstName).toBe('Jane');
    expect(normalized.lastName).toBe('Doe');
    expect(normalized.fullName).toBe('Jane Doe');
    expect(normalized.emails).toEqual(['jane@example.com', 'alt@example.com', 'third@example.com']);
    expect(normalized.phones[0]).toBe('+14155552671');
    expect(normalized.company).toBe('Acme Capital');
    expect(normalized.linkedin).toBe('https://linkedin.com/in/jane-doe');
  });

  it('supports delimiter splitting helper', () => {
    expect(splitMultiValue('a;b|c', [';', '|'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps a cleaned original phone when e164 parse fails', () => {
    expect(normalizePhone('ext 1234')).toBe('1234');
  });
});
