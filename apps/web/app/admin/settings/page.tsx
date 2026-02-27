'use client';

import { FormEvent, useEffect, useState } from 'react';

type ProviderStatus = {
  name: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  envVar: string | null;
  supportsFields: string[];
  rateLimit: {
    rpm: number;
    concurrency: number;
  };
};

type EmbeddingsStatus = {
  totalContacts: number;
  embeddedContacts: number;
  missingContacts: number;
  staleContacts: number;
  staleAfterDays: number;
  lastRunAt: string | null;
};

export default function AdminSettingsPage(): JSX.Element {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [embeddingsStatus, setEmbeddingsStatus] = useState<EmbeddingsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [missingOnly, setMissingOnly] = useState(true);
  const [staleOnly, setStaleOnly] = useState(false);
  const [country, setCountry] = useState('');
  const [tag, setTag] = useState('');
  const [importedBatchId, setImportedBatchId] = useState('');
  const [limit, setLimit] = useState('500');
  const [startingBackfill, setStartingBackfill] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  const loadAll = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    const [providersResponse, embeddingsResponse] = await Promise.all([
      fetch('/api/admin/provider-status', { credentials: 'include' }),
      fetch('/api/embeddings/status', { credentials: 'include' }),
    ]);

    if (providersResponse.status === 401 || embeddingsResponse.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (providersResponse.status === 403 || embeddingsResponse.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }

    if (!providersResponse.ok || !embeddingsResponse.ok) {
      setError('Failed to load admin settings');
      setLoading(false);
      return;
    }

    const providersPayload = (await providersResponse.json()) as { data: ProviderStatus[] };
    const embeddingsPayload = (await embeddingsResponse.json()) as EmbeddingsStatus;

    setProviders(providersPayload.data ?? []);
    setEmbeddingsStatus(embeddingsPayload);
    setLoading(false);
  };

  const startBackfill = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setStartingBackfill(true);
    setError(null);

    const response = await fetch('/api/embeddings/backfill', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        missingOnly,
        staleOnly,
        ...(country.trim() ? { country: country.trim() } : {}),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
        ...(importedBatchId.trim() ? { importedBatchId: importedBatchId.trim() } : {}),
        limit: Number(limit) || 500,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({ message: 'Failed to queue embeddings backfill' }));
      setError(responseBody.message ?? 'Failed to queue embeddings backfill');
      setStartingBackfill(false);
      return;
    }

    await loadAll();
    setStartingBackfill(false);
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>Admin Settings</h1>

      {loading ? <p>Loading settings...</p> : null}
      {forbidden ? <p className="error">Admin role required to view this page.</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !forbidden && !error ? (
        <>
          <article className="card grid" style={{ gap: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Embeddings</h2>
            {embeddingsStatus ? (
              <div className="grid grid-3">
                <p>Total contacts: {embeddingsStatus.totalContacts}</p>
                <p>Embedded: {embeddingsStatus.embeddedContacts}</p>
                <p>Missing: {embeddingsStatus.missingContacts}</p>
                <p>Stale: {embeddingsStatus.staleContacts}</p>
                <p>Stale threshold (days): {embeddingsStatus.staleAfterDays}</p>
                <p>Last run: {embeddingsStatus.lastRunAt ? new Date(embeddingsStatus.lastRunAt).toLocaleString() : '-'}</p>
              </div>
            ) : null}

            <form className="grid" style={{ gap: '0.75rem' }} onSubmit={startBackfill}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <label>
                  <input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} /> Missing only
                </label>
                <label>
                  <input type="checkbox" checked={staleOnly} onChange={(event) => setStaleOnly(event.target.checked)} /> Stale only
                </label>
              </div>

              <div className="grid grid-3">
                <label>
                  Country
                  <input className="input" value={country} onChange={(event) => setCountry(event.target.value)} />
                </label>
                <label>
                  Tag
                  <input className="input" value={tag} onChange={(event) => setTag(event.target.value)} />
                </label>
                <label>
                  Imported batch UUID
                  <input className="input" value={importedBatchId} onChange={(event) => setImportedBatchId(event.target.value)} />
                </label>
                <label>
                  Limit
                  <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} />
                </label>
              </div>

              <button className="button" type="submit" disabled={startingBackfill}>
                {startingBackfill ? 'Queueing...' : 'Queue Embeddings Backfill'}
              </button>
            </form>
          </article>

          <article className="card grid" style={{ gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>Provider Configuration</h2>
            {providers.map((provider) => (
              <div key={provider.name} style={{ border: '1px solid #d8dee9', borderRadius: 8, padding: '0.75rem' }}>
                <div>
                  <strong>{provider.label}</strong> ({provider.name})
                </div>
                <div>Status: {provider.configured ? 'Configured' : 'Disabled'}</div>
                <div>Env var: {provider.envVar ?? 'Not required'}</div>
                <div>
                  Rate limit: {provider.rateLimit.rpm} rpm / concurrency {provider.rateLimit.concurrency}
                </div>
              </div>
            ))}
          </article>
        </>
      ) : null}
    </section>
  );
}
