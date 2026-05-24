import { cn } from '../../lib/utils';

export function Badge({ className, tone = 'neutral', children }: { className?: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        tone === 'neutral' && 'bg-[hsl(var(--panel-soft))] text-[hsl(var(--muted))]',
        tone === 'success' && 'bg-[rgba(13,148,136,0.12)] text-[hsl(var(--primary-dark))]',
        tone === 'warning' && 'bg-[rgba(234,88,12,0.12)] text-[hsl(var(--accent))]',
        tone === 'danger' && 'bg-[rgba(180,35,24,0.12)] text-[hsl(var(--danger))]',
        tone === 'primary' && 'bg-[rgba(13,148,136,0.12)] text-[hsl(var(--primary-dark))]',
        className,
      )}
    >
      {children}
    </span>
  );
}
