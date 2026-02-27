import type {
  EnrichmentContactMethodType,
  EnrichmentMergePolicy,
  EnrichmentProviderMethodCandidate,
} from '@hersov/shared';

export interface ExistingMethodState {
  id: string;
  type: EnrichmentContactMethodType;
  value: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

export interface MethodChangePlan {
  createMethods: Array<{
    type: EnrichmentContactMethodType;
    value: string;
    confidence: number;
    isPrimary: boolean;
    verifiedAt: string | null;
    provider: string;
    providerRef?: string;
    evidenceUrl?: string;
  }>;
  setPrimary: Array<{
    type: EnrichmentContactMethodType;
    value: string;
    provider: string;
    confidence: number;
    providerRef?: string;
    evidenceUrl?: string;
  }>;
  verifyExistingMethodIds: Array<{
    methodId: string;
    verifiedAt: string;
  }>;
}

export function shouldApplyFieldUpdate(input: {
  policy: EnrichmentMergePolicy;
  existingValue: string | null;
  incomingValue: string;
  existingConfidence: number;
  incomingConfidence: number;
  threshold: number;
}): boolean {
  const existing = normalizeString(input.existingValue);
  const incoming = normalizeString(input.incomingValue);

  if (!incoming) {
    return false;
  }

  if (!existing) {
    return true;
  }

  if (existing.toLowerCase() === incoming.toLowerCase()) {
    return false;
  }

  if (input.policy === 'fill_missing_only') {
    return false;
  }

  return input.incomingConfidence > input.existingConfidence + input.threshold;
}

export function planContactMethodChanges(input: {
  existingMethods: ExistingMethodState[];
  candidates: Array<EnrichmentProviderMethodCandidate & { provider: string }>;
}): MethodChangePlan {
  const existingByKey = new Map<string, ExistingMethodState>();

  for (const method of input.existingMethods) {
    existingByKey.set(methodKey(method.type, method.value), method);
  }

  const createMethods = new Map<
    string,
    {
      type: EnrichmentContactMethodType;
      value: string;
      confidence: number;
      isPrimary: boolean;
      verifiedAt: string | null;
      provider: string;
      providerRef?: string;
      evidenceUrl?: string;
    }
  >();

  const setPrimary = new Map<
    EnrichmentContactMethodType,
    {
      type: EnrichmentContactMethodType;
      value: string;
      provider: string;
      confidence: number;
      providerRef?: string;
      evidenceUrl?: string;
    }
  >();

  const verifyExistingMethodIds = new Map<string, { methodId: string; verifiedAt: string }>();

  for (const candidate of input.candidates) {
    const normalizedValue = normalizeMethodValue(candidate.type, candidate.value);
    if (!normalizedValue) {
      continue;
    }

    const key = methodKey(candidate.type, normalizedValue);
    const existing = existingByKey.get(key);

    if (existing) {
      if (candidate.isPrimary && !existing.isPrimary) {
        const existingSetPrimary = setPrimary.get(candidate.type);
        if (!existingSetPrimary || candidate.confidence >= existingSetPrimary.confidence) {
          setPrimary.set(candidate.type, {
            type: candidate.type,
            value: normalizedValue,
            provider: candidate.provider,
            confidence: candidate.confidence,
            providerRef: candidate.providerRef,
            evidenceUrl: candidate.evidenceUrl,
          });
        }
      }

      if (candidate.verifiedAt && !existing.verifiedAt) {
        verifyExistingMethodIds.set(existing.id, {
          methodId: existing.id,
          verifiedAt: candidate.verifiedAt,
        });
      }

      continue;
    }

    const existingCreated = createMethods.get(key);
    const createCandidate = {
      type: candidate.type,
      value: normalizedValue,
      confidence: candidate.confidence,
      isPrimary: Boolean(candidate.isPrimary),
      verifiedAt: candidate.verifiedAt ?? null,
      provider: candidate.provider,
      providerRef: candidate.providerRef,
      evidenceUrl: candidate.evidenceUrl,
    };

    if (!existingCreated || candidate.confidence >= existingCreated.confidence) {
      createMethods.set(key, createCandidate);
    }

    if (candidate.isPrimary) {
      const existingSetPrimary = setPrimary.get(candidate.type);
      if (!existingSetPrimary || candidate.confidence >= existingSetPrimary.confidence) {
        setPrimary.set(candidate.type, {
          type: candidate.type,
          value: normalizedValue,
          provider: candidate.provider,
          confidence: candidate.confidence,
          providerRef: candidate.providerRef,
          evidenceUrl: candidate.evidenceUrl,
        });
      }
    }
  }

  return {
    createMethods: Array.from(createMethods.values()),
    setPrimary: Array.from(setPrimary.values()),
    verifyExistingMethodIds: Array.from(verifyExistingMethodIds.values()),
  };
}

export function normalizeMethodValue(type: EnrichmentContactMethodType, value: string): string {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return '';
  }

  if (type === 'email') {
    return trimmed.toLowerCase();
  }

  if (type === 'website' || type === 'linkedin' || type === 'twitter') {
    return trimmed.toLowerCase().replace(/\/$/, '');
  }

  if (type === 'phone') {
    return trimmed.replace(/\s+/g, '');
  }

  return trimmed;
}

function normalizeString(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function methodKey(type: EnrichmentContactMethodType, value: string): string {
  return `${type}:${normalizeMethodValue(type, value)}`;
}
