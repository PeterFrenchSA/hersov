'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type CanonicalField =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'emails'
  | 'phones'
  | 'company'
  | 'title'
  | 'notes_context'
  | 'city'
  | 'country'
  | 'linkedin'
  | 'website'
  | 'twitter';

type MappingState = Record<CanonicalField, string | null>;

type BatchStatus = {
  batchId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  totalRows: number;
  processedRows: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  duplicateCount: number;
  errorCount: number;
  percentComplete: number;
  startedAt: string | null;
  finishedAt: string | null;
};

type ImportResults = {
  storageMode: 'rows' | 'summary';
  data: Array<{ rowIndex: number; outcome: string; errorMessage?: string }>;
  pagination: { total: number };
};

const FIELD_LABELS: Array<{ key: CanonicalField; label: string }> = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'full_name', label: 'Full Name' },
  { key: 'emails', label: 'Emails' },
  { key: 'phones', label: 'Phones' },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title' },
  { key: 'notes_context', label: 'Notes / Context' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'website', label: 'Website' },
  { key: 'twitter', label: 'Twitter' },
];

const EMPTY_MAPPING: MappingState = {
  first_name: null,
  last_name: null,
  full_name: null,
  emails: null,
  phones: null,
  company: null,
  title: null,
  notes_context: null,
  city: null,
  country: null,
  linkedin: null,
  website: null,
  twitter: null,
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MappingState>(EMPTY_MAPPING);
  const [csvDelimiter, setCsvDelimiter] = useState<',' | ';' | '|' | '\t'>(',');
  const [emailDelimiterInput, setEmailDelimiterInput] = useState(',;');
  const [phoneDelimiterInput, setPhoneDelimiterInput] = useState(',;');

  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [duplicateRows, setDuplicateRows] = useState<ImportResults['data']>([]);
  const [errorRows, setErrorRows] = useState<ImportResults['data']>([]);

  const [uploading, setUploading] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [startingImport, setStartingImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mappingSaved, setMappingSaved] = useState(false);

  const canStartImport = useMemo(() => Boolean(batchId && mappingSaved && !startingImport), [batchId, mappingSaved, startingImport]);

  useEffect(() => {
    if (!batchId) {
      return;
    }

    if (!status || status.status === 'processing' || status.status === 'queued') {
      const timer = window.setInterval(() => {
        void fetchStatus(batchId, setStatus, setError);
      }, 2500);

      return () => {
        window.clearInterval(timer);
      };
    }

    return;
  }, [batchId, status]);

  useEffect(() => {
    if (!batchId || !status || !['completed', 'failed', 'canceled'].includes(status.status)) {
      return;
    }

    void fetchResults(batchId, 'duplicate', setDuplicateRows, setError);
    void fetchResults(batchId, 'error', setErrorRows, setError);
  }, [batchId, status]);

  const onUpload = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!file) {
      setError('Select a CSV file to upload.');
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/import/csv', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (response.status === 401 || response.status === 403) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({ message: 'Upload failed' }));
      setError(responseBody.message ?? 'Upload failed');
      setUploading(false);
      return;
    }

    const data = (await response.json()) as {
      batchId: string;
      headersDetected: string[];
      detectedCsvDelimiter: ',' | ';' | '|' | '\t';
    };

    setBatchId(data.batchId);
    setHeaders(data.headersDetected);
    setCsvDelimiter(data.detectedCsvDelimiter ?? ',');
    setMapping(inferMapping(data.headersDetected));
    setStatus(null);
    setMappingSaved(false);
    setDuplicateRows([]);
    setErrorRows([]);
    setUploading(false);
  };

  const onSaveMapping = async (): Promise<void> => {
    if (!batchId) {
      return;
    }

    setSavingMapping(true);
    setError(null);

    const response = await fetch(`/api/import/${batchId}/mapping`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mapping,
        emailDelimiters: parseDelimiterInput(emailDelimiterInput),
        phoneDelimiters: parseDelimiterInput(phoneDelimiterInput),
        csvDelimiter,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({ message: 'Failed to save mapping' }));
      setError(responseBody.message ?? 'Failed to save mapping');
      setSavingMapping(false);
      return;
    }

    setMappingSaved(true);
    setSavingMapping(false);
  };

  const onStartImport = async (): Promise<void> => {
    if (!batchId) {
      return;
    }

    setStartingImport(true);
    setError(null);

    const response = await fetch(`/api/import/${batchId}/start`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({ message: 'Failed to start import' }));
      setError(responseBody.message ?? 'Failed to start import');
      setStartingImport(false);
      return;
    }

    await fetchStatus(batchId, setStatus, setError);
    setStartingImport(false);
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>CSV Import</h1>
      <p>Upload a CSV, map headers, then start a background import job.</p>

      <article className="card grid" style={{ gap: '0.75rem' }}>
        <h2>1) Upload CSV</h2>
        <form onSubmit={onUpload} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button className="button" type="submit" disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
        {batchId ? <p>Batch ID: {batchId}</p> : null}
      </article>

      {batchId ? (
        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2>2) Map Columns</h2>
          <p>Detected headers: {headers.join(', ')}</p>

          <div className="grid" style={{ gap: '0.5rem' }}>
            {FIELD_LABELS.map((field) => (
              <label key={field.key} style={{ display: 'grid', gap: '0.25rem' }}>
                {field.label}
                <select
                  className="input"
                  value={mapping[field.key] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    setMapping((previous) => ({
                      ...previous,
                      [field.key]: value.length > 0 ? value : null,
                    }));
                    setMappingSaved(false);
                  }}
                >
                  <option value="">Skip</option>
                  {headers.map((header) => (
                    <option key={`${field.key}-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="grid grid-3">
            <label>
              Email delimiters
              <input
                className="input"
                value={emailDelimiterInput}
                onChange={(event) => {
                  setEmailDelimiterInput(event.target.value);
                  setMappingSaved(false);
                }}
                placeholder=",;|"
              />
            </label>
            <label>
              Phone delimiters
              <input
                className="input"
                value={phoneDelimiterInput}
                onChange={(event) => {
                  setPhoneDelimiterInput(event.target.value);
                  setMappingSaved(false);
                }}
                placeholder=",;|"
              />
            </label>
            <label>
              CSV delimiter
              <select
                className="input"
                value={csvDelimiter}
                onChange={(event) => {
                  setCsvDelimiter(event.target.value as ',' | ';' | '|' | '\t');
                  setMappingSaved(false);
                }}
              >
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value="|">Pipe (|)</option>
                <option value="\t">Tab</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="button" type="button" onClick={onSaveMapping} disabled={savingMapping}>
              {savingMapping ? 'Saving...' : 'Save Mapping'}
            </button>
            <button className="button secondary" type="button" onClick={onStartImport} disabled={!canStartImport}>
              {startingImport ? 'Starting...' : 'Start Import'}
            </button>
            {mappingSaved ? <span>Mapping saved.</span> : null}
          </div>
        </article>
      ) : null}

      {status ? (
        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2>3) Progress</h2>
          <p>Status: {status.status}</p>
          <div style={{ border: '1px solid #d8dee9', borderRadius: 8, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, status.percentComplete))}%`,
                height: 14,
                background: '#0a9396',
                transition: 'width 0.2s linear',
              }}
            />
          </div>
          <p>{status.percentComplete.toFixed(2)}%</p>
          <div className="grid grid-3">
            <p>Processed: {status.processedRows} / {status.totalRows}</p>
            <p>Inserted: {status.insertedCount}</p>
            <p>Updated: {status.updatedCount}</p>
            <p>Skipped: {status.skippedCount}</p>
            <p>Duplicates: {status.duplicateCount}</p>
            <p>Errors: {status.errorCount}</p>
          </div>
        </article>
      ) : null}

      {status && ['completed', 'failed', 'canceled'].includes(status.status) ? (
        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2>4) Results</h2>
          <p>Potential duplicates ({status.duplicateCount})</p>
          <ul>
            {duplicateRows.length === 0 ? <li>No duplicates recorded.</li> : null}
            {duplicateRows.map((row) => (
              <li key={`dup-${row.rowIndex}`}>
                Row {row.rowIndex}: {row.errorMessage ?? 'Potential duplicate'}
              </li>
            ))}
          </ul>

          <p>Errors ({status.errorCount})</p>
          <ul>
            {errorRows.length === 0 ? <li>No errors recorded.</li> : null}
            {errorRows.map((row) => (
              <li key={`err-${row.rowIndex}`}>
                Row {row.rowIndex}: {row.errorMessage ?? 'Error'}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function parseDelimiterInput(input: string): Array<',' | ';' | '|'> {
  const delimiters = Array.from(new Set(input.split('').filter((char): char is ',' | ';' | '|' => [',', ';', '|'].includes(char))));

  if (delimiters.length === 0) {
    return [',', ';'];
  }

  return delimiters;
}

function inferMapping(headers: string[]): MappingState {
  const inferred: MappingState = { ...EMPTY_MAPPING };

  for (const header of headers) {
    const normalizedHeader = normalizeHeader(header);

    if (!inferred.first_name && ['first_name', 'firstname', 'first'].includes(normalizedHeader)) {
      inferred.first_name = header;
    }

    if (!inferred.last_name && ['last_name', 'lastname', 'surname', 'last'].includes(normalizedHeader)) {
      inferred.last_name = header;
    }

    if (!inferred.full_name && ['full_name', 'fullname', 'name', 'contact_name'].includes(normalizedHeader)) {
      inferred.full_name = header;
    }

    if (!inferred.emails && ['emails', 'email', 'email_address'].includes(normalizedHeader)) {
      inferred.emails = header;
    }

    if (!inferred.phones && ['phones', 'phone', 'phone_number', 'mobile'].includes(normalizedHeader)) {
      inferred.phones = header;
    }

    if (!inferred.company && ['company', 'company_name', 'organisation', 'organization'].includes(normalizedHeader)) {
      inferred.company = header;
    }

    if (!inferred.title && ['title', 'role', 'job_title', 'position'].includes(normalizedHeader)) {
      inferred.title = header;
    }

    if (!inferred.notes_context && ['notes', 'context', 'notes_context'].includes(normalizedHeader)) {
      inferred.notes_context = header;
    }

    if (!inferred.city && ['city', 'location_city', 'town'].includes(normalizedHeader)) {
      inferred.city = header;
    }

    if (!inferred.country && ['country', 'location_country'].includes(normalizedHeader)) {
      inferred.country = header;
    }

    if (!inferred.linkedin && ['linkedin', 'linkedin_url'].includes(normalizedHeader)) {
      inferred.linkedin = header;
    }

    if (!inferred.website && ['website', 'website_url', 'domain'].includes(normalizedHeader)) {
      inferred.website = header;
    }

    if (!inferred.twitter && ['twitter', 'twitter_url', 'x'].includes(normalizedHeader)) {
      inferred.twitter = header;
    }
  }

  return inferred;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function fetchStatus(
  batchId: string,
  setStatus: (value: BatchStatus) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  const response = await fetch(`/api/import/${batchId}/status`, {
    credentials: 'include',
  });

  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({ message: 'Failed to fetch import status' }));
    setError(responseBody.message ?? 'Failed to fetch import status');
    return;
  }

  const data = (await response.json()) as BatchStatus;
  setStatus(data);
}

async function fetchResults(
  batchId: string,
  outcome: 'duplicate' | 'error',
  setRows: (rows: ImportResults['data']) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  const response = await fetch(`/api/import/${batchId}/results?outcome=${outcome}&page=1&pageSize=50`, {
    credentials: 'include',
  });

  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({ message: `Failed to fetch ${outcome} rows` }));
    setError(responseBody.message ?? `Failed to fetch ${outcome} rows`);
    return;
  }

  const data = (await response.json()) as ImportResults;
  setRows(data.data ?? []);
}
