export function canonicalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeAlias(value: string): string {
  return canonicalizeLabel(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

export function aliasMatches(candidate: string, alias: string): boolean {
  return normalizeAlias(candidate) === normalizeAlias(alias);
}

export function normalizeRelationshipType(value: string): string {
  return canonicalizeLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function extractEvidenceSnippet(
  notesRaw: string,
  needles: string[],
  maxChars = 280,
): string {
  const cleanNotes = notesRaw.trim().replace(/\s+/g, ' ');
  if (!cleanNotes) {
    return '';
  }

  const loweredNotes = cleanNotes.toLowerCase();
  for (const needle of needles) {
    const normalizedNeedle = needle.trim().toLowerCase();
    if (!normalizedNeedle) {
      continue;
    }

    const index = loweredNotes.indexOf(normalizedNeedle);
    if (index >= 0) {
      const start = Math.max(0, index - Math.floor(maxChars / 2));
      const end = Math.min(cleanNotes.length, start + maxChars);
      return cleanNotes.slice(start, end);
    }
  }

  return cleanNotes.slice(0, maxChars);
}
