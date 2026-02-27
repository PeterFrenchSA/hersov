export interface DeterministicMatchInput {
  emailContactId?: string | null;
  phoneContactId?: string | null;
  linkedinContactId?: string | null;
}

export type DeterministicMatchType = 'email' | 'phone' | 'linkedin';

export interface DeterministicMatchResult {
  contactId: string;
  matchedBy: DeterministicMatchType;
}

export function resolveDeterministicMatch(input: DeterministicMatchInput): DeterministicMatchResult | null {
  if (input.emailContactId) {
    return {
      contactId: input.emailContactId,
      matchedBy: 'email',
    };
  }

  if (input.phoneContactId) {
    return {
      contactId: input.phoneContactId,
      matchedBy: 'phone',
    };
  }

  if (input.linkedinContactId) {
    return {
      contactId: input.linkedinContactId,
      matchedBy: 'linkedin',
    };
  }

  return null;
}
