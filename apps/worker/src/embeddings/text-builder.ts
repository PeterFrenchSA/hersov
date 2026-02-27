import { createHash } from 'node:crypto';

const MAX_NOTES_CHARS = 2000;

export interface EmbeddingTextContactInput {
  fullName: string;
  currentTitle: string | null;
  companyName: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  notesRaw: string | null;
  tags: string[];
}

export function buildContactEmbeddingText(contact: EmbeddingTextContactInput): string {
  const tags = Array.from(
    new Set(
      contact.tags
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const notes = (contact.notesRaw ?? '').trim();
  const safeNotes = notes.length > MAX_NOTES_CHARS ? `${notes.slice(0, MAX_NOTES_CHARS)}...` : notes;

  const sections = [
    `name: ${contact.fullName.trim()}`,
    `title: ${(contact.currentTitle ?? '').trim() || 'unknown'}`,
    `company: ${(contact.companyName ?? '').trim() || 'unknown'}`,
    `location_city: ${(contact.locationCity ?? '').trim() || 'unknown'}`,
    `location_country: ${(contact.locationCountry ?? '').trim() || 'unknown'}`,
    `tags: ${tags.join(', ') || 'none'}`,
    `notes: ${safeNotes || 'none'}`,
  ];

  return sections.join('\n');
}

export function hashEmbeddingText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
