import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { errorText } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { fieldErrors, loginSchema } from '@/lib/validation';
import { useSlug, useStudio } from '@/features/studio/StudioRoot';

// Owners sign in with email + password. Accounts are created by the operator
// (pnpm owner:create); there is intentionally no public sign-up.
export function LoginPage() {
  const slug = useSlug();
  const { tenant } = useStudio();
  const [form, setForm] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState(false);
  const errors = touched ? fieldErrors(loginSchema, form) : {};
  const login = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password });
      if (error) throw error;
    },
  });
  const submit = () => {
    setTouched(true);
    if (!loginSchema.safeParse(form).success) return;
    login.mutate();
  };
  return (
    <main className="app-shell center-screen">
      <form
        style={{ width: '100%', maxWidth: 380, textAlign: 'left' }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <VStack gap={4}>
          <VStack gap={1}>
            <span className="eyebrow">Кабинет студии</span>
            <h1 className="section-title" style={{ fontSize: 40, margin: 0 }}>
              {tenant.name}
            </h1>
            <Text color="secondary">Войдите, чтобы видеть записи, оплаты и менять настройки.</Text>
          </VStack>
          <TextInput
            label="Почта"
            type="email"
            value={form.email}
            onChange={(v) => setForm((f) => ({ ...f, email: v }))}
            autoComplete="username"
            size="lg"
            status={errors.email ? { type: 'error', message: errors.email } : undefined}
          />
          <TextInput
            label="Пароль"
            type="password"
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            autoComplete="current-password"
            size="lg"
            onEnter={submit}
            status={errors.password ? { type: 'error', message: errors.password } : undefined}
          />
          {login.isError && <Banner status="error" title="Не удалось войти" description={errorText(login.error)} collapsible={false} />}
          <Button label="Войти" type="submit" variant="primary" size="lg" width="100%" isLoading={login.isPending} />
          <Text type="supporting">
            Нет доступа? Его выдаёт администратор платформы. <Link to={`/s/${slug}`}>На страницу студии</Link>
          </Text>
        </VStack>
      </form>
    </main>
  );
}
