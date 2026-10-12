import { createContext, useContext, useEffect } from 'react';
import { Outlet, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '@astryxdesign/core';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { api } from '@/lib/api';
import { AppError, errorText } from '@/lib/errors';
import { registerStudioWorker } from '@/lib/pwa';
import { studioTheme } from '@/lib/theme';
import type { Storefront } from '@/lib/types';
import { NotFoundPage } from '@/app/NotFoundPage';

const StudioCtx = createContext<Storefront | null>(null);

export function useStudio(): Storefront {
  const v = useContext(StudioCtx);
  if (!v) throw new Error('useStudio outside StudioRoot');
  return v;
}

export function useSlug(): string {
  return useParams().slug!.toLowerCase();
}

export const storefrontKey = (slug: string) => ['storefront', slug] as const;

function onAccent(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#140F12' : '#FFFFFF';
}

export function StudioRoot() {
  const slug = useSlug();
  const q = useQuery({ queryKey: storefrontKey(slug), queryFn: () => api.storefront(slug), staleTime: 60_000 });
  const accent = q.data?.tenant.accent ?? '#E8A598';

  useEffect(() => {
    void registerStudioWorker(slug);
  }, [slug]);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--studio-accent', accent);
    root.setProperty('--studio-on-accent', onAccent(accent));
    if (q.data && !document.querySelector('meta[name="tenant"]')) document.title = `${q.data.tenant.name} — онлайн-запись`;
  }, [accent, q.data]);

  if (q.isPending) {
    return (
      <Theme theme={studioTheme(accent)} mode="dark">
        <main className="app-shell center-screen" aria-busy="true">
          <Spinner size="xl" label="Загружаем студию" />
        </main>
      </Theme>
    );
  }
  if (q.isError) {
    if (q.error instanceof AppError && q.error.code === 'tenant_not_found') {
      return <NotFoundPage title="Студия не найдена" description="Ссылка неверная или студия больше не принимает записи." />;
    }
    return (
      <Theme theme={studioTheme(accent)} mode="dark">
        <main className="app-shell center-screen">
          <EmptyState
            title="Не удалось открыть студию"
            description={errorText(q.error)}
            headingLevel={1}
            actions={<Button label="Повторить" variant="primary" onClick={() => q.refetch()} />}
          />
        </main>
      </Theme>
    );
  }
  return (
    <Theme theme={studioTheme(accent)} mode="dark">
      <StudioCtx.Provider value={q.data}>
        <Outlet />
      </StudioCtx.Provider>
    </Theme>
  );
}
