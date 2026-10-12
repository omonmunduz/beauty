import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { CalendarBlank, ChartBar, ChatCircleDots, GearSix } from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { AppError, errorText } from '@/lib/errors';
import { clearOwnerData } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type { Tenant } from '@/lib/types';
import { useSlug } from '@/features/studio/StudioRoot';
import { LoginPage } from './LoginPage';

export interface OwnerTenant extends Tenant {
  slot_step_min: number;
  min_lead_min: number;
  hero_source: 'config' | 'owner';
  logo_source: 'config' | 'owner';
  config_version: number;
}

interface OwnerCtxValue {
  tenant: OwnerTenant;
  role: string;
  session: Session;
  signOut: () => Promise<void>;
}
const OwnerCtx = createContext<OwnerCtxValue | null>(null);
export function useOwner(): OwnerCtxValue {
  const v = useContext(OwnerCtx);
  if (!v) throw new Error('useOwner outside OwnerRoot');
  return v;
}
export const ownerKey = (tenantId: string, ...rest: unknown[]) => ['owner', tenantId, ...rest];

function useSession() {
  const [state, setState] = useState<{ ready: boolean; session: Session | null }>({ ready: false, session: null });
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setState({ ready: true, session: data.session }));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setState({ ready: true, session }));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

export function OwnerRoot() {
  const slug = useSlug();
  const { ready, session } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ctx = useQuery({
    queryKey: ['owner-context', slug, session?.user.id],
    queryFn: () => api.ownerContext(slug),
    enabled: !!session,
    staleTime: 60_000,
  });

  // Logout wipes the private query cache and any owner data left in storage.
  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    qc.clear();
    clearOwnerData();
    navigate(`/s/${slug}/owner`, { replace: true });
  };

  if (!ready) {
    return (
      <main className="app-shell center-screen" aria-busy="true">
        <Spinner size="xl" />
      </main>
    );
  }
  if (!session) return <LoginPage />;
  if (ctx.isPending) {
    return (
      <main className="app-shell center-screen" aria-busy="true">
        <Spinner size="xl" label="Открываем кабинет" />
      </main>
    );
  }
  if (ctx.isError) {
    const forbidden = ctx.error instanceof AppError && ctx.error.code === 'forbidden';
    return (
      <main className="app-shell center-screen">
        <EmptyState
          headingLevel={1}
          title={forbidden ? 'Нет доступа к этой студии' : 'Кабинет не открылся'}
          description={forbidden ? `Аккаунт ${session.user.email} не привязан к этой студии.` : errorText(ctx.error)}
          actions={
            <>
              {!forbidden && <Button label="Повторить" onClick={() => ctx.refetch()} />}
              <Button label="Выйти" variant="primary" onClick={signOut} />
            </>
          }
        />
      </main>
    );
  }

  const base = `/s/${slug}/owner`;
  const items = [
    { to: base, label: 'Расписание', icon: CalendarBlank, end: true },
    { to: `${base}/stats`, label: 'Статистика', icon: ChartBar },
    { to: `${base}/assistant`, label: 'Помощник', icon: ChatCircleDots },
    { to: `${base}/settings`, label: 'Настройки', icon: GearSix },
  ];
  return (
    <OwnerCtx.Provider value={{ tenant: ctx.data.tenant as OwnerTenant, role: ctx.data.role, session, signOut }}>
      {ctx.data.tenant.status === 'preview' && (
        <p className="demo-banner" role="note">
          Превью: демо-записи, уведомления не отправляются. Запуск — в настройках.
        </p>
      )}
      <main className="app-shell">
        <Outlet />
      </main>
      <nav className="bottom-nav glass" aria-label="Кабинет">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-item tap">
            {({ isActive }) => (
              <>
                <Icon size={22} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </OwnerCtx.Provider>
  );
}
