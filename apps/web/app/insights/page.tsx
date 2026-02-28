'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type InsightsDashboardResponse = {
  topTags: Array<{ category: string; value: string; count: number }>;
  topEvents: Array<{ entityId: string; name: string; count: number }>;
  topLocations: Array<{ entityId: string; name: string; count: number }>;
  topConnectors: Array<{ contactId: string; fullName: string; connectorScore: number; computedAt: string }>;
};

export default function InsightsDashboardPage() {
  const [dashboard, setDashboard] = useState<InsightsDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const response = await fetch('/api/insights/dashboard?limit=15', {
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      setError('Failed to load insights dashboard.');
      setLoading(false);
      return;
    }

    const payload = (await response.json()) as InsightsDashboardResponse;
    setDashboard(payload);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const recomputeScores = async (): Promise<void> => {
    setRecomputing(true);
    setError(null);

    const response = await fetch('/api/graph/recompute', {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'Failed to queue graph recompute' }));
      setError(body.message ?? 'Failed to queue graph recompute');
      setRecomputing(false);
      return;
    }

    setRecomputing(false);
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>Insights Dashboard</h1>
      <p>Aggregated approved tags/entities and connector scores from reviewed network intelligence.</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="button" onClick={() => void recomputeScores()} disabled={recomputing}>
          {recomputing ? 'Queueing recompute...' : 'Recompute Connector Scores'}
        </button>
        <Link className="button secondary" href="/review">
          Open Review Queue
        </Link>
      </div>

      {loading ? <p>Loading dashboard...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && dashboard ? (
        <div className="grid" style={{ gap: '1rem' }}>
          <article className="card">
            <h2 style={{ marginTop: 0 }}>Top connectors</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Connector score</th>
                  <th>Computed at</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.topConnectors.map((row) => (
                  <tr key={row.contactId}>
                    <td>
                      <Link href={`/contacts/${row.contactId}`}>{row.fullName}</Link>
                    </td>
                    <td>{row.connectorScore.toFixed(2)}</td>
                    <td>{new Date(row.computedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {dashboard.topConnectors.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No connector scores yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </article>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            <article className="card">
              <h3 style={{ marginTop: 0 }}>Top tags</h3>
              <ul>
                {dashboard.topTags.map((tag) => (
                  <li key={`${tag.category}:${tag.value}`}>
                    {tag.category} / {tag.value} ({tag.count})
                  </li>
                ))}
                {dashboard.topTags.length === 0 ? <li>No approved tags yet.</li> : null}
              </ul>
            </article>

            <article className="card">
              <h3 style={{ marginTop: 0 }}>Top events</h3>
              <ul>
                {dashboard.topEvents.map((event) => (
                  <li key={event.entityId}>
                    {event.name} ({event.count})
                  </li>
                ))}
                {dashboard.topEvents.length === 0 ? <li>No approved events yet.</li> : null}
              </ul>
            </article>

            <article className="card">
              <h3 style={{ marginTop: 0 }}>Top locations</h3>
              <ul>
                {dashboard.topLocations.map((location) => (
                  <li key={location.entityId}>
                    {location.name} ({location.count})
                  </li>
                ))}
                {dashboard.topLocations.length === 0 ? <li>No approved locations yet.</li> : null}
              </ul>
            </article>
          </div>
        </div>
      ) : null}
    </section>
  );
}
