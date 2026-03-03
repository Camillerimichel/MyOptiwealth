'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type CalendarEvent = { id: string; title: string; eventType: string; startAt: string; endAt: string };

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState('MEETING');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
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
      setEvents(await apiClient.listEvents(token));
    } catch {
      setError('Chargement impossible.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !title || !startAt || !endAt) return;
    await apiClient.createEvent(token, {
      title,
      eventType,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
    });
    setTitle('');
    showToast('Événement créé.', 'success');
    await load();
  }

  async function onExportIcs(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const ics = await apiClient.exportWeeklyIcs(token);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'myoptiwealth-weekly.ics';
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('Export ICS généré.', 'success');
  }

  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">Calendar</h1>
      {loading ? <p className="text-sm text-[#5b5952]">Chargement...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <form onSubmit={onCreate} className="grid gap-2 lg:grid-cols-5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre" className="rounded border border-[var(--line)] px-3 py-2" />
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2">
            <option value="MEETING">Meeting</option>
            <option value="TASK_DEADLINE">Task deadline</option>
            <option value="INTERNAL">Internal</option>
            <option value="EXTERNAL">External</option>
          </select>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2" />
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="rounded border border-[var(--line)] px-3 py-2" />
          <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">Créer</button>
        </form>
        <button onClick={onExportIcs} className="mt-3 rounded border border-[var(--line)] px-3 py-2 text-sm">Exporter ICS hebdo</button>
      </article>
      <article className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
        <ul className="grid gap-2 text-sm">
          {events.map((event) => <li key={event.id}>{event.eventType} | {event.title} | {new Date(event.startAt).toLocaleString()}</li>)}
        </ul>
      </article>
    </section>
  );
}
