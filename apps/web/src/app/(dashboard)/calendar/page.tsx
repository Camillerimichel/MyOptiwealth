'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import { EventInput } from '@fullcalendar/core';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';

type FeedItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  source: 'EVENT' | 'TASK' | 'TIMESHEET' | string;
  workspaceId: string;
  workspaceName: string;
};

export default function CalendarPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
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
      const feed = await apiClient.listCalendarFeed(token);
      setItems(feed.items);
      setActiveWorkspaceId(feed.activeWorkspaceId);
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
    showToast('Evenement cree.', 'success');
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
    showToast('Export ICS genere.', 'success');
  }

  const calendarEvents = useMemo<EventInput[]>(() => {
    return items.map((item) => {
      const isActiveWorkspace = item.workspaceId === activeWorkspaceId;
      return {
        id: item.id,
        title: `[${item.workspaceName}] ${item.title}`,
        start: item.start,
        end: item.end,
        allDay: item.allDay,
        backgroundColor: isActiveWorkspace ? '#111111' : '#7d889a',
        borderColor: isActiveWorkspace ? '#111111' : '#7d889a',
        textColor: '#ffffff',
        extendedProps: {
          source: item.source,
          workspaceName: item.workspaceName,
        },
      };
    });
  }, [activeWorkspaceId, items]);

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
          <button className="rounded bg-[var(--brand)] px-3 py-2 text-white">Creer</button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={() => void onExportIcs()} className="rounded border border-[var(--line)] px-3 py-2 text-sm">Exporter ICS hebdo</button>
          <div className="flex items-center gap-2 text-xs text-[#5b5952]">
            <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: '#111111' }} />
            Workspace actif
          </div>
          <div className="flex items-center gap-2 text-xs text-[#5b5952]">
            <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: '#7d889a' }} />
            Autres workspaces
          </div>
        </div>
      </article>

      <article className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-panel">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={frLocale}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          buttonText={{
            today: 'Aujourd hui',
            month: 'Mois',
            week: 'Semaine',
            day: 'Jour',
            list: 'Liste',
          }}
          height="auto"
          events={calendarEvents}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayMaxEvents={true}
        />
      </article>
    </section>
  );
}
