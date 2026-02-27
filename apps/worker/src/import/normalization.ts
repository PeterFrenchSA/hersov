import type { ImportColumnMappingInput } from '@hersov/shared';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export interface NormalizedImportCandidate {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  emails: string[];
  phones: string[];
  company: string | null;
  title: string | null;
  notesContext: string | null;
  city: string | null;
  country: string | null;
  linkedin: string | null;
  website: string | null;
  twitter: string | null;
}

export function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function splitMultiValue(value: string | null, delimiters: string[]): string[] {
  if (!value) {
    return [];
  }

  const escapedDelimiters = delimiters.map((delimiter) => delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const splitRegex = new RegExp(`[${escapedDelimiters.join('')}]`, 'g');

  return value
    .split(splitRegex)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, '');

  const parsed = parsePhoneNumberFromString(cleaned);
  if (parsed && parsed.isValid()) {
    return parsed.number;
  }

  return cleaned;
}

export function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, '').toLowerCase();
}

export function normalizeCsvRow(
  row: Record<string, unknown>,
  mapping: ImportColumnMappingInput,
): NormalizedImportCandidate {
  const firstName = trimToNull(getMappedValue(row, mapping.mapping.first_name));
  const lastName = trimToNull(getMappedValue(row, mapping.mapping.last_name));
  const mappedFullName = trimToNull(getMappedValue(row, mapping.mapping.full_name));

  const derivedFullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const fullName = mappedFullName ?? (derivedFullName.length > 0 ? derivedFullName : null);

  const emailSource = trimToNull(getMappedValue(row, mapping.mapping.emails));
  const phoneSource = trimToNull(getMappedValue(row, mapping.mapping.phones));

  const emails = uniqueValues(splitMultiValue(emailSource, mapping.emailDelimiters).map(normalizeEmail));
  const phones = uniqueValues(splitMultiValue(phoneSource, mapping.phoneDelimiters).map(normalizePhone));

  const linkedinRaw = trimToNull(getMappedValue(row, mapping.mapping.linkedin));
  const websiteRaw = trimToNull(getMappedValue(row, mapping.mapping.website));
  const twitterRaw = trimToNull(getMappedValue(row, mapping.mapping.twitter));

  return {
    firstName,
    lastName,
    fullName,
    emails,
    phones,
    company: trimToNull(getMappedValue(row, mapping.mapping.company)),
    title: trimToNull(getMappedValue(row, mapping.mapping.title)),
    notesContext: trimToNull(getMappedValue(row, mapping.mapping.notes_context)),
    city: trimToNull(getMappedValue(row, mapping.mapping.city)),
    country: trimToNull(getMappedValue(row, mapping.mapping.country)),
    linkedin: linkedinRaw ? normalizeUrl(linkedinRaw) : null,
    website: websiteRaw ? normalizeUrl(websiteRaw) : null,
    twitter: twitterRaw ? normalizeUrl(twitterRaw) : null,
  };
}

function getMappedValue(row: Record<string, unknown>, header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }

  const value = row[header];
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return null;
}

function uniqueValues(values: string[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (value) {
      set.add(value);
    }
  }

  return Array.from(set);
}
