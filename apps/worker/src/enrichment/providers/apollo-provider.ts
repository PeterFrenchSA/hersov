import type {
  EnrichmentProvider,
  EnrichmentProviderInput,
  EnrichmentProviderOutput,
} from '@hersov/shared';

interface ApolloProviderOptions {
  apiKey: string | null;
  rateLimit: {
    rpm: number;
    concurrency: number;
  };
}

export class ApolloProvider implements EnrichmentProvider {
  readonly name = 'apollo' as const;
  readonly supportsFields = ['location_country', 'current_title', 'method:email', 'method:phone', 'linkedin'];
  readonly rateLimit: { rpm: number; concurrency: number };
  private readonly apiKey: string | null;

  constructor(options: ApolloProviderOptions) {
    this.apiKey = options.apiKey;
    this.rateLimit = options.rateLimit;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async enrichContact(input: EnrichmentProviderInput): Promise<EnrichmentProviderOutput> {
    if (!this.apiKey) {
      return {
        fields: [],
        methods: [],
        tags: [],
      };
    }

    const primaryEmail = input.contact.methods.find((method) => method.type === 'email' && method.isPrimary)
      ?? input.contact.methods.find((method) => method.type === 'email');
    const linkedin = input.contact.methods.find((method) => method.type === 'linkedin');

    if (!primaryEmail && !linkedin && !input.contact.fullName) {
      return {
        fields: [],
        methods: [],
        tags: [],
      };
    }

    try {
      const response = await fetch('https://api.apollo.io/v1/people/match', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          email: primaryEmail?.value,
          linkedin_url: linkedin?.value,
          name: input.contact.fullName,
          organization_name: input.contact.companyName,
        }),
      });

      if (!response.ok) {
        return {
          fields: [],
          methods: [],
          tags: [],
        };
      }

      const data = (await response.json()) as {
        person?: {
          title?: string;
          country?: string;
          linkedin_url?: string;
          email?: string;
          organization?: { website_url?: string };
        };
      };

      const person = data.person;
      if (!person) {
        return {
          fields: [],
          methods: [],
          tags: [],
        };
      }

      const output: EnrichmentProviderOutput = {
        fields: [],
        methods: [],
        tags: [],
      };

      if (person.country) {
        output.fields.push({
          field: 'location_country',
          value: person.country,
          confidence: 0.73,
        });
      }

      if (person.title) {
        output.fields.push({
          field: 'current_title',
          value: person.title,
          confidence: 0.75,
        });
      }

      if (person.linkedin_url) {
        output.methods.push({
          type: 'linkedin',
          value: person.linkedin_url,
          confidence: 0.78,
        });
      }

      if (person.email) {
        output.methods.push({
          type: 'email',
          value: person.email,
          confidence: 0.72,
        });
      }

      if (person.organization?.website_url) {
        output.methods.push({
          type: 'website',
          value: person.organization.website_url,
          confidence: 0.68,
          isPrimary: true,
        });
      }

      return output;
    } catch {
      return {
        fields: [],
        methods: [],
        tags: [],
      };
    }
  }
}
