'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';

export default function RegisterPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const response = await apiClient.register(email, password, workspaceName);
      setOtpauth(response.twoFactorProvisioning.otpauth);
      localStorage.setItem('mw_access_token', response.tokens.accessToken);
      showToast('Workspace créé. Configure ton 2FA puis connecte-toi.', 'success');
      router.push('/login');
    } catch {
      setError('Inscription impossible.');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-8 shadow-panel">
        <h1 className="text-3xl font-semibold text-[var(--brand)]">Créer un workspace</h1>
        <div className="mt-6 grid gap-4">
          <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Nom du workspace" className="rounded-md border border-[var(--line)] px-3 py-2" />
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email admin" className="rounded-md border border-[var(--line)] px-3 py-2" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" type="password" className="rounded-md border border-[var(--line)] px-3 py-2" />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {otpauth ? <p className="text-xs text-[#58564f]">Provisioning TOTP: {otpauth}</p> : null}
          <Button type="submit">Créer</Button>
        </div>
        <p className="mt-5 text-sm text-[#5b5952]">
          Déjà inscrit ? <Link href="/login" className="font-semibold text-[var(--brand)]">Connexion</Link>
        </p>
      </form>
    </main>
  );
}
