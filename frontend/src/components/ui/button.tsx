import * as React from 'react';
import { cn } from '../../lib/utils';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ className, variant = 'default', size = 'md', ...props }: Props) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg border px-3 font-semibold outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[rgba(14,165,233,0.36)] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))] disabled:pointer-events-none disabled:opacity-50 active:translate-y-[1px]',
        size === 'sm' && 'h-8 text-sm',
        size === 'md' && 'h-10 text-sm',
        size === 'lg' && 'h-11 text-base',
        variant === 'default' && 'border-transparent bg-[linear-gradient(180deg,hsl(var(--primary))_0%,#2563eb_100%)] text-slate-950 shadow-[0_10px_28px_rgba(14,165,233,0.24)] hover:-translate-y-[1px] hover:shadow-[0_14px_34px_rgba(14,165,233,0.32)]',
        variant === 'secondary' && 'border-[hsl(var(--line))] bg-[linear-gradient(180deg,rgba(30,41,59,0.94)_0%,rgba(15,23,42,0.94)_100%)] text-[hsl(var(--primary-dark))] shadow-[0_8px_20px_rgba(2,8,23,0.22)] hover:-translate-y-[1px] hover:border-[hsl(var(--primary))] hover:bg-[rgba(14,165,233,0.12)] hover:text-[hsl(var(--text))] hover:shadow-[0_12px_28px_rgba(14,165,233,0.16)]',
        variant === 'danger' && 'border-transparent bg-[linear-gradient(180deg,hsl(var(--danger))_0%,#dc2626_100%)] text-white shadow-[0_10px_24px_rgba(248,113,113,0.18)] hover:-translate-y-[1px] hover:shadow-[0_14px_30px_rgba(248,113,113,0.24)]',
        variant === 'ghost' && 'border-[hsl(var(--line))] bg-[rgba(15,23,42,0.62)] text-[hsl(var(--primary-dark))] hover:bg-[rgba(14,165,233,0.12)] hover:text-[hsl(var(--text))]',
        className,
      )}
      {...props}
    />
  );
}
