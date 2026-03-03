import { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'rounded-lg border border-[var(--line)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-panel transition hover:opacity-95',
        className,
      )}
      {...props}
    />
  );
}
