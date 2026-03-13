'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

type ContactMethod = {
  id: string;
  type: string;
  value: string;
  isPrimary: boolean;
};

type ContactTag = {
  category: string;
  name: string;
};

type ContactRow = {
  id: string;
  fullName: string;
  currentTitle: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  currentCompany?: { id: string; name: string } | null;
  contactMethods: ContactMethod[];
  tags: ContactTag[];
  connectorScore: number | null;
  lastEnrichedAt: string | null;
  score?: number;
  previewSnippet?: string | null;
};

type ContactsResponse = {
  data: ContactRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
};

type SearchMode = 'lexical' | 'semantic';

export default function ContactsPage() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('lexical');
  const [sortBy, setSortBy] = useState<'updated_at' | 'created_at' | 'name' | 'last_enriched' | 'connector_score'>('connector_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [importBatchId, setImportBatchId] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [tag, setTag] = useState('');
  const [missingEmail, setMissingEmail] = useState(false);
  const [missingLinkedin, setMissingLinkedin] = useState(false);
  const [missingLocation, setMissingLocation] = useState(false);
  const [lastEnrichedBeforeDays, setLastEnrichedBeforeDays] = useState('');
  const [minConnectorScore, setMinConnectorScore] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0 });
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingQuery = params.get('q') ?? '';
    setQuery(incomingQuery);
    setSearch(incomingQuery);
    setCompany(params.get('company') ?? '');
    setTitle(params.get('title') ?? '');
    setCountry(params.get('country') ?? '');
    setCity(params.get('city') ?? '');
    setTag(params.get('tag') ?? '');
    setImportBatchId(params.get('importBatchId') ?? '');
    setMissingEmail(params.get('missingEmail') === 'true');
    setMissingLinkedin(params.get('missingLinkedin') === 'true');
    setMissingLocation(params.get('missingLocation') === 'true');
    setLastEnrichedBeforeDays(params.get('lastEnrichedBeforeDays') ?? '');
    setMinConnectorScore(params.get('minConnectorScore') ?? '');
    setFiltersInitialized(true);
  }, []);

  useEffect(() => {
    const load = async (): Promise<void> => {
      if (!filtersInitialized) {
        return;
      }

      setLoading(true);
      setError(null);

      if (searchMode === 'semantic') {
        if (!search.trim()) {
          setContacts([]);
          setPagination({ page: 1, pageSize: 25, total: 0 });
          setLoading(false);
          return;
        }

        const semanticParams = new URLSearchParams({
          q: search.trim(),
          k: '20',
        });

        const semanticResponse = await fetch(`/api/search/semantic?${semanticParams.toString()}`, {
          credentials: 'include',
        });

        if (semanticResponse.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!semanticResponse.ok) {
          setError('Failed to run semantic search');
          setLoading(false);
          return;
        }

        const semanticPayload = (await semanticResponse.json()) as {
          data: Array<{
            id: string;
            name: string;
            title: string | null;
            company: string | null;
            country: string | null;
            previewSnippet: string | null;
            score: number;
          }>;
        };

        const semanticRows = (semanticPayload.data ?? []).map((item) => ({
          id: item.id,
          fullName: item.name,
          currentTitle: item.title,
          locationCity: null,
          locationCountry: item.country,
          currentCompany: item.company ? { id: item.company, name: item.company } : null,
          contactMethods: [],
          tags: [],
          connectorScore: null,
          lastEnrichedAt: null,
          score: item.score,
          previewSnippet: item.previewSnippet,
        }));

        setContacts(semanticRows);
        setPagination({ page: 1, pageSize: semanticRows.length || 20, total: semanticRows.length });
        setLoading(false);
        return;
      }

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      });
      if (search.trim()) {
        params.set('q', search.trim());
      }
      if (importBatchId.trim()) {
        params.set('importBatchId', importBatchId.trim());
      }
      if (company.trim()) {
        params.set('company', company.trim());
      }
      if (title.trim()) {
        params.set('title', title.trim());
      }
      if (country.trim()) {
        params.set('country', country.trim());
      }
      if (city.trim()) {
        params.set('city', city.trim());
      }
      if (tag.trim()) {
        params.set('tag', tag.trim());
      }
      if (missingEmail) {
        params.set('missingEmail', 'true');
      }
      if (missingLinkedin) {
        params.set('missingLinkedin', 'true');
      }
      if (missingLocation) {
        params.set('missingLocation', 'true');
      }
      if (lastEnrichedBeforeDays.trim()) {
        params.set('lastEnrichedBeforeDays', lastEnrichedBeforeDays.trim());
      }
      if (minConnectorScore.trim()) {
        params.set('minConnectorScore', minConnectorScore.trim());
      }

      const response = await fetch(`/api/contacts?${params.toString()}`, {
        credentials: 'include',
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        setError('Failed to load contacts');
        setLoading(false);
        return;
      }

      const data = (await response.json()) as ContactsResponse;
      setContacts(data.data ?? []);
      setPagination(data.pagination ?? { page, pageSize, total: 0 });
      setLoading(false);
    };

    void load();
  }, [
    filtersInitialized,
    search,
    searchMode,
    sortBy,
    sortDir,
    importBatchId,
    company,
    title,
    country,
    city,
    tag,
    missingEmail,
    missingLinkedin,
    missingLocation,
    lastEnrichedBeforeDays,
    minConnectorScore,
    page,
    pageSize,
  ]);

  const onSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setPage(1);
    setSearch(query);
  };

  const totalPages = pagination.pageSize > 0
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1;

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: '0.35rem' }}>Contacts</h1>
          <p style={{ margin: 0, color: '#475569' }}>
            Explore your network by purpose, company, geography, relationship strength, and data gaps.
          </p>
        </div>
        <Link className="button" href="/contacts/new">
          New Contact
        </Link>
      </div>

      <form onSubmit={onSearch} className="card grid" style={{ gap: '0.85rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            value={query}
            placeholder={searchMode === 'semantic' ? 'Semantic query' : 'Search name, company, notes, tags'}
            onChange={(event) => setQuery(event.target.value)}
            style={{ minWidth: 280, flex: '1 1 320px' }}
          />
          <select
            className="input"
            value={searchMode}
            onChange={(event) => {
              setSearchMode(event.target.value as SearchMode);
              setPage(1);
            }}
          >
            <option value="lexical">Lexical</option>
            <option value="semantic">Semantic</option>
          </select>
          <button className="button" type="submit">
            Search
          </button>
        </div>

        {searchMode === 'lexical' ? (
          <>
            <div
              style={{
                display: 'grid',
                gap: '0.75rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              <input className="input" value={company} placeholder="Company" onChange={(event) => { setCompany(event.target.value); setPage(1); }} />
              <input className="input" value={title} placeholder="Title" onChange={(event) => { setTitle(event.target.value); setPage(1); }} />
              <input className="input" value={tag} placeholder="Tag or purpose (e.g. purpose:investor)" onChange={(event) => { setTag(event.target.value); setPage(1); }} />
              <input className="input" value={country} placeholder="Country" onChange={(event) => { setCountry(event.target.value); setPage(1); }} />
              <input className="input" value={city} placeholder="City" onChange={(event) => { setCity(event.target.value); setPage(1); }} />
              <input className="input" value={importBatchId} placeholder="Import batch UUID" onChange={(event) => { setImportBatchId(event.target.value); setPage(1); }} />
              <input className="input" value={lastEnrichedBeforeDays} placeholder="Stale after days" onChange={(event) => { setLastEnrichedBeforeDays(event.target.value); setPage(1); }} />
              <input className="input" value={minConnectorScore} placeholder="Min connector score" onChange={(event) => { setMinConnectorScore(event.target.value); setPage(1); }} />
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <label>
                <input type="checkbox" checked={missingEmail} onChange={(event) => { setMissingEmail(event.target.checked); setPage(1); }} /> Missing email
              </label>
              <label>
                <input type="checkbox" checked={missingLinkedin} onChange={(event) => { setMissingLinkedin(event.target.checked); setPage(1); }} /> Missing LinkedIn
              </label>
              <label>
                <input type="checkbox" checked={missingLocation} onChange={(event) => { setMissingLocation(event.target.checked); setPage(1); }} /> Missing location
              </label>
              <select
                className="input"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value as 'updated_at' | 'created_at' | 'name' | 'last_enriched' | 'connector_score');
                  setPage(1);
                }}
              >
                <option value="connector_score">Sort: Connector score</option>
                <option value="updated_at">Sort: Updated</option>
                <option value="created_at">Sort: Created</option>
                <option value="name">Sort: Name</option>
                <option value="last_enriched">Sort: Last enriched</option>
              </select>
              <select className="input" value={sortDir} onChange={(event) => setSortDir(event.target.value as 'asc' | 'desc')}>
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </>
        ) : null}
      </form>

      <div className="card">
        {loading ? <p>Loading contacts...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && !error ? (
          <>
            <div style={{ marginBottom: '0.75rem', color: '#475569' }}>
              {pagination.total} contact{pagination.total === 1 ? '' : 's'} found
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Tags / Purpose</th>
                  <th>{searchMode === 'semantic' ? 'Semantic score' : 'Relationship signal'}</th>
                  <th>{searchMode === 'semantic' ? 'Preview' : 'Primary email'}</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const email =
                    contact.contactMethods.find((method) => method.type === 'EMAIL')
                    ?? contact.contactMethods.find((method) => method.type === 'email');

                  return (
                    <tr key={contact.id}>
                      <td>
                        <Link href={`/contacts/${contact.id}`}>{contact.fullName}</Link>
                        <div style={{ fontSize: '0.85rem', color: '#475569' }}>
                          {[contact.currentTitle, [contact.locationCity, contact.locationCountry].filter(Boolean).join(', ')].filter(Boolean).join(' | ') || '-'}
                        </div>
                      </td>
                      <td>{contact.currentCompany?.name ?? '-'}</td>
                      <td>
                        {contact.tags.length > 0 ? (
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {contact.tags.slice(0, 4).map((item) => (
                              <span
                                key={`${contact.id}-${item.category}-${item.name}`}
                                style={{
                                  border: '1px solid #cbd5e1',
                                  borderRadius: 999,
                                  padding: '0.15rem 0.5rem',
                                  fontSize: '0.8rem',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {item.category}: {item.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>
                        {searchMode === 'semantic'
                          ? contact.score?.toFixed(3) ?? '-'
                          : contact.connectorScore?.toFixed(2) ?? 'Unscored'}
                      </td>
                      <td>
                        {searchMode === 'semantic'
                          ? contact.previewSnippet ?? '-'
                          : email?.value ?? '-'}
                      </td>
                    </tr>
                  );
                })}
                {contacts.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No contacts found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            {searchMode === 'lexical' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ color: '#475569' }}>
                  Page {pagination.page} of {totalPages}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="button secondary" type="button" disabled={pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                    Previous
                  </button>
                  <button className="button secondary" type="button" disabled={pagination.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
