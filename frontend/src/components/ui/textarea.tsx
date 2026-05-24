import * as React from 'react';
import { cn } from '../../lib/utils';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-24 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3 py-2 text-sm outline-none transition focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[rgba(13,148,136,0.2)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
