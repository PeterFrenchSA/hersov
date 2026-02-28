'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type RunStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

type EnrichmentRunRow = {
  id: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  providers: string[];
  mergePolicy: string;
  dryRun: boolean;
  counters: {
    totalTargets: number;
    processedTargets: number;
    updatedContacts: number;
    skippedContacts: number;
    errorCount: number;
  };
};

const STATUS_OPTIONS: Array<{ value: '' | RunStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'canceled', label: 'Canceled' },
];

export default function EnrichmentRunsPage() {
  const [statusFilter, setStatusFilter] = useState<'' | RunStatus>('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [runs, setRuns] = useState<EnrichmentRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasActiveRuns = useMemo(() => runs.some((run) => run.status === 'queued' || run.status === 'processing'), [runs]);

  useEffect(() => {
    const loadRuns = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      const query = new URLSearchParams({ page: '1', pageSize: '30' });
      if (statusFilter) {
        query.set('status', statusFilter);
      }

      const response = await fetch(`/api/enrichment/runs?${query.toString()}`, {
        credentials: 'include',
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({ message: 'Failed to load enrichment runs' }));
        setError(responseBody.message ?? 'Failed to load enrichment runs');
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as {
        data: EnrichmentRunRow[];
      };

      setRuns(payload.data ?? []);
      setLoading(false);
    };

    void loadRuns();
  }, [statusFilter, refreshTick]);

  useEffect(() => {
    if (!hasActiveRuns) {
      return;
    }

    const timer = window.setInterval(() => {
      setRefreshTick((value) => value + 1);
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasActiveRuns]);

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Enrichment Runs</h1>
        <Link className="button" href="/enrichment/new" style={{ textDecoration: 'none' }}>
          New Run
        </Link>
      </div>

      <article className="card" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Status
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | RunStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </article>

      <article className="card">
        {loading ? <p>Loading runs...</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {!loading && !error ? (
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Providers</th>
                <th>Progress</th>
                <th>Updated</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const pct = run.counters.totalTargets > 0
                  ? Math.min(100, Math.round((run.counters.processedTargets / run.counters.totalTargets) * 100))
                  : 0;

                return (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/enrichment/${run.id}`}>{new Date(run.createdAt).toLocaleString()}</Link>
                      {run.dryRun ? ' (dry-run)' : ''}
                    </td>
                    <td>{run.status}</td>
                    <td>{run.providers.join(', ') || '-'}</td>
                    <td>
                      {run.counters.processedTargets}/{run.counters.totalTargets} ({pct}%)
                    </td>
                    <td>{run.counters.updatedContacts}</td>
                    <td>{run.counters.errorCount}</td>
                  </tr>
                );
              })}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No enrichment runs yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}
      </article>
    </section>
  );
}
