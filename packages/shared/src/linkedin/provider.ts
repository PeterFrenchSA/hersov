import { z } from 'zod';

export const linkedinSearchProviderSchema = z.enum(['serpapi', 'brave', 'google_custom_search']);
export type LinkedinSearchProvider = z.infer<typeof linkedinSearchProviderSchema>;

export const defaultLinkedinSearchProvider: LinkedinSearchProvider = 'serpapi';

export type LinkedinSearchProviderStatus = {
  provider: LinkedinSearchProvider;
  name: string;
  label: string;
  configured: boolean;
  envVars: string[];
  apiUrl: string;
};

export function resolveLinkedinSearchProvider(value?: string | null): LinkedinSearchProvider {
  const parsed = linkedinSearchProviderSchema.safeParse(value?.trim());
  if (!parsed.success) {
    return defaultLinkedinSearchProvider;
  }
  return parsed.data;
}

export function getLinkedinSearchProviderStatus(
  env: Record<string, string | undefined> = process.env,
): LinkedinSearchProviderStatus {
  const provider = resolveLinkedinSearchProvider(env.LINKEDIN_SEARCH_PROVIDER);

  if (provider === 'brave') {
    return {
      provider,
      name: 'brave_search',
      label: 'Brave Search API',
      configured: Boolean(env.LINKEDIN_SEARCH_API_KEY?.trim()),
      envVars: ['LINKEDIN_SEARCH_PROVIDER', 'LINKEDIN_SEARCH_API_KEY'],
      apiUrl: env.LINKEDIN_SEARCH_API_URL?.trim() || 'https://api.search.brave.com/res/v1/web/search',
    };
  }

  if (provider === 'google_custom_search') {
    return {
      provider,
      name: 'google_custom_search',
      label: 'Google Custom Search JSON API',
      configured: Boolean(env.LINKEDIN_SEARCH_API_KEY?.trim() && env.LINKEDIN_GOOGLE_CSE_ID?.trim()),
      envVars: ['LINKEDIN_SEARCH_PROVIDER', 'LINKEDIN_SEARCH_API_KEY', 'LINKEDIN_GOOGLE_CSE_ID'],
      apiUrl: env.LINKEDIN_SEARCH_API_URL?.trim() || 'https://www.googleapis.com/customsearch/v1',
    };
  }

  return {
    provider,
    name: 'serpapi',
    label: 'SerpApi',
    configured: Boolean(env.LINKEDIN_SEARCH_API_KEY?.trim()),
    envVars: ['LINKEDIN_SEARCH_PROVIDER', 'LINKEDIN_SEARCH_API_KEY'],
    apiUrl: env.LINKEDIN_SEARCH_API_URL?.trim() || 'https://serpapi.com/search.json',
  };
}
