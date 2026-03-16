import { getLinkedinSearchProviderStatus } from '@hersov/shared';
import { buildSearchQuery } from './processor';

describe('linkedin processor helpers', () => {
  it('builds a linkedin-focused search query with identity signals', () => {
    const query = buildSearchQuery({
      fullName: 'Jane Doe',
      companyName: 'Acme Capital',
      currentTitle: 'Principal',
      locationCountry: 'United Kingdom',
      emails: ['jane@acme.com'],
    });

    expect(query).toContain('site:linkedin.com/in');
    expect(query).toContain('"Jane Doe"');
    expect(query).toContain('"Acme Capital"');
    expect(query).toContain('"Principal"');
    expect(query).toContain('"United Kingdom"');
    expect(query).not.toContain('"jane@acme.com"');
    expect(query).not.toContain('"acme.com"');
  });

  it('falls back to email domain when company is missing', () => {
    const query = buildSearchQuery({
      fullName: 'Jane Doe',
      companyName: null,
      currentTitle: null,
      locationCountry: null,
      emails: ['jane@acme.com'],
    });

    expect(query).toContain('"acme.com"');
  });

  it('resolves brave provider config when requested', () => {
    const status = getLinkedinSearchProviderStatus({
      LINKEDIN_SEARCH_PROVIDER: 'brave',
      LINKEDIN_SEARCH_API_KEY: 'test-key',
    });

    expect(status.provider).toBe('brave');
    expect(status.name).toBe('brave_search');
    expect(status.configured).toBe(true);
    expect(status.apiUrl).toBe('https://api.search.brave.com/res/v1/web/search');
  });

  it('requires cx for google custom search', () => {
    const status = getLinkedinSearchProviderStatus({
      LINKEDIN_SEARCH_PROVIDER: 'google_custom_search',
      LINKEDIN_SEARCH_API_KEY: 'test-key',
    });

    expect(status.provider).toBe('google_custom_search');
    expect(status.configured).toBe(false);
  });
});
