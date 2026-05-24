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
        'inline-flex items-center justify-center gap-2 rounded-lg border px-3 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-8 text-sm',
        size === 'md' && 'h-10 text-sm',
        size === 'lg' && 'h-11 text-base',
        variant === 'default' && 'border-transparent bg-[hsl(var(--primary-dark))] text-white hover:bg-[hsl(var(--primary))]',
        variant === 'secondary' && 'border-[hsl(var(--line))] bg-[hsl(var(--panel))] text-[hsl(var(--text))] hover:bg-[hsl(var(--panel-soft))]',
        variant === 'danger' && 'border-transparent bg-[hsl(var(--danger))] text-white hover:bg-[#991b1b]',
        variant === 'ghost' && 'border-transparent bg-transparent text-[hsl(var(--text))] hover:bg-[hsl(var(--panel-soft))]',
        className,
      )}
      {...props}
    />
  );
}
