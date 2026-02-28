'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type RunStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

type RunDetails = {
  id: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  config: {
    providers: string[];
    mergePolicy: string;
    dryRun: boolean;
  } | null;
  counters: {
    totalTargets: number;
    processedTargets: number;
    updatedContacts: number;
    skippedContacts: number;
    errorCount: number;
  };
  errorSamples: Array<{ rowIndex: number; message: string }>;
};

type ResultRow = {
  id: string;
  contactId: string;
  contactName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  confidence: number | null;
  provider: string;
  createdAt: string;
};

export default function EnrichmentRunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [run, setRun] = useState<RunDetails | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const percentComplete = useMemo(() => {
    if (!run || run.counters.totalTargets === 0) {
      return 0;
    }

    return Math.min(100, Math.round((run.counters.processedTargets / run.counters.totalTargets) * 100));
  }, [run]);

  const runStatus = run?.status;

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      const [runResponse, resultsResponse] = await Promise.all([
        fetch(`/api/enrichment/runs/${runId}`, { credentials: 'include' }),
        fetch(`/api/enrichment/runs/${runId}/results?page=1&pageSize=50`, { credentials: 'include' }),
      ]);

      if (runResponse.status === 401 || resultsResponse.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!runResponse.ok) {
        const responseBody = await runResponse.json().catch(() => ({ message: 'Failed to load run' }));
        setError(responseBody.message ?? 'Failed to load run');
        setLoading(false);
        return;
      }

      if (!resultsResponse.ok) {
        const responseBody = await resultsResponse.json().catch(() => ({ message: 'Failed to load run results' }));
        setError(responseBody.message ?? 'Failed to load run results');
        setLoading(false);
        return;
      }

      const runPayload = (await runResponse.json()) as RunDetails;
      const resultsPayload = (await resultsResponse.json()) as { data: ResultRow[] };

      setRun(runPayload);
      setResults(resultsPayload.data ?? []);
      setLoading(false);
    };

    void load();
  }, [runId]);

  useEffect(() => {
    if (!runStatus || !['queued', 'processing'].includes(runStatus)) {
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/enrichment/runs/${runId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as RunDetails;
      setRun(payload);
      const resultsResponse = await fetch(`/api/enrichment/runs/${runId}/results?page=1&pageSize=50`, {
        credentials: 'include',
      });

      if (resultsResponse.ok) {
        const resultsPayload = (await resultsResponse.json()) as { data: ResultRow[] };
        setResults(resultsPayload.data ?? []);
      }
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [runId, runStatus]);

  const onCancel = async (): Promise<void> => {
    setCanceling(true);

    const response = await fetch(`/api/enrichment/runs/${runId}/cancel`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({ message: 'Failed to cancel run' }));
      setError(responseBody.message ?? 'Failed to cancel run');
      setCanceling(false);
      return;
    }

    const runResponse = await fetch(`/api/enrichment/runs/${runId}`, {
      credentials: 'include',
    });

    if (runResponse.ok) {
      const payload = (await runResponse.json()) as RunDetails;
      setRun(payload);
    }

    setCanceling(false);
  };

  if (loading) {
    return <p>Loading enrichment run...</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!run) {
    return <p className="error">Run not found.</p>;
  }

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Enrichment Run {run.id}</h1>
        {['queued', 'processing'].includes(run.status) ? (
          <button className="button secondary" type="button" onClick={onCancel} disabled={canceling}>
            {canceling ? 'Canceling...' : 'Cancel Run'}
          </button>
        ) : null}
      </div>

      <article className="card grid" style={{ gap: '0.5rem' }}>
        <p>Status: <strong>{run.status}</strong></p>
        <p>Providers: {run.config?.providers.join(', ') || '-'}</p>
        <p>Merge policy: {run.config?.mergePolicy ?? '-'}</p>
        <p>Dry run: {run.config?.dryRun ? 'yes' : 'no'}</p>
        <p>Created: {new Date(run.createdAt).toLocaleString()}</p>
      </article>

      <article className="card grid" style={{ gap: '0.75rem' }}>
        <h2>Progress</h2>
        <div style={{ border: '1px solid #d8dee9', borderRadius: 8, overflow: 'hidden' }}>
          <div
            style={{
              width: `${percentComplete}%`,
              height: 14,
              background: '#0a9396',
              transition: 'width 0.25s linear',
            }}
          />
        </div>
        <p>{percentComplete}%</p>
        <div className="grid grid-3">
          <p>Total targets: {run.counters.totalTargets}</p>
          <p>Processed: {run.counters.processedTargets}</p>
          <p>Updated contacts: {run.counters.updatedContacts}</p>
          <p>Skipped contacts: {run.counters.skippedContacts}</p>
          <p>Errors: {run.counters.errorCount}</p>
        </div>
      </article>

      <article className="card grid" style={{ gap: '0.75rem' }}>
        <h2>Recent Changes</h2>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Contact</th>
              <th>Field</th>
              <th>Old</th>
              <th>New</th>
              <th>Provider</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.contactName ?? row.contactId}</td>
                <td>{row.field}</td>
                <td>{row.oldValue ?? '-'}</td>
                <td>{row.newValue ?? '-'}</td>
                <td>{row.provider}</td>
                <td>{row.confidence ?? '-'}</td>
              </tr>
            ))}
            {results.length === 0 ? (
              <tr>
                <td colSpan={7}>No changes yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>

      <article className="card grid" style={{ gap: '0.75rem' }}>
        <h2>Error Samples</h2>
        <ul>
          {run.errorSamples.length === 0 ? <li>No errors recorded.</li> : null}
          {run.errorSamples.map((sample) => (
            <li key={`${sample.rowIndex}-${sample.message}`}>
              Target #{sample.rowIndex}: {sample.message}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
