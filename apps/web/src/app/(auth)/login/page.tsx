'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const response = await apiClient.login(email, password);
      localStorage.setItem('mw_access_token', response.tokens.accessToken);
      localStorage.setItem('mw_active_workspace_id', response.activeWorkspaceId);
      showToast('Connexion réussie.', 'success');
      router.push('/dashboard');
    } catch {
      setError('Connexion impossible. Vérifie les identifiants.');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-8 shadow-panel">
        <h1 className="text-3xl font-semibold text-[var(--brand)]">MyOptiwealth</h1>
        <p className="mt-2 text-sm text-[#5b5952]">Connexion sécurisée (JWT)</p>

        <div className="mt-6 grid gap-4">
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="rounded-md border border-[var(--line)] px-3 py-2" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" type="password" className="rounded-md border border-[var(--line)] px-3 py-2" />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit">Se connecter</Button>
        </div>

        <p className="mt-5 text-sm text-[#5b5952]">
          Pas de compte ? <Link href="/register" className="font-semibold text-[var(--brand)]">Créer un workspace</Link>
        </p>
      </form>
    </main>
  );
}
