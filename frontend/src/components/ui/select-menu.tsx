import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const EMPTY_VALUE = '__select_empty__';

export type SelectMenuOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

type SelectMenuProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectMenuOption[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
};

export function SelectMenu({ value, onValueChange, options, placeholder, className, triggerClassName, contentClassName }: SelectMenuProps) {
  const safeValue = value === '' ? EMPTY_VALUE : value;
  return (
    <SelectPrimitive.Root
      value={safeValue}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE ? '' : nextValue)}
    >
      <SelectPrimitive.Trigger
        className={cn(
          'inline-flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-full border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-4 text-left text-sm text-[hsl(var(--text))] outline-none transition-all duration-200 ease-out focus:ring-2 focus:ring-[rgba(14,165,233,0.28)] focus:ring-offset-1 focus:ring-offset-[hsl(var(--bg))] disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName,
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--muted))]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] text-sm text-[hsl(var(--text))] shadow-[0_18px_42px_rgba(2,8,23,0.45)]',
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value || EMPTY_VALUE}
                value={option.value === '' ? EMPTY_VALUE : option.value}
                disabled={option.disabled}
                className="relative flex min-h-9 cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-3 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-[rgba(14,165,233,0.14)] data-[disabled]:opacity-45"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex h-4 w-4 items-center justify-center text-[hsl(var(--primary-dark))]">
                  <Check className="h-4 w-4" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
