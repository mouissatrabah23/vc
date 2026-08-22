'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormAlert } from '@/components/ui/field';
import { createClient } from '@/lib/supabase/client';
import { loginSchema, type LoginValues } from '@/lib/auth/schemas';

export function LoginForm({ locale, redirectTo }: { locale: string; redirectTo?: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const messages = {
    fullNameMin: t('validation.fullNameMin'),
    emailInvalid: t('validation.emailInvalid'),
    passwordMin: t('validation.passwordMin'),
    passwordWeak: t('validation.passwordWeak'),
    passwordMismatch: t('validation.passwordMismatch'),
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema(messages)),
    // Validate on blur, not on every keystroke: telling someone their email is
    // invalid while they are still typing the domain is noise.
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });

      if (error) {
        // Never distinguish "no such account" from "wrong password": that turns
        // the login form into an account-enumeration oracle.
        setFormError(error.status === 400 ? t('errors.invalidCredentials') : t('errors.generic'));
        return;
      }

      // refresh() first so server components re-render with the new session
      // before navigating; otherwise the dashboard can paint as signed-out.
      router.refresh();
      router.push(redirectTo ?? `/${locale}/dashboard`);
    } catch {
      setFormError(t('errors.network'));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {formError ? <FormAlert message={formError} /> : null}

      <Field name="email" label={t('fields.email')} error={errors.email?.message}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            placeholder={t('fields.emailPlaceholder')}
            aria-describedby={describedBy}
            invalid={invalid}
            {...register('email')}
          />
        )}
      </Field>

      <Field name="password" label={t('fields.password')} error={errors.password?.message}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            dir="ltr"
            aria-describedby={describedBy}
            invalid={invalid}
            {...register('password')}
          />
        )}
      </Field>

      <Button type="submit" disabled={isSubmitting} className="h-11 w-full text-[0.95rem]">
        {isSubmitting ? (
          <>
            <Loader2 className="animate-spin" />
            {t('login.submitting')}
          </>
        ) : (
          t('login.submit')
        )}
      </Button>
    </form>
  );
}
