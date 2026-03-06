'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import { EventClickArg, EventInput } from '@fullcalendar/core';
import { apiClient } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { showToast } from '@/lib/toast';
import { useRouter } from 'next/navigation';

type FeedItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  source: 'EVENT' | 'TASK' | 'TIMESHEET' | string;
  taskStatus?: string;
  url: string;
  workspaceId: string;
  workspaceName: string;
};

function taskStatusCalendarColors(status?: string): { backgroundColor: string; borderColor: string; textColor: string } {
  switch (status) {
    case 'DONE':
      return { backgroundColor: '#111111', borderColor: '#111111', textColor: '#ffffff' };
    case 'IN_PROGRESS':
      return { backgroundColor: '#16a34a', borderColor: '#16a34a', textColor: '#ffffff' };
    case 'WAITING':
      return { backgroundColor: '#f97316', borderColor: '#f97316', textColor: '#ffffff' };
    default:
      return { backgroundColor: '#f3f2ef', borderColor: '#d8d3c8', textColor: '#3f3c33' };
  }
}

export default function CalendarPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState('MEETING');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<FeedItem | null>(null);
  const [isEditingSelectedEvent, setIsEditingSelectedEvent] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editEventType, setEditEventType] = useState('MEETING');
  const [editStartAt, setEditStartAt] = useState('');
  const [editEndAt, setEditEndAt] = useState('');
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
      if (item.source === 'TASK') {
        const taskColors = taskStatusCalendarColors(item.taskStatus);
        return {
          id: item.id,
          title: `[${item.workspaceName}] ${item.title}`,
          start: item.start,
          end: item.end,
          allDay: item.allDay,
          backgroundColor: taskColors.backgroundColor,
          borderColor: taskColors.borderColor,
          textColor: taskColors.textColor,
          extendedProps: {
            source: item.source,
            workspaceName: item.workspaceName,
            sourceUrl: item.url,
          },
        };
      }
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
          sourceUrl: item.url,
        },
      };
    });
  }, [activeWorkspaceId, items]);

  function onEventClick(arg: EventClickArg): void {
    const item = items.find((entry) => entry.id === arg.event.id);
    if (!item) return;
    setSelectedEvent(item);
    setIsEditingSelectedEvent(false);
    if (item.source === 'EVENT') {
      setEditTitle(item.title);
      setEditEventType('MEETING');
      setEditStartAt(toDateTimeLocalValue(item.start));
      setEditEndAt(toDateTimeLocalValue(item.end));
    } else {
      setEditTitle('');
      setEditEventType('MEETING');
      setEditStartAt('');
      setEditEndAt('');
    }
  }

  function toDateTimeLocalValue(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  function selectedCalendarEventId(item: FeedItem | null): string | null {
    if (!item || item.source !== 'EVENT') return null;
    if (!item.id.startsWith('event-')) return null;
    return item.id.slice(6);
  }

  async function onUpdateSelectedEvent(): Promise<void> {
    const token = getAccessToken();
    const eventId = selectedCalendarEventId(selectedEvent);
    if (!token || !eventId || !editTitle || !editStartAt || !editEndAt) return;
    await apiClient.updateEvent(token, eventId, {
      title: editTitle,
      eventType: editEventType,
      startAt: new Date(editStartAt).toISOString(),
      endAt: new Date(editEndAt).toISOString(),
    });
    showToast('Evenement modifie.', 'success');
    setSelectedEvent(null);
    setIsEditingSelectedEvent(false);
    await load();
  }

  async function onDeleteSelectedEvent(): Promise<void> {
    const token = getAccessToken();
    const eventId = selectedCalendarEventId(selectedEvent);
    if (!token || !eventId) return;
    await apiClient.deleteEvent(token, eventId);
    showToast('Evenement supprime.', 'success');
    setSelectedEvent(null);
    setIsEditingSelectedEvent(false);
    await load();
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
          weekends={false}
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
          eventClick={onEventClick}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          slotMinTime="08:00:00"
          slotMaxTime="19:00:00"
          dayMaxEvents={true}
        />
      </article>

      {selectedEvent ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--line)] bg-white p-5 shadow-panel">
            <h2 className="text-lg font-semibold text-[var(--brand)]">{selectedEvent.title}</h2>
            <div className="mt-3 grid gap-1 text-sm text-[#4f4d45]">
              <p>Workspace: {selectedEvent.workspaceName}</p>
              <p>Type: {selectedEvent.source}</p>
              <p>Début: {new Date(selectedEvent.start).toLocaleString('fr-FR')}</p>
              <p>Fin: {new Date(selectedEvent.end).toLocaleString('fr-FR')}</p>
            </div>
            <div className="mt-4 flex gap-2">
              {selectedEvent.source === 'EVENT' ? (
                <button
                  type="button"
                  onClick={() => setIsEditingSelectedEvent((current) => !current)}
                  className="rounded bg-[var(--brand)] px-3 py-2 text-white"
                >
                  Modifier
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedEvent.url) return;
                    router.push(selectedEvent.url);
                  }}
                  className="rounded bg-[var(--brand)] px-3 py-2 text-white"
                >
                  Ouvrir
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded border border-[var(--line)] px-3 py-2"
              >
                Fermer
              </button>
            </div>
            {selectedEvent.source === 'EVENT' && isEditingSelectedEvent ? (
              <div className="mt-4 grid gap-2 border-t border-[var(--line)] pt-4">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Titre"
                  className="rounded border border-[var(--line)] px-3 py-2"
                />
                <select
                  value={editEventType}
                  onChange={(e) => setEditEventType(e.target.value)}
                  className="rounded border border-[var(--line)] px-3 py-2"
                >
                  <option value="MEETING">Meeting</option>
                  <option value="TASK_DEADLINE">Task deadline</option>
                  <option value="INTERNAL">Internal</option>
                  <option value="EXTERNAL">External</option>
                </select>
                <input
                  type="datetime-local"
                  value={editStartAt}
                  onChange={(e) => setEditStartAt(e.target.value)}
                  className="rounded border border-[var(--line)] px-3 py-2"
                />
                <input
                  type="datetime-local"
                  value={editEndAt}
                  onChange={(e) => setEditEndAt(e.target.value)}
                  className="rounded border border-[var(--line)] px-3 py-2"
                />
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void onUpdateSelectedEvent();
                    }}
                    className="rounded bg-[var(--brand)] px-3 py-2 text-white"
                  >
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void onDeleteSelectedEvent();
                    }}
                    className="rounded border border-red-300 px-3 py-2 text-red-700"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
