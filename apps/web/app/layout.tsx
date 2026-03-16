import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import './globals.css';
import { LogoutButton } from '../components/logout-button';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get('crm.sid')?.value);

  return (
    <html lang="en">
      <body>
        <header className="nav">
          <strong>
            <Link href={isAuthenticated ? '/dashboard' : '/login'}>Mini CRM</Link>
          </strong>
          {isAuthenticated ? (
            <>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/contacts">Contacts</Link>
              <Link href="/import">Import</Link>
              <Link href="/enrichment">Enrichment</Link>
              <Link href="/linkedin">LinkedIn</Link>
              <Link href="/insights">Insights</Link>
              <Link href="/review">Review</Link>
              <Link href="/chat">Chat</Link>
              <Link href="/admin/settings">Admin</Link>
              <div style={{ marginLeft: 'auto' }}>
                <LogoutButton />
              </div>
            </>
          ) : null}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
