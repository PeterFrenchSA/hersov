export interface LinkedinContactForScoring {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  currentTitle?: string | null;
  locationCity?: string | null;
  locationCountry?: string | null;
}

export interface LinkedinCandidateForScoring {
  profileUrl: string;
  profileName: string;
  headline?: string | null;
  snippet?: string | null;
  location?: string | null;
  currentCompany?: string | null;
}

export interface LinkedinCandidateScore {
  score: number;
  evidenceSnippet: string;
  signals: {
    nameSimilarity: number;
    companySimilarity: number;
    titleSimilarity: number;
    locationMatched: boolean;
    slugMatched: boolean;
  };
}

const STOPWORDS = new Set([
  'and',
  'or',
  'the',
  'at',
  'of',
  'for',
  'to',
  'in',
  'with',
  'on',
]);

export function scoreLinkedinCandidate(
  contact: LinkedinContactForScoring,
  candidate: LinkedinCandidateForScoring,
): LinkedinCandidateScore {
  const nameSimilarity = similarity(contact.fullName, candidate.profileName);
  const companySimilarity = similarity(contact.companyName ?? '', `${candidate.currentCompany ?? ''} ${candidate.headline ?? ''} ${candidate.snippet ?? ''}`);
  const titleSimilarity = similarity(contact.currentTitle ?? '', `${candidate.headline ?? ''} ${candidate.snippet ?? ''}`);
  const slugMatched = doesUrlSlugMatchName(candidate.profileUrl, contact.firstName, contact.lastName);
  const locationMatched = doesLocationMatch(
    `${contact.locationCity ?? ''} ${contact.locationCountry ?? ''}`,
    `${candidate.location ?? ''} ${candidate.headline ?? ''} ${candidate.snippet ?? ''}`,
  );

  let score = 0.05;
  const evidenceParts: string[] = [];

  if (isLinkedinPersonUrl(candidate.profileUrl)) {
    score += 0.15;
    evidenceParts.push('linkedin_profile_url');
  }

  if (nameSimilarity >= 0.8) {
    score += 0.45;
    evidenceParts.push('name_high');
  } else if (nameSimilarity >= 0.6) {
    score += 0.35;
    evidenceParts.push('name_medium');
  } else if (nameSimilarity >= 0.4) {
    score += 0.2;
    evidenceParts.push('name_low');
  }

  if (companySimilarity >= 0.8) {
    score += 0.25;
    evidenceParts.push('company_high');
  } else if (companySimilarity >= 0.5) {
    score += 0.16;
    evidenceParts.push('company_medium');
  } else if (companySimilarity >= 0.25) {
    score += 0.08;
    evidenceParts.push('company_low');
  }

  if (titleSimilarity >= 0.75) {
    score += 0.1;
    evidenceParts.push('title_high');
  } else if (titleSimilarity >= 0.45) {
    score += 0.06;
    evidenceParts.push('title_medium');
  }

  if (locationMatched) {
    score += 0.08;
    evidenceParts.push('location');
  }

  if (slugMatched) {
    score += 0.08;
    evidenceParts.push('slug');
  }

  return {
    score: clamp(score, 0, 0.99),
    evidenceSnippet: evidenceParts.join(', '),
    signals: {
      nameSimilarity: roundTo3(nameSimilarity),
      companySimilarity: roundTo3(companySimilarity),
      titleSimilarity: roundTo3(titleSimilarity),
      locationMatched,
      slugMatched,
    },
  };
}

export function normalizeLinkedinProfileUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('linkedin.com')) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname.startsWith('/in/') && !pathname.startsWith('/pub/')) {
      return null;
    }

    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = pathname;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isLinkedinPersonUrl(url: string): boolean {
  return normalizeLinkedinProfileUrl(url) !== null;
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function doesLocationMatch(left: string, right: string): boolean {
  const leftTokens = tokenize(left);
  if (leftTokens.length === 0) {
    return false;
  }

  const rightTokens = new Set(tokenize(right));
  return leftTokens.some((token) => rightTokens.has(token));
}

function doesUrlSlugMatchName(
  url: string,
  firstName?: string | null,
  lastName?: string | null,
): boolean {
  if (!firstName || !lastName) {
    return false;
  }

  const normalized = normalizeLinkedinProfileUrl(url);
  if (!normalized) {
    return false;
  }

  const slug = normalized.split('/').pop()?.toLowerCase() ?? '';
  const normalizedFirst = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');

  return Boolean(
    normalizedFirst
    && normalizedLast
    && slug.includes(normalizedFirst)
    && slug.includes(normalizedLast),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

