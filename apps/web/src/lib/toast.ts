export type ToastKind = 'success' | 'error' | 'info';

interface ToastPayload {
  kind: ToastKind;
  message: string;
}

const TOAST_EVENT_NAME = 'myoptiwealth:toast';

export function showToast(message: string, kind: ToastKind = 'info'): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ToastPayload>(TOAST_EVENT_NAME, {
      detail: { kind, message },
    }),
  );
}

export function getToastEventName(): string {
  return TOAST_EVENT_NAME;
}
