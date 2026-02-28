'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ReviewRow = {
  id: string;
  kind: string;
  status: string;
  payloadJson: Record<string, unknown>;
  createdByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type ReviewResponse = {
  data: ReviewRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
};

export default function ReviewPage() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [kind, setKind] = useState<'all' | 'tag' | 'entity' | 'relationship' | 'linkedin_profile'>('all');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? rows[0] ?? null, [rows, selectedId]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      status,
      page: '1',
      pageSize: '100',
    });
    if (kind !== 'all') {
      params.set('kind', kind);
    }

    const response = await fetch(`/api/review?${params.toString()}`, {
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (response.status === 403) {
      setError('Admin or Analyst role required.');
      setLoading(false);
      return;
    }

    if (!response.ok) {
      setError('Failed to load review queue.');
      setLoading(false);
      return;
    }

    const payload = (await response.json()) as ReviewResponse;
    setRows(payload.data ?? []);
    setSelectedId((current) => current ?? payload.data?.[0]?.id ?? null);
    setLoading(false);
  }, [kind, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitDecision = async (action: 'approve' | 'reject'): Promise<void> => {
    if (!selected) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const response = await fetch(`/api/review/${selected.id}/${action}`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: `Failed to ${action} review item` }));
      setError(body.message ?? `Failed to ${action} review item`);
      setSubmitting(false);
      return;
    }

    await load();
    setSubmitting(false);
  };

  const evidenceSnippet = typeof selected?.payloadJson?.evidenceSnippet === 'string'
    ? selected.payloadJson.evidenceSnippet
    : '';

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>Review Queue</h1>
      <p>Approve or reject AI-generated tag/entity/relationship/LinkedIn profile suggestions before canonical use.</p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value as 'pending' | 'approved' | 'rejected')}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="input" value={kind} onChange={(event) => setKind(event.target.value as 'all' | 'tag' | 'entity' | 'relationship' | 'linkedin_profile')}>
          <option value="all">All kinds</option>
          <option value="tag">Tag</option>
          <option value="entity">Entity</option>
          <option value="relationship">Relationship</option>
          <option value="linkedin_profile">LinkedIn profile</option>
        </select>
      </div>

      {loading ? <p>Loading review queue...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading ? (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: '1rem' }}>
          <aside className="card grid" style={{ gap: '0.5rem', maxHeight: 640, overflowY: 'auto' }}>
            {rows.length === 0 ? <p>No review items for selected filters.</p> : null}
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`button ${selected?.id === row.id ? '' : 'secondary'}`}
                style={{ textAlign: 'left' }}
                onClick={() => setSelectedId(row.id)}
              >
                <div>
                  <strong>{row.kind}</strong> [{row.status}]
                </div>
                <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                  {new Date(row.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </aside>

          <article className="card grid" style={{ gap: '0.75rem' }}>
            {!selected ? <p>Select an item to inspect.</p> : null}
            {selected ? (
              <>
                <h2 style={{ margin: 0 }}>
                  {selected.kind} [{selected.status}]
                </h2>
                {evidenceSnippet ? (
                  <p>
                    <strong>Evidence:</strong> {evidenceSnippet}
                  </p>
                ) : null}
                <pre style={{ margin: 0, overflowX: 'auto' }}>{JSON.stringify(selected.payloadJson, null, 2)}</pre>

                {selected.status === 'pending' ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="button" disabled={submitting} onClick={() => void submitDecision('approve')}>
                      {submitting ? 'Submitting...' : 'Approve'}
                    </button>
                    <button className="button secondary" disabled={submitting} onClick={() => void submitDecision('reject')}>
                      {submitting ? 'Submitting...' : 'Reject'}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </article>
        </div>
      ) : null}
    </section>
  );
}
