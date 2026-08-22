import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A labelled form field with inline validation messaging.
 *
 * Deliberately not shadcn's <Form> stack: that wires a react-hook-form context
 * through six components, which is a lot of indirection for two auth forms.
 * This keeps the accessibility wiring — label association, aria-describedby,
 * aria-invalid — while staying legible.
 *
 * The error region reserves its own line so validation messages do not shift
 * the layout when they appear.
 */
export interface FieldProps {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
}

export function Field({ name, label, error, hint, children, className }: FieldProps) {
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium leading-none text-foreground/90">
        {label}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      <div className="min-h-[1.15rem]">
        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Form-level error banner, for failures that are not tied to one field. */
export function FormAlert({
  message,
  tone = 'error',
}: {
  message: string;
  tone?: 'error' | 'success';
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border px-3.5 py-3 text-sm',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/8 text-destructive'
          : 'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]',
      )}
    >
      {message}
    </div>
  );
}
