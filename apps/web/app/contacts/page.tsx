'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

type ContactMethod = {
  id: string;
  type: string;
  value: string;
  isPrimary: boolean;
};

type Contact = {
  id: string;
  fullName: string;
  currentCompany?: { name: string } | null;
  contactMethods: ContactMethod[];
};

export default function ContactsPage(): JSX.Element {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'updated_at' | 'created_at' | 'name'>('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [importBatchId, setImportBatchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ page: '1', pageSize: '20' });
      if (search.trim()) {
        params.set('q', search.trim());
      }
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      if (importBatchId.trim()) {
        params.set('importBatchId', importBatchId.trim());
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

      const data = (await response.json()) as { data: Contact[] };
      setContacts(data.data ?? []);
      setLoading(false);
    };

    void load();
  }, [search, sortBy, sortDir, importBatchId]);

  const onSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSearch(query);
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>Contacts</h1>
      <form onSubmit={onSearch} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className="input"
          value={query}
          placeholder="Search by name or company"
          onChange={(event) => setQuery(event.target.value)}
        />
        <input
          className="input"
          value={importBatchId}
          placeholder="Import batch UUID (optional)"
          onChange={(event) => setImportBatchId(event.target.value)}
        />
        <select className="input" value={sortBy} onChange={(event) => setSortBy(event.target.value as 'updated_at' | 'created_at' | 'name')}>
          <option value="updated_at">Sort: Updated</option>
          <option value="created_at">Sort: Created</option>
          <option value="name">Sort: Name</option>
        </select>
        <select className="input" value={sortDir} onChange={(event) => setSortDir(event.target.value as 'asc' | 'desc')}>
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
        <button className="button" type="submit">
          Search
        </button>
      </form>

      <div className="card">
        {loading ? <p>Loading contacts...</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {!loading && !error ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Primary email</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const email = contact.contactMethods.find((method) => method.type === 'EMAIL');
                return (
                  <tr key={contact.id}>
                    <td>
                      <Link href={`/contacts/${contact.id}`}>{contact.fullName}</Link>
                    </td>
                    <td>{contact.currentCompany?.name ?? '-'}</td>
                    <td>{email?.value ?? '-'}</td>
                  </tr>
                );
              })}
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={3}>No contacts found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
