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
import { signupSchema, type SignupValues } from '@/lib/auth/schemas';

export function SignupForm({ locale, redirectTo }: { locale: string; redirectTo?: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

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
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema(messages)),
    mode: 'onBlur',
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  });

  async function onSubmit(values: SignupValues) {
    setFormError(null);
    setNotice(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: {
          // Lands in auth.users.raw_user_meta_data, which the database trigger
          // reads to populate public.users.full_name at provisioning time.
          data: { full_name: values.fullName.trim() },
        },
      });

      if (error) {
        if (error.message.toLowerCase().includes('already')) {
          setFormError(t('errors.emailTaken'));
        } else if (error.message.toLowerCase().includes('password')) {
          setFormError(t('errors.weakPassword'));
        } else {
          setFormError(t('errors.generic'));
        }
        return;
      }

      // With email confirmation on, signUp returns a user but no session. Only
      // navigate when a session actually exists, or the dashboard would bounce
      // straight back to login.
      if (data.session) {
        router.refresh();
        router.push(redirectTo ?? `/${locale}/dashboard`);
        return;
      }

      setNotice(`${t('signup.success')} ${t('signup.checkEmail')}`);
    } catch {
      setFormError(t('errors.network'));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {formError ? <FormAlert message={formError} /> : null}
      {notice ? <FormAlert message={notice} tone="success" /> : null}

      <Field name="fullName" label={t('fields.fullName')} error={errors.fullName?.message}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            autoComplete="name"
            placeholder={t('fields.fullNamePlaceholder')}
            aria-describedby={describedBy}
            invalid={invalid}
            {...register('fullName')}
          />
        )}
      </Field>

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

      <Field
        name="password"
        label={t('fields.password')}
        error={errors.password?.message}
        hint={t('fields.passwordPlaceholder')}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            aria-describedby={describedBy}
            invalid={invalid}
            {...register('password')}
          />
        )}
      </Field>

      <Field
        name="confirmPassword"
        label={t('fields.confirmPassword')}
        error={errors.confirmPassword?.message}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            aria-describedby={describedBy}
            invalid={invalid}
            {...register('confirmPassword')}
          />
        )}
      </Field>

      <Button type="submit" disabled={isSubmitting} className="h-11 w-full text-[0.95rem]">
        {isSubmitting ? (
          <>
            <Loader2 className="animate-spin" />
            {t('signup.submitting')}
          </>
        ) : (
          t('signup.submit')
        )}
      </Button>
    </form>
  );
}
