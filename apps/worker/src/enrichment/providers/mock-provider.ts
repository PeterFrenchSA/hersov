import type {
  EnrichmentProvider,
  EnrichmentProviderInput,
  EnrichmentProviderOutput,
} from '@hersov/shared';

const COUNTRY_BY_TLD: Record<string, string> = {
  uk: 'United Kingdom',
  gb: 'United Kingdom',
  fr: 'France',
  de: 'Germany',
  es: 'Spain',
  it: 'Italy',
  nl: 'Netherlands',
  ch: 'Switzerland',
  ae: 'United Arab Emirates',
  sa: 'Saudi Arabia',
  us: 'United States',
  ca: 'Canada',
  com: 'United States',
  org: 'United States',
  io: 'United Kingdom',
};

export class MockProvider implements EnrichmentProvider {
  readonly name = 'mock' as const;
  readonly supportsFields = ['location_country', 'website', 'linkedin', 'current_title', 'tags'];
  readonly rateLimit: { rpm: number; concurrency: number };

  constructor(rateLimit: { rpm: number; concurrency: number }) {
    this.rateLimit = rateLimit;
  }

  isConfigured(): boolean {
    return true;
  }

  async enrichContact(input: EnrichmentProviderInput): Promise<EnrichmentProviderOutput> {
    const methodsByType = new Map<string, string[]>();

    for (const method of input.contact.methods) {
      const existing = methodsByType.get(method.type) ?? [];
      existing.push(method.value);
      methodsByType.set(method.type, existing);
    }

    const primaryEmailDomain = extractPrimaryEmailDomain(input);
    const candidateDomain =
      input.contact.companyDomain ??
      primaryEmailDomain ??
      extractDomainFromUrl(methodsByType.get('website')?.[0] ?? null);

    const output: EnrichmentProviderOutput = {
      fields: [],
      methods: [],
      tags: [],
    };

    if (!input.contact.locationCountry && candidateDomain) {
      const tld = candidateDomain.split('.').pop()?.toLowerCase() ?? '';
      const country = COUNTRY_BY_TLD[tld];

      if (country) {
        output.fields.push({
          field: 'location_country',
          value: country,
          confidence: 0.74,
        });

        output.tags.push({
          name: country,
          category: 'country',
          confidence: 0.65,
        });
      }
    }

    if (!hasMethod(methodsByType, 'website') && candidateDomain) {
      output.methods.push({
        type: 'website',
        value: `https://${candidateDomain}`,
        confidence: 0.68,
        isPrimary: true,
      });
    }

    if (!hasMethod(methodsByType, 'linkedin') && input.contact.companyName) {
      const slug = slugify(input.contact.companyName);
      if (slug) {
        output.methods.push({
          type: 'linkedin',
          value: `https://linkedin.com/company/${slug}`,
          confidence: 0.58,
        });
      }
    }

    if (!input.contact.currentTitle) {
      output.fields.push({
        field: 'current_title',
        value: inferTitleFromDomain(candidateDomain),
        confidence: 0.52,
      });
    }

    return output;
  }
}

function extractPrimaryEmailDomain(input: EnrichmentProviderInput): string | null {
  const primaryEmail = input.contact.methods.find((method) => method.type === 'email' && method.isPrimary);
  const fallbackEmail = input.contact.methods.find((method) => method.type === 'email');
  const value = (primaryEmail ?? fallbackEmail)?.value;

  if (!value || !value.includes('@')) {
    return null;
  }

  return value.split('@')[1]?.toLowerCase() ?? null;
}

function extractDomainFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const normalized = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferTitleFromDomain(domain: string | null): string {
  if (!domain) {
    return 'Analyst';
  }

  if (domain.includes('capital') || domain.includes('ventures') || domain.includes('invest')) {
    return 'Investment Professional';
  }

  if (domain.includes('partners')) {
    return 'Partner';
  }

  return 'Analyst';
}

function hasMethod(methodsByType: Map<string, string[]>, type: string): boolean {
  const values = methodsByType.get(type);
  return Boolean(values && values.length > 0);
}
