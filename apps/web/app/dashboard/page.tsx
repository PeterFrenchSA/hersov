'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type DashboardResponse = {
  totalContacts: number;
  missingEmail: number;
  missingLinkedin: number;
  missingLocation: number;
  pendingReviewItems: number;
  topConnectors: Array<{ contactId: string; fullName: string; connectorScore: number }>;
  recentImports: Array<{ id: string; filename: string; status: string; processedRows: number; createdAt: string }>;
  recentEnrichmentRuns: Array<{ id: string; status: string; updatedContacts: number; createdAt: string }>;
};

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/dashboard', {
        credentials: 'include',
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        setError('Failed to load dashboard.');
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as DashboardResponse;
      setDashboard(payload);
      setLoading(false);
    };

    void load();
  }, []);

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <div>
        <h1 style={{ marginBottom: '0.35rem' }}>Relationship Dashboard</h1>
        <p style={{ margin: 0, color: '#475569' }}>
          Executive overview of coverage, gaps, review workload, and the strongest nodes in your network.
        </p>
      </div>

      {loading ? <p>Loading dashboard...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && dashboard ? (
        <>
          <div className="grid grid-3">
            <article className="card">
              <h2>Total contacts</h2>
              <p style={{ fontSize: '2rem', margin: 0 }}>{dashboard.totalContacts}</p>
            </article>
            <article className="card">
              <h2>Pending review</h2>
              <p style={{ fontSize: '2rem', margin: 0 }}>{dashboard.pendingReviewItems}</p>
              <Link href="/review">Open review queue</Link>
            </article>
            <article className="card">
              <h2>Network exploration</h2>
              <p style={{ margin: 0 }}>Use connector scores, purpose tags, and relationship tabs to navigate the network.</p>
            </article>
          </div>

          <div className="grid grid-3">
            <article className="card">
              <h2>Missing email</h2>
              <p style={{ fontSize: '2rem', margin: 0 }}>{dashboard.missingEmail}</p>
              <Link href="/contacts?missingEmail=true">Open filtered contacts</Link>
            </article>
            <article className="card">
              <h2>Missing LinkedIn</h2>
              <p style={{ fontSize: '2rem', margin: 0 }}>{dashboard.missingLinkedin}</p>
              <Link href="/contacts?missingLinkedin=true">Find candidates</Link>
            </article>
            <article className="card">
              <h2>Missing location</h2>
              <p style={{ fontSize: '2rem', margin: 0 }}>{dashboard.missingLocation}</p>
              <Link href="/contacts?missingLocation=true">Review data gaps</Link>
            </article>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <article className="card">
              <h2 style={{ marginTop: 0 }}>Top connectors</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Connector score</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.topConnectors.map((row) => (
                    <tr key={row.contactId}>
                      <td><Link href={`/contacts/${row.contactId}`}>{row.fullName}</Link></td>
                      <td>{row.connectorScore.toFixed(2)}</td>
                    </tr>
                  ))}
                  {dashboard.topConnectors.length === 0 ? (
                    <tr>
                      <td colSpan={2}>No connector scores yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </article>

            <div className="grid" style={{ gap: '1rem' }}>
              <article className="card">
                <h2 style={{ marginTop: 0 }}>Recent imports</h2>
                <ul>
                  {dashboard.recentImports.map((item) => (
                    <li key={item.id}>
                      {item.filename} [{item.status}] {item.processedRows} rows
                    </li>
                  ))}
                  {dashboard.recentImports.length === 0 ? <li>No imports yet.</li> : null}
                </ul>
              </article>

              <article className="card">
                <h2 style={{ marginTop: 0 }}>Recent enrichment runs</h2>
                <ul>
                  {dashboard.recentEnrichmentRuns.map((item) => (
                    <li key={item.id}>
                      <Link href={`/enrichment/${item.id}`}>{item.status}</Link> updated {item.updatedContacts}
                    </li>
                  ))}
                  {dashboard.recentEnrichmentRuns.length === 0 ? <li>No enrichment runs yet.</li> : null}
                </ul>
              </article>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
