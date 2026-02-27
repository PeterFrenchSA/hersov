import {
  aliasMatches,
  canonicalizeLabel,
  extractEvidenceSnippet,
  normalizeAlias,
  normalizeRelationshipType,
} from './normalization';

describe('insights normalization helpers', () => {
  it('canonicalizes labels and aliases deterministically', () => {
    expect(canonicalizeLabel('  Alpha   Capital  ')).toBe('Alpha Capital');
    expect(normalizeAlias(' Alpha Capital, LLC ')).toBe('alpha capital llc');
    expect(aliasMatches('Alpha Capital LLC', 'alpha capital, llc')).toBe(true);
  });

  it('normalizes relationship type to snake_case', () => {
    expect(normalizeRelationshipType('Introduced By')).toBe('introduced_by');
    expect(normalizeRelationshipType('  Co-Invested @ Event 2024 ')).toBe('co_invested_event_2024');
  });

  it('extracts targeted evidence snippets', () => {
    const notes = 'Met Jane Doe at Monaco summit. She introduced us to Acme Ventures and discussed energy funds.';
    const snippet = extractEvidenceSnippet(notes, ['Acme Ventures']);
    expect(snippet).toContain('Acme Ventures');
    expect(snippet.length).toBeGreaterThan(0);
  });
});
