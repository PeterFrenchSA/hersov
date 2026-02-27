'use client';

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

export default function ContactDetailsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const response = await fetch(`/api/contacts/${params.id}`, {
        credentials: 'include',
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        setError('Failed to load contact');
        setLoading(false);
        return;
      }

      const data = (await response.json()) as Contact;
      setContact(data);
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

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>{contact.fullName}</h1>
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
    </section>
  );
}
