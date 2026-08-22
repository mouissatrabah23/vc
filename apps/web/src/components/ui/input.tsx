import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Renders the invalid state and wires aria-invalid for assistive tech. */
  invalid?: boolean;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-11 w-full rounded-md border bg-card px-3.5 py-2 text-sm shadow-sm',
        'transition-[border-color,box-shadow] duration-150',
        'placeholder:text-muted-foreground/70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:border-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        // Invalid styling is driven by the prop rather than :invalid, so it
        // appears on submit/blur instead of while the field is still empty.
        invalid ? 'border-destructive focus-visible:ring-destructive/35' : 'border-input',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
