import { resolveDeterministicMatch } from './dedupe';

describe('deterministic dedupe', () => {
  it('prefers email match over phone/linkedin', () => {
    const result = resolveDeterministicMatch({
      emailContactId: 'contact-email',
      phoneContactId: 'contact-phone',
      linkedinContactId: 'contact-linkedin',
    });

    expect(result).toEqual({
      contactId: 'contact-email',
      matchedBy: 'email',
    });
  });

  it('returns null when no deterministic key matches', () => {
    expect(resolveDeterministicMatch({})).toBeNull();
  });
});
