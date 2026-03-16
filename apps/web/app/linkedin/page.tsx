'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

type LinkedinStatusResponse = {
  provider: {
    provider: 'serpapi' | 'brave' | 'google_custom_search';
    name: string;
    label: string;
    configured: boolean;
    envVars: string[];
    apiUrl: string;
  };
  totals: {
    contactsMissingLinkedin: number;
    pendingSuggestions: number;
    approvedSuggestions: number;
    rejectedSuggestions: number;
    suggestedContacts: number;
  };
  lastSuggestionAt: string | null;
};

type LinkedinSuggestion = {
  id: string;
  contactId: string;
  contactName: string;
  provider: string;
  profileUrl: string;
  profileName: string;
  headline: string | null;
  location: string | null;
  currentCompany: string | null;
  score: number;
  evidenceSnippet: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewQueueId: string | null;
  createdAt: string;
  updatedAt: string;
};

type LinkedinSuggestionsResponse = {
  data: LinkedinSuggestion[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
};

export default function LinkedinPage() {
  const [status, setStatus] = useState<LinkedinStatusResponse | null>(null);
  const [suggestions, setSuggestions] = useState<LinkedinSuggestion[]>([]);
  const [suggestionFilter, setSuggestionFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);

  const [missingLinkedinOnly, setMissingLinkedinOnly] = useState(true);
  const [country, setCountry] = useState('');
  const [importedBatchId, setImportedBatchId] = useState('');
  const [limit, setLimit] = useState('500');
  const [maxResultsPerContact, setMaxResultsPerContact] = useState('5');
  const [force, setForce] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    const [statusResponse, suggestionsResponse] = await Promise.all([
      fetch('/api/linkedin/match/status', { credentials: 'include' }),
      fetch(`/api/linkedin/match/suggestions?status=${suggestionFilter}&page=1&pageSize=50`, {
        credentials: 'include',
      }),
    ]);

    if (statusResponse.status === 401 || suggestionsResponse.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (statusResponse.status === 403 || suggestionsResponse.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }

    if (!statusResponse.ok || !suggestionsResponse.ok) {
      setError('Failed to load LinkedIn matching tools.');
      setLoading(false);
      return;
    }

    const statusPayload = (await statusResponse.json()) as LinkedinStatusResponse;
    const suggestionsPayload = (await suggestionsResponse.json()) as LinkedinSuggestionsResponse;

    setStatus(statusPayload);
    setSuggestions(suggestionsPayload.data ?? []);
    setLoading(false);
  }, [suggestionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const startBackfill = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setQueueMessage(null);

    const response = await fetch('/api/linkedin/match/backfill', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        missingLinkedinOnly,
        ...(country.trim() ? { country: country.trim() } : {}),
        ...(importedBatchId.trim() ? { importedBatchId: importedBatchId.trim() } : {}),
        limit: Number(limit) || 500,
        force,
        maxResultsPerContact: Number(maxResultsPerContact) || 5,
      }),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (response.status === 403) {
      setForbidden(true);
      setSubmitting(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'Failed to queue LinkedIn bulk match.' }));
      setError(body.message ?? 'Failed to queue LinkedIn bulk match.');
      setSubmitting(false);
      return;
    }

    const body = (await response.json()) as { jobId: string };
    setQueueMessage(`Bulk LinkedIn match queued (${body.jobId}). Refresh this page in a minute for new suggestions.`);
    await load();
    setSubmitting(false);
  };

  const decideSuggestion = async (reviewQueueId: string | null, action: 'approve' | 'reject'): Promise<void> => {
    if (!reviewQueueId) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const response = await fetch(`/api/review/${reviewQueueId}/${action}`, {
      method: 'POST',
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (response.status === 403) {
      setForbidden(true);
      setSubmitting(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: `Failed to ${action} suggestion.` }));
      setError(body.message ?? `Failed to ${action} suggestion.`);
      setSubmitting(false);
      return;
    }

    await load();
    setSubmitting(false);
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: '0.35rem' }}>LinkedIn Matching</h1>
          <p style={{ margin: 0, color: '#475569' }}>
            Run low-cost bulk LinkedIn discovery, then approve or reject matches before they become canonical.
          </p>
        </div>
        <Link className="button secondary" href="/review">
          Open Review Queue
        </Link>
      </div>

      {loading ? <p>Loading LinkedIn tools...</p> : null}
      {forbidden ? <p className="error">Admin or Analyst role required.</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {queueMessage ? <p>{queueMessage}</p> : null}

      {!loading && !forbidden && status ? (
        <>
          <div className="grid grid-3">
            <article className="card">
              <h2 style={{ marginTop: 0 }}>Provider</h2>
              <p style={{ marginBottom: '0.35rem' }}>
                <strong>{status.provider.label}</strong>
              </p>
              <p style={{ margin: 0 }}>Configured: {status.provider.configured ? 'Yes' : 'No'}</p>
              <p style={{ margin: '0.35rem 0 0' }}>Env vars: {status.provider.envVars.join(', ')}</p>
            </article>
            <article className="card">
              <h2 style={{ marginTop: 0 }}>Coverage gap</h2>
              <p style={{ fontSize: '2rem', margin: 0 }}>{status.totals.contactsMissingLinkedin}</p>
              <p style={{ margin: '0.35rem 0 0', color: '#475569' }}>contacts still missing LinkedIn</p>
            </article>
            <article className="card">
              <h2 style={{ marginTop: 0 }}>Pending review</h2>
              <p style={{ fontSize: '2rem', margin: 0 }}>{status.totals.pendingSuggestions}</p>
              <p style={{ margin: '0.35rem 0 0', color: '#475569' }}>matches waiting for approval</p>
            </article>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1.1fr 1fr', gap: '1rem' }}>
            <article className="card grid" style={{ gap: '0.75rem' }}>
              <h2 style={{ margin: 0 }}>Bulk match run</h2>
              <p style={{ margin: 0, color: '#475569' }}>
                Queue LinkedIn discovery across a slice of the CRM instead of running contact-by-contact.
              </p>

              <form className="grid" style={{ gap: '0.75rem' }} onSubmit={startBackfill}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={missingLinkedinOnly}
                      onChange={(event) => setMissingLinkedinOnly(event.target.checked)}
                    />{' '}
                    Missing LinkedIn only
                  </label>
                  <label>
                    <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} /> Force refresh
                  </label>
                </div>

                <div className="grid grid-3">
                  <label>
                    Country
                    <input className="input" value={country} onChange={(event) => setCountry(event.target.value)} />
                  </label>
                  <label>
                    Imported batch UUID
                    <input className="input" value={importedBatchId} onChange={(event) => setImportedBatchId(event.target.value)} />
                  </label>
                  <label>
                    Limit
                    <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} />
                  </label>
                  <label>
                    Max results per contact
                    <input
                      className="input"
                      value={maxResultsPerContact}
                      onChange={(event) => setMaxResultsPerContact(event.target.value)}
                    />
                  </label>
                </div>

                <button className="button" type="submit" disabled={submitting || !status.provider.configured}>
                  {submitting ? 'Queueing...' : 'Queue Bulk LinkedIn Match'}
                </button>
                {!status.provider.configured ? (
                  <p className="error" style={{ margin: 0 }}>
                    Configure the selected provider first. Current API URL: {status.provider.apiUrl}
                  </p>
                ) : null}
              </form>
            </article>

            <article className="card grid" style={{ gap: '0.75rem' }}>
              <h2 style={{ margin: 0 }}>Pipeline snapshot</h2>
              <div className="grid grid-3">
                <div>
                  <strong>{status.totals.approvedSuggestions}</strong>
                  <div style={{ color: '#475569' }}>approved suggestions</div>
                </div>
                <div>
                  <strong>{status.totals.rejectedSuggestions}</strong>
                  <div style={{ color: '#475569' }}>rejected suggestions</div>
                </div>
                <div>
                  <strong>{status.totals.suggestedContacts}</strong>
                  <div style={{ color: '#475569' }}>contacts with suggestions</div>
                </div>
              </div>
              <p style={{ margin: 0 }}>
                Last suggestion created:{' '}
                {status.lastSuggestionAt ? new Date(status.lastSuggestionAt).toLocaleString() : 'No suggestions yet'}
              </p>
              <p style={{ margin: 0, color: '#475569' }}>
                Search query quality is now biased toward LinkedIn profile pages and uses name, company, title, country, and email/domain where available.
              </p>
            </article>
          </div>

          <article className="card grid" style={{ gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0 }}>Suggestions</h2>
                <p style={{ margin: '0.35rem 0 0', color: '#475569' }}>
                  Latest LinkedIn candidates across the CRM, ready for review.
                </p>
              </div>
              <select
                className="input"
                value={suggestionFilter}
                onChange={(event) => setSuggestionFilter(event.target.value as 'pending' | 'approved' | 'rejected')}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {suggestions.length === 0 ? <p>No suggestions for the selected filter yet.</p> : null}

            {suggestions.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Candidate</th>
                    <th>Provider</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((suggestion) => (
                    <tr key={suggestion.id}>
                      <td>
                        <Link href={`/contacts/${suggestion.contactId}`}>{suggestion.contactName}</Link>
                      </td>
                      <td>
                        <a href={suggestion.profileUrl} target="_blank" rel="noreferrer">
                          {suggestion.profileName || suggestion.profileUrl}
                        </a>
                        <div style={{ color: '#475569', fontSize: '0.9rem' }}>
                          {suggestion.headline ?? suggestion.currentCompany ?? suggestion.location ?? '-'}
                        </div>
                      </td>
                      <td>{suggestion.provider}</td>
                      <td>{suggestion.score.toFixed(3)}</td>
                      <td>{suggestion.status}</td>
                      <td>
                        {suggestion.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="button"
                              disabled={submitting || !suggestion.reviewQueueId}
                              onClick={() => void decideSuggestion(suggestion.reviewQueueId, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={submitting || !suggestion.reviewQueueId}
                              onClick={() => void decideSuggestion(suggestion.reviewQueueId, 'reject')}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          suggestion.evidenceSnippet ?? '-'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </article>
        </>
      ) : null}
    </section>
  );
}
