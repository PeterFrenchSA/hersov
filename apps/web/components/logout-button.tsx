'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton(): JSX.Element {
  const router = useRouter();

  const onLogout = async (): Promise<void> => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });

    router.push('/login');
    router.refresh();
  };

  return (
    <button type="button" className="button secondary" onClick={onLogout}>
      Logout
    </button>
  );
}
