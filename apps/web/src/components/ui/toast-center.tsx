'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToastEventName, ToastKind } from '@/lib/toast';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  error: 'border-red-300 bg-red-50 text-red-900',
  info: 'border-blue-300 bg-blue-50 text-blue-900',
};

export function ToastCenter() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const eventName = useMemo(() => getToastEventName(), []);

  useEffect(() => {
    function handleToast(event: Event): void {
      const custom = event as CustomEvent<{ kind: ToastKind; message: string }>;
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const toast: ToastItem = {
        id,
        kind: custom.detail.kind,
        message: custom.detail.message,
      };

      setItems((current) => [...current, toast]);

      setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, 4000);
    }

    window.addEventListener(eventName, handleToast);
    return () => {
      window.removeEventListener(eventName, handleToast);
    };
  }, [eventName]);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] grid w-[min(92vw,420px)] gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-panel ${KIND_CLASS[item.kind]}`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
