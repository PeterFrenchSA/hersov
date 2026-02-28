'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type ProviderStatus = {
  name: 'mock' | 'apollo';
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

type MergePolicy = 'fill_missing_only' | 'overwrite_if_higher_confidence';

export default function NewEnrichmentRunPage() {
  const router = useRouter();

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<Array<'mock' | 'apollo'>>(['mock']);
  const [mergePolicy, setMergePolicy] = useState<MergePolicy>('fill_missing_only');
  const [dryRun, setDryRun] = useState(false);

  const [explicitIdsInput, setExplicitIdsInput] = useState('');
  const [missingEmail, setMissingEmail] = useState(false);
  const [missingLinkedin, setMissingLinkedin] = useState(false);
  const [missingLocation, setMissingLocation] = useState(false);
  const [country, setCountry] = useState('');
  const [tag, setTag] = useState('');
  const [company, setCompany] = useState('');
  const [importedBatchId, setImportedBatchId] = useState('');

  const [loadingProviders, setLoadingProviders] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProviders = async (): Promise<void> => {
      setLoadingProviders(true);
      setError(null);

      const response = await fetch('/api/enrichment/runs/providers', {
        credentials: 'include',
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({ message: 'Failed to load provider status' }));
        setError(responseBody.message ?? 'Failed to load provider status');
        setLoadingProviders(false);
        return;
      }

      const payload = (await response.json()) as { data: ProviderStatus[] };
      const incomingProviders = payload.data ?? [];

      setProviders(incomingProviders);

      const enabledProviders = incomingProviders.filter((provider) => provider.enabled).map((provider) => provider.name);
      if (enabledProviders.length > 0) {
        setSelectedProviders(enabledProviders);
      }

      setLoadingProviders(false);
    };

    void loadProviders();
  }, []);

  const explicitContactIds = useMemo(() => {
    return Array.from(
      new Set(
        explicitIdsInput
          .split(/[\n,\s]+/g)
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );
  }, [explicitIdsInput]);

  const toggleProvider = (providerName: 'mock' | 'apollo'): void => {
    setSelectedProviders((previous) => {
      if (previous.includes(providerName)) {
        return previous.filter((item) => item !== providerName);
      }

      return [...previous, providerName];
    });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (selectedProviders.length === 0) {
      setError('Select at least one enabled provider.');
      return;
    }

    if (explicitContactIds.length > 10000) {
      setError('Explicit contact IDs are limited to 10,000 per run.');
      return;
    }

    setSubmitting(true);

    const payload = {
      selection: {
        ...(explicitContactIds.length > 0 ? { explicitContactIds } : {}),
        ...(missingEmail ? { missingEmail: true } : {}),
        ...(missingLinkedin ? { missingLinkedin: true } : {}),
        ...(missingLocation ? { missingLocation: true } : {}),
        ...(country.trim() ? { country: country.trim() } : {}),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
        ...(company.trim() ? { company: company.trim() } : {}),
        ...(importedBatchId.trim() ? { importedBatchId: importedBatchId.trim() } : {}),
      },
      providers: selectedProviders,
      mergePolicy,
      dryRun,
    };

    const response = await fetch('/api/enrichment/runs', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (response.status === 403) {
      setError('You do not have permission to create enrichment runs.');
      setSubmitting(false);
      return;
    }

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({ message: 'Failed to create enrichment run' }));
      setError(responseBody.message ?? 'Failed to create enrichment run');
      setSubmitting(false);
      return;
    }

    const data = (await response.json()) as { id: string };
    router.push(`/enrichment/${data.id}`);
    router.refresh();
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>New Enrichment Run</h1>
      <form className="grid" style={{ gap: '1rem' }} onSubmit={onSubmit}>
        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2>Target Selection</h2>
          <label>
            Explicit contact IDs (comma/newline separated)
            <textarea
              className="input"
              rows={4}
              value={explicitIdsInput}
              onChange={(event) => setExplicitIdsInput(event.target.value)}
              placeholder="contact-id-1\ncontact-id-2"
            />
          </label>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label>
              <input
                type="checkbox"
                checked={missingEmail}
                onChange={(event) => setMissingEmail(event.target.checked)}
              />{' '}
              Missing email
            </label>
            <label>
              <input
                type="checkbox"
                checked={missingLinkedin}
                onChange={(event) => setMissingLinkedin(event.target.checked)}
              />{' '}
              Missing LinkedIn
            </label>
            <label>
              <input
                type="checkbox"
                checked={missingLocation}
                onChange={(event) => setMissingLocation(event.target.checked)}
              />{' '}
              Missing location
            </label>
          </div>

          <div className="grid grid-3">
            <label>
              Country
              <input className="input" value={country} onChange={(event) => setCountry(event.target.value)} />
            </label>
            <label>
              Tag (name or id)
              <input className="input" value={tag} onChange={(event) => setTag(event.target.value)} />
            </label>
            <label>
              Company name contains
              <input className="input" value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label>
              Imported batch UUID
              <input
                className="input"
                value={importedBatchId}
                onChange={(event) => setImportedBatchId(event.target.value)}
              />
            </label>
          </div>
        </article>

        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2>Providers</h2>
          {loadingProviders ? <p>Loading provider status...</p> : null}
          {!loadingProviders && providers.length === 0 ? <p>No providers available.</p> : null}

          {!loadingProviders ? (
            <div className="grid" style={{ gap: '0.5rem' }}>
              {providers.map((provider) => (
                <label key={provider.name} style={{ border: '1px solid #d8dee9', borderRadius: 8, padding: '0.75rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedProviders.includes(provider.name)}
                    onChange={() => toggleProvider(provider.name)}
                    disabled={!provider.enabled}
                  />{' '}
                  <strong>{provider.label}</strong> ({provider.name})
                  <div style={{ fontSize: '0.9rem', marginTop: '0.35rem' }}>
                    Status: {provider.enabled ? 'Enabled' : 'Disabled'}
                    {!provider.configured && provider.envVar ? ` (missing ${provider.envVar})` : ''}
                  </div>
                  <div style={{ fontSize: '0.9rem' }}>
                    Rate limit: {provider.rateLimit.rpm} rpm, concurrency {provider.rateLimit.concurrency}
                  </div>
                </label>
              ))}
            </div>
          ) : null}
        </article>

        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2>Merge Policy</h2>
          <label>
            Policy
            <select
              className="input"
              value={mergePolicy}
              onChange={(event) => setMergePolicy(event.target.value as MergePolicy)}
            >
              <option value="fill_missing_only">fill_missing_only</option>
              <option value="overwrite_if_higher_confidence">overwrite_if_higher_confidence</option>
            </select>
          </label>

          <label>
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} /> Dry run
            (record suggested changes only)
          </label>
        </article>

        {error ? <p className="error">{error}</p> : null}

        <button className="button" type="submit" disabled={submitting || loadingProviders}>
          {submitting ? 'Creating run...' : 'Create Run'}
        </button>
      </form>
    </section>
  );
}
