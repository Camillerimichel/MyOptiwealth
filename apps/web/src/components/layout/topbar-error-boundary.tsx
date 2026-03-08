'use client';

import { Component, ReactNode } from 'react';
import { Topbar } from '@/components/layout/topbar';

type State = { hasError: boolean };

export class TopbarErrorBoundary extends Component<{ children: ReactNode }, State> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('Topbar runtime error', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
          <p className="text-sm text-[#5b5952]">Topbar indisponible temporairement. Rechargez la page.</p>
        </header>
      );
    }

    return this.props.children;
  }
}

export function SafeTopbar() {
  return (
    <TopbarErrorBoundary>
      <Topbar />
    </TopbarErrorBoundary>
  );
}
