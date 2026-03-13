'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type ContactMethodInput = {
  type: 'email' | 'phone' | 'website' | 'linkedin' | 'twitter' | 'other';
  value: string;
  isPrimary?: boolean;
};

type ContactTagInput = {
  category: string;
  name: string;
};

export default function NewContactPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationCountry, setLocationCountry] = useState('');
  const [notesRaw, setNotesRaw] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [linkedinInput, setLinkedinInput] = useState('');
  const [websiteInput, setWebsiteInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const methods: ContactMethodInput[] = [];
    for (const email of splitLines(emailInput)) {
      methods.push({ type: 'email', value: email, isPrimary: methods.length === 0 });
    }
    for (const phone of splitLines(phoneInput)) {
      methods.push({ type: 'phone', value: phone, isPrimary: methods.length === 0 });
    }
    for (const linkedin of splitLines(linkedinInput)) {
      methods.push({ type: 'linkedin', value: linkedin, isPrimary: methods.length === 0 });
    }
    for (const website of splitLines(websiteInput)) {
      methods.push({ type: 'website', value: website, isPrimary: methods.length === 0 });
    }

    const tags: ContactTagInput[] = splitLines(tagInput)
      .map((value) => {
        const separatorIndex = value.indexOf(':');
        if (separatorIndex <= 0) {
          return null;
        }

        const category = value.slice(0, separatorIndex).trim();
        const name = value.slice(separatorIndex + 1).trim();
        if (!category || !name) {
          return null;
        }

        return { category, name };
      })
      .filter((value): value is ContactTagInput => value !== null);

    const response = await fetch('/api/contacts', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fullName: fullName.trim() || null,
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        companyName: companyName.trim() || null,
        currentTitle: currentTitle.trim() || null,
        locationCity: locationCity.trim() || null,
        locationCountry: locationCountry.trim() || null,
        notesRaw: notesRaw.trim() || null,
        methods,
        tags,
      }),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'Failed to create contact.' }));
      setError(body.message ?? 'Failed to create contact.');
      setSaving(false);
      return;
    }

    const payload = (await response.json()) as { id: string };
    router.push(`/contacts/${payload.id}`);
    router.refresh();
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <div>
        <h1 style={{ marginBottom: '0.35rem' }}>New Contact</h1>
        <p style={{ margin: 0, color: '#475569' }}>
          Add a contact manually with structured purpose tags so the relationship map stays useful beyond CSV imports.
        </p>
      </div>

      <form className="grid" style={{ gap: '1rem' }} onSubmit={onSubmit}>
        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Profile</h2>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label>
              Full name
              <input className="input" value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              First name
              <input className="input" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label>
              Last name
              <input className="input" value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
            <label>
              Company
              <input className="input" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
            </label>
            <label>
              Title
              <input className="input" value={currentTitle} onChange={(event) => setCurrentTitle(event.target.value)} />
            </label>
            <label>
              City
              <input className="input" value={locationCity} onChange={(event) => setLocationCity(event.target.value)} />
            </label>
            <label>
              Country
              <input className="input" value={locationCountry} onChange={(event) => setLocationCountry(event.target.value)} />
            </label>
          </div>
          <label>
            Notes / relationship context
            <textarea className="input" rows={6} value={notesRaw} onChange={(event) => setNotesRaw(event.target.value)} />
          </label>
        </article>

        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Methods</h2>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label>
              Emails
              <textarea className="input" rows={4} placeholder="one per line" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} />
            </label>
            <label>
              Phones
              <textarea className="input" rows={4} placeholder="one per line" value={phoneInput} onChange={(event) => setPhoneInput(event.target.value)} />
            </label>
            <label>
              LinkedIn URLs
              <textarea className="input" rows={4} placeholder="one per line" value={linkedinInput} onChange={(event) => setLinkedinInput(event.target.value)} />
            </label>
            <label>
              Websites
              <textarea className="input" rows={4} placeholder="one per line" value={websiteInput} onChange={(event) => setWebsiteInput(event.target.value)} />
            </label>
          </div>
        </article>

        <article className="card grid" style={{ gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Tags / Purpose</h2>
          <label>
            Structured tags
            <textarea
              className="input"
              rows={5}
              placeholder={`purpose:investor\nsector:energy\nassociation:monaco summit`}
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
            />
          </label>
        </article>

        {error ? <p className="error">{error}</p> : null}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="button" type="submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create Contact'}
          </button>
        </div>
      </form>
    </section>
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\n+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}
