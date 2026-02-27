import {
  enrichmentProviderCatalog,
  type EnrichmentProvider,
  type EnrichmentProviderName,
  type EnrichmentProviderStatus,
} from '@hersov/shared';
import { ApolloProvider } from './apollo-provider';
import { MockProvider } from './mock-provider';

export interface EnrichmentProviderRegistry {
  statuses: EnrichmentProviderStatus[];
  enabledProviders: Map<EnrichmentProviderName, EnrichmentProvider>;
}

export function createEnrichmentProviderRegistry(): EnrichmentProviderRegistry {
  const statuses: EnrichmentProviderStatus[] = [];
  const enabledProviders = new Map<EnrichmentProviderName, EnrichmentProvider>();

  for (const providerName of Object.keys(enrichmentProviderCatalog) as EnrichmentProviderName[]) {
    const metadata = enrichmentProviderCatalog[providerName];
    const envVar = metadata.envVar;
    const configured = envVar ? Boolean(process.env[envVar]?.trim()) : true;
    const enabled = providerName === 'mock' ? true : configured;

    const providerUpper = providerName.toUpperCase();
    const rateLimit = {
      rpm: parsePositiveInt(process.env[`ENRICHMENT_PROVIDER_${providerUpper}_RPM`], metadata.defaultRpm),
      concurrency: parsePositiveInt(
        process.env[`ENRICHMENT_PROVIDER_${providerUpper}_CONCURRENCY`],
        metadata.defaultConcurrency,
      ),
    };

    statuses.push({
      name: providerName,
      label: metadata.label,
      configured,
      enabled,
      envVar,
      supportsFields: metadata.supportsFields,
      rateLimit,
    });

    if (providerName === 'mock') {
      enabledProviders.set(providerName, new MockProvider(rateLimit));
      continue;
    }

    if (providerName === 'apollo') {
      const provider = new ApolloProvider({
        apiKey: process.env.APOLLO_API_KEY?.trim() || null,
        rateLimit,
      });

      if (provider.isConfigured()) {
        enabledProviders.set(providerName, provider);
      }
    }
  }

  return {
    statuses,
    enabledProviders,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}
