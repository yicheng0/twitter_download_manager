import { cn } from '../../lib/utils';

export function Badge({ className, tone = 'neutral', children }: { className?: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide',
        tone === 'neutral' && 'bg-[rgba(148,163,184,0.14)] text-[hsl(var(--muted))]',
        tone === 'success' && 'bg-[rgba(34,197,94,0.14)] text-[hsl(var(--success))]',
        tone === 'warning' && 'bg-[rgba(251,191,36,0.14)] text-[hsl(var(--warning))]',
        tone === 'danger' && 'bg-[rgba(248,113,113,0.14)] text-[hsl(var(--danger))]',
        tone === 'primary' && 'bg-[rgba(14,165,233,0.16)] text-[hsl(var(--primary-dark))]',
        className,
      )}
    >
      {children}
    </span>
  );
}
