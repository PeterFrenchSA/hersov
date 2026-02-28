'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type ContactMethod = {
  id: string;
  type: string;
  value: string;
  isPrimary: boolean;
};

type Contact = {
  id: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  currentTitle?: string | null;
  locationCity?: string | null;
  locationCountry?: string | null;
  notesRaw?: string | null;
  currentCompany?: { name: string } | null;
  contactMethods: ContactMethod[];
};

type ContactInsightsResponse = {
  contactId: string;
  insights: unknown | null;
  provenance: {
    model: string;
    promptVersion: string;
    confidenceOverall: number;
    updatedAt: string;
  } | null;
  approvedEntities: Array<{
    mentionId: string;
    entityId: string;
    type: string;
    name: string;
    confidence: number;
    evidenceSnippet: string;
    createdAt: string;
  }>;
  pendingReviewCount: number;
};

type ContactNetworkResponse = {
  contactId: string;
  approvedRelationships: Array<{
    id: string;
    type: string;
    confidence: number;
    evidenceSnippet: string;
    counterparty: { id: string; fullName: string } | null;
    entity: { id: string; type: string; name: string } | null;
    createdAt: string;
  }>;
  sharedEntities: Array<{
    entityId: string;
    type: string;
    name: string;
    count: number;
    why: string[];
    sharedWith: Array<{ contactId: string; fullName: string }>;
  }>;
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

type TabKey = 'profile' | 'insights' | 'network';

export default function ContactDetailsPage() {
  const params = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [insights, setInsights] = useState<ContactInsightsResponse | null>(null);
  const [network, setNetwork] = useState<ContactNetworkResponse | null>(null);
  const [linkedinSuggestions, setLinkedinSuggestions] = useState<LinkedinSuggestion[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const [error, setError] = useState<string | null>(null);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);
  const [linkedinSubmitting, setLinkedinSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      const [contactResponse, insightsResponse, networkResponse, linkedinResponse] = await Promise.all([
        fetch(`/api/contacts/${params.id}`, { credentials: 'include' }),
        fetch(`/api/contacts/${params.id}/insights`, { credentials: 'include' }),
        fetch(`/api/contacts/${params.id}/network`, { credentials: 'include' }),
        fetch(`/api/linkedin/match/suggestions?contactId=${params.id}&page=1&pageSize=20`, {
          credentials: 'include',
        }),
      ]);

      if (
        contactResponse.status === 401
        || insightsResponse.status === 401
        || networkResponse.status === 401
        || linkedinResponse.status === 401
      ) {
        window.location.href = '/login';
        return;
      }

      if (!contactResponse.ok) {
        setError('Failed to load contact');
        setLoading(false);
        return;
      }

      const contactData = (await contactResponse.json()) as Contact;
      setContact(contactData);

      if (insightsResponse.ok) {
        const insightsData = (await insightsResponse.json()) as ContactInsightsResponse;
        setInsights(insightsData);
      } else {
        setInsights(null);
      }

      if (networkResponse.ok) {
        const networkData = (await networkResponse.json()) as ContactNetworkResponse;
        setNetwork(networkData);
      } else {
        setNetwork(null);
      }

      if (linkedinResponse.ok) {
        const linkedinData = (await linkedinResponse.json()) as LinkedinSuggestionsResponse;
        setLinkedinSuggestions(linkedinData.data ?? []);
        setLinkedinError(null);
      } else {
        setLinkedinSuggestions([]);
        setLinkedinError('Failed to load LinkedIn suggestions.');
      }

      setLoading(false);
    };

    void load();
  }, [params.id]);

  if (loading) {
    return <p>Loading contact...</p>;
  }

  if (error || !contact) {
    return <p className="error">{error ?? 'Contact not found'}</p>;
  }

  const refreshLinkedinSuggestions = async (): Promise<void> => {
    const response = await fetch(`/api/linkedin/match/suggestions?contactId=${params.id}&page=1&pageSize=20`, {
      credentials: 'include',
    });

    if (response.status === 401) {
      setLinkedinSubmitting(false);
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      setLinkedinError('Failed to load LinkedIn suggestions.');
      return;
    }

    const payload = (await response.json()) as LinkedinSuggestionsResponse;
    setLinkedinSuggestions(payload.data ?? []);
    setLinkedinError(null);
  };

  const runLinkedinMatch = async (): Promise<void> => {
    setLinkedinSubmitting(true);
    setLinkedinError(null);

    const response = await fetch(`/api/linkedin/match/contact/${params.id}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (response.status === 401) {
      setLinkedinSubmitting(false);
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'Failed to start LinkedIn match.' }));
      setLinkedinError(body.message ?? 'Failed to start LinkedIn match.');
      setLinkedinSubmitting(false);
      return;
    }

    await refreshLinkedinSuggestions();
    setLinkedinSubmitting(false);
  };

  const decideLinkedinSuggestion = async (
    reviewQueueId: string | null,
    action: 'approve' | 'reject',
  ): Promise<void> => {
    if (!reviewQueueId) {
      return;
    }

    setLinkedinSubmitting(true);
    setLinkedinError(null);

    const response = await fetch(`/api/review/${reviewQueueId}/${action}`, {
      method: 'POST',
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: `Failed to ${action} suggestion.` }));
      setLinkedinError(body.message ?? `Failed to ${action} suggestion.`);
      setLinkedinSubmitting(false);
      return;
    }

    await refreshLinkedinSuggestions();
    setLinkedinSubmitting(false);
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>{contact.fullName}</h1>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className={`button ${activeTab === 'profile' ? '' : 'secondary'}`} onClick={() => setActiveTab('profile')}>
          Profile
        </button>
        <button type="button" className={`button ${activeTab === 'insights' ? '' : 'secondary'}`} onClick={() => setActiveTab('insights')}>
          Insights
        </button>
        <button type="button" className={`button ${activeTab === 'network' ? '' : 'secondary'}`} onClick={() => setActiveTab('network')}>
          Network
        </button>
      </div>

      {activeTab === 'profile' ? (
        <>
          <article className="card">
            <p>
              <strong>Company:</strong> {contact.currentCompany?.name ?? '-'}
            </p>
            <p>
              <strong>Title:</strong> {contact.currentTitle ?? '-'}
            </p>
            <p>
              <strong>Location:</strong> {[contact.locationCity, contact.locationCountry].filter(Boolean).join(', ') || '-'}
            </p>
            <p>
              <strong>Notes:</strong> {contact.notesRaw ?? '-'}
            </p>
          </article>
          <article className="card">
            <h2>Contact methods</h2>
            <ul>
              {contact.contactMethods.length === 0 ? <li>No contact methods recorded.</li> : null}
              {contact.contactMethods.map((method) => (
                <li key={method.id}>
                  {method.type}: {method.value} {method.isPrimary ? '(primary)' : ''}
                </li>
              ))}
            </ul>
          </article>
          <article className="card grid" style={{ gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>LinkedIn match suggestions</h2>
              <button
                type="button"
                className="button"
                onClick={() => void runLinkedinMatch()}
                disabled={linkedinSubmitting}
              >
                {linkedinSubmitting ? 'Running...' : 'Find LinkedIn Matches'}
              </button>
            </div>

            {linkedinError ? <p className="error">{linkedinError}</p> : null}
            {linkedinSuggestions.length === 0 ? <p>No LinkedIn suggestions yet.</p> : null}

            {linkedinSuggestions.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Profile</th>
                    <th>Headline</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedinSuggestions.map((suggestion) => (
                    <tr key={suggestion.id}>
                      <td>
                        <a href={suggestion.profileUrl} target="_blank" rel="noreferrer">
                          {suggestion.profileName || suggestion.profileUrl}
                        </a>
                      </td>
                      <td>{suggestion.headline ?? suggestion.currentCompany ?? '-'}</td>
                      <td>{suggestion.score.toFixed(3)}</td>
                      <td>{suggestion.status}</td>
                      <td>
                        {suggestion.status === 'pending' && suggestion.reviewQueueId ? (
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              type="button"
                              className="button"
                              disabled={linkedinSubmitting}
                              onClick={() => void decideLinkedinSuggestion(suggestion.reviewQueueId, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={linkedinSubmitting}
                              onClick={() => void decideLinkedinSuggestion(suggestion.reviewQueueId, 'reject')}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          '-'
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

      {activeTab === 'insights' ? (
        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Insights</h2>
          {!insights?.provenance ? <p>No processed insights yet.</p> : null}
          {insights?.provenance ? (
            <>
              <p>
                Model: <strong>{insights.provenance.model}</strong> | Prompt:{' '}
                <strong>{insights.provenance.promptVersion}</strong> | Confidence:{' '}
                <strong>{insights.provenance.confidenceOverall.toFixed(3)}</strong>
              </p>
              <p>Updated: {new Date(insights.provenance.updatedAt).toLocaleString()}</p>
              <p>Pending review items: {insights.pendingReviewCount}</p>
              <div>
                <strong>Raw extraction JSON</strong>
                <pre className="card" style={{ overflowX: 'auto' }}>
                  {JSON.stringify(insights.insights, null, 2)}
                </pre>
              </div>
            </>
          ) : null}

          <div>
            <h3>Approved entity mentions</h3>
            {insights?.approvedEntities.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Confidence</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.approvedEntities.map((item) => (
                    <tr key={item.mentionId}>
                      <td>{item.type}</td>
                      <td>{item.name}</td>
                      <td>{item.confidence.toFixed(3)}</td>
                      <td>{item.evidenceSnippet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No approved entities yet.</p>
            )}
          </div>
        </article>
      ) : null}

      {activeTab === 'network' ? (
        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Network</h2>

          <div>
            <h3>Approved relationships</h3>
            {network?.approvedRelationships.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Counterparty</th>
                    <th>Entity</th>
                    <th>Confidence</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {network.approvedRelationships.map((relationship) => (
                    <tr key={relationship.id}>
                      <td>{relationship.type}</td>
                      <td>
                        {relationship.counterparty ? (
                          <Link href={`/contacts/${relationship.counterparty.id}`}>{relationship.counterparty.fullName}</Link>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>{relationship.entity ? `${relationship.entity.name} (${relationship.entity.type})` : '-'}</td>
                      <td>{relationship.confidence.toFixed(3)}</td>
                      <td>{relationship.evidenceSnippet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No approved relationships yet.</p>
            )}
          </div>

          <div>
            <h3>Shared entities/events</h3>
            {network?.sharedEntities.length ? (
              <div className="grid" style={{ gap: '0.5rem' }}>
                {network.sharedEntities.map((item) => (
                  <article key={item.entityId} style={{ border: '1px solid #d8dee9', borderRadius: 8, padding: '0.6rem' }}>
                    <p style={{ margin: 0 }}>
                      <strong>{item.name}</strong> ({item.type}) shared with {item.count} contact(s)
                    </p>
                    <p style={{ margin: '0.35rem 0' }}>
                      Shared with:{' '}
                      {item.sharedWith.map((peer, index) => (
                        <span key={peer.contactId}>
                          {index > 0 ? ', ' : null}
                          <Link href={`/contacts/${peer.contactId}`}>{peer.fullName}</Link>
                        </span>
                      ))}
                    </p>
                    {item.why.length ? (
                      <ul style={{ margin: 0 }}>
                        {item.why.map((reason, index) => (
                          <li key={`${item.entityId}-${index}`}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p>No shared entities yet.</p>
            )}
          </div>
        </article>
      ) : null}
    </section>
  );
}
