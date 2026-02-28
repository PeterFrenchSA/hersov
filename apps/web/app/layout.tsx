import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { LogoutButton } from '../components/logout-button';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <strong>Mini CRM</strong>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/contacts">Contacts</Link>
          <Link href="/import">Import</Link>
          <Link href="/enrichment">Enrichment</Link>
          <Link href="/insights">Insights</Link>
          <Link href="/review">Review</Link>
          <Link href="/chat">Chat</Link>
          <Link href="/admin/settings">Admin</Link>
          <div style={{ marginLeft: 'auto' }}>
            <LogoutButton />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
