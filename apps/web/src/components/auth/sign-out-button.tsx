'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/use-user';

export function SignOutButton() {
  const t = useTranslations('dashboard');
  const { signOut } = useUser();

  return (
    <Button variant="outline" size="sm" onClick={() => void signOut()} className="gap-2">
      <LogOut className="size-4" aria-hidden />
      {t('signOut')}
    </Button>
  );
}
