import { cn } from '../../lib/utils';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('panel-surface overflow-hidden transition-shadow duration-200 hover:shadow-[0_18px_46px_rgba(14,165,233,0.12)]', className)}>{children}</div>;
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('border-b border-[hsl(var(--line))] bg-[linear-gradient(180deg,rgba(30,41,59,0.72)_0%,rgba(15,23,42,0.68)_100%)] px-4 py-4', className)}>{children}</div>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-4 py-4', className)}>{children}</div>;
}
