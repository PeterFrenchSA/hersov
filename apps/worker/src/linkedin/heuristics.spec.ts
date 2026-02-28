import {
  normalizeLinkedinProfileUrl,
  scoreLinkedinCandidate,
} from './heuristics';

describe('linkedin heuristics', () => {
  it('scores strong name/company matches higher', () => {
    const result = scoreLinkedinCandidate(
      {
        fullName: 'Jane Doe',
        firstName: 'Jane',
        lastName: 'Doe',
        companyName: 'Acme Capital',
        currentTitle: 'Managing Partner',
        locationCity: 'London',
        locationCountry: 'United Kingdom',
      },
      {
        profileUrl: 'https://www.linkedin.com/in/jane-doe-123456/',
        profileName: 'Jane Doe',
        headline: 'Managing Partner at Acme Capital',
        snippet: 'London, United Kingdom',
        location: 'London, United Kingdom',
      },
    );

    expect(result.score).toBeGreaterThan(0.75);
    expect(result.signals.slugMatched).toBe(true);
    expect(result.signals.locationMatched).toBe(true);
  });

  it('keeps weakly matched candidates below threshold', () => {
    const result = scoreLinkedinCandidate(
      {
        fullName: 'Jane Doe',
        firstName: 'Jane',
        lastName: 'Doe',
        companyName: 'Acme Capital',
        currentTitle: 'Managing Partner',
        locationCountry: 'United Kingdom',
      },
      {
        profileUrl: 'https://www.linkedin.com/in/mike-ross-33/',
        profileName: 'Mike Ross',
        headline: 'Software Engineer at Another Corp',
        snippet: 'San Francisco, California',
      },
    );

    expect(result.score).toBeLessThan(0.45);
  });

  it('normalizes person profile URLs and rejects non-profile LinkedIn URLs', () => {
    expect(normalizeLinkedinProfileUrl('https://www.linkedin.com/in/jane-doe/?trk=foo')).toBe(
      'https://www.linkedin.com/in/jane-doe',
    );
    expect(normalizeLinkedinProfileUrl('https://www.linkedin.com/company/acme')).toBeNull();
  });
});

