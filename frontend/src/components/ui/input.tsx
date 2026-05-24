import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3 text-sm outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[rgba(13,148,136,0.2)]',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
