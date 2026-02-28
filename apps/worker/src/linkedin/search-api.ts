import { normalizeLinkedinProfileUrl } from './heuristics';

export interface LinkedinSearchCandidate {
  profileUrl: string;
  profileName: string;
  headline: string | null;
  snippet: string | null;
  location: string | null;
  currentCompany: string | null;
}

interface SearchApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SearchApiResponse {
  organic_results?: SearchApiOrganicResult[];
  results?: SearchApiOrganicResult[];
}

export async function searchLinkedinProfiles(input: {
  query: string;
  maxResults: number;
}): Promise<LinkedinSearchCandidate[]> {
  const apiKey = process.env.LINKEDIN_SEARCH_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const apiUrl = process.env.LINKEDIN_SEARCH_API_URL?.trim() || 'https://serpapi.com/search.json';
  const engine = process.env.LINKEDIN_SEARCH_API_ENGINE?.trim() || 'google';
  const timeoutMs = parsePositiveInt(process.env.LINKEDIN_SEARCH_API_TIMEOUT_MS, 15_000);
  const requestLimit = Math.max(1, Math.min(25, input.maxResults * 3));

  const url = new URL(apiUrl);
  url.searchParams.set('engine', engine);
  url.searchParams.set('q', input.query);
  url.searchParams.set('num', String(requestLimit));
  url.searchParams.set('api_key', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as SearchApiResponse;
    const rawItems = payload.organic_results ?? payload.results ?? [];
    const candidates = dedupeCandidates(
      rawItems
        .map((item) => toCandidate(item))
        .filter((item): item is LinkedinSearchCandidate => item !== null),
    );

    return candidates.slice(0, input.maxResults);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function toCandidate(item: SearchApiOrganicResult): LinkedinSearchCandidate | null {
  const rawUrl = item.link?.trim();
  const profileUrl = rawUrl ? normalizeLinkedinProfileUrl(rawUrl) : null;
  if (!profileUrl) {
    return null;
  }

  const title = (item.title ?? '').trim();
  const snippet = (item.snippet ?? '').trim();

  return {
    profileUrl,
    profileName: inferProfileName(title, profileUrl),
    headline: inferHeadline(title),
    snippet: snippet || null,
    location: inferLocation(snippet),
    currentCompany: inferCompany(title, snippet),
  };
}

function dedupeCandidates(candidates: LinkedinSearchCandidate[]): LinkedinSearchCandidate[] {
  const seen = new Set<string>();
  const unique: LinkedinSearchCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.profileUrl)) {
      continue;
    }
    seen.add(candidate.profileUrl);
    unique.push(candidate);
  }
  return unique;
}

function inferProfileName(title: string, profileUrl: string): string {
  if (title) {
    const beforeDash = title.split('-')[0]?.trim();
    if (beforeDash) {
      return beforeDash;
    }
  }

  const slug = profileUrl.split('/').pop() ?? '';
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferHeadline(title: string): string | null {
  const parts = title.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  return parts.slice(1).join(' - ');
}

function inferLocation(snippet: string): string | null {
  if (!snippet) {
    return null;
  }

  const segments = snippet.split('·').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const locationSegment = segments.find((segment) => /,|United|Kingdom|States|France|Germany|UAE|Hong Kong/i.test(segment));
  return locationSegment ?? null;
}

function inferCompany(title: string, snippet: string): string | null {
  const combined = `${title} ${snippet}`;
  const match = combined.match(/\bat\s+([A-Za-z0-9&.,\-' ]{2,80})/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

