'use client';

import { useEffect, useState } from 'react';

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

export default function AdminSettingsPage(): JSX.Element {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProviderStatus = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      setForbidden(false);

      const response = await fetch('/api/admin/provider-status', {
        credentials: 'include',
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (response.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({ message: 'Failed to load provider status' }));
        setError(responseBody.message ?? 'Failed to load provider status');
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as { data: ProviderStatus[] };
      setProviders(payload.data ?? []);
      setLoading(false);
    };

    void loadProviderStatus();
  }, []);

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>Admin Settings</h1>

      {loading ? <p>Loading provider status...</p> : null}
      {forbidden ? <p className="error">Admin role required to view this page.</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !forbidden && !error ? (
        <div className="grid">
          {providers.map((provider) => (
            <article key={provider.name} className="card grid" style={{ gap: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>
                {provider.label} ({provider.name})
              </h2>
              <p>
                Status: <strong>{provider.configured ? 'Configured' : 'Disabled'}</strong>
              </p>
              <p>
                Env var: {provider.envVar ?? 'Not required'}
              </p>
              <p>
                Rate limit: {provider.rateLimit.rpm} rpm / concurrency {provider.rateLimit.concurrency}
              </p>
              <p>
                Fields: {provider.supportsFields.join(', ')}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
