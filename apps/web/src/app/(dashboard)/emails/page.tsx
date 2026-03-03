'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type EmailMessage = { id: string; subject: string; fromAddress: string; receivedAt: string };

export default function EmailsPage() {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [externalMessageId, setExternalMessageId] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [toAddresses, setToAddresses] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const token = getAccessToken();
    if (!token) {
      setError('Token manquant.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setEmails(await apiClient.listEmails(token));
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLink(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !externalMessageId || !fromAddress || !subject) return;
    await apiClient.linkEmail(token, {
      externalMessageId,
      fromAddress,
      toAddresses: toAddresses.split(',').map((item) => item.trim()).filter(Boolean),
      subject,
    });
    setExternalMessageId('');
    setFromAddress('');
    setToAddresses('');
    setSubject('');
    showToast('Email lié au workspace.', 'success');
    await load();
  }

  async function onSync(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const result = await apiClient.syncEmails(token);
    showToast(`Synchronisation IMAP terminée (${result.synced} emails).`, 'success');
    await load();
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Emails</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onLink} className="grid gap-2 lg:grid-cols-2">
          <input value={externalMessageId} onChange={(e) => setExternalMessageId(e.target.value)} placeholder="External message id" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="From" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={toAddresses} onChange={(e) => setToAddresses(e.target.value)} placeholder="To (a@b.com,c@d.com)" className="rounded border border-[var(--line)] px-3 py-2" />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="rounded border border-[var(--line)] px-3 py-2" />
          <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">Lier email</button>
        </form>
        <button onClick={onSync} className="mt-3 rounded border border-[var(--line)] px-3 py-2 text-sm">Synchroniser IMAP</button>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <ul className="grid gap-2 text-sm">
          {emails.map((email) => <li key={email.id}>{email.subject} | {email.fromAddress} | {new Date(email.receivedAt).toLocaleString()}</li>)}
        </ul>
      </article>
    </section>
  );
}
