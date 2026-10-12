import { useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { CalendarCheck, ChatCircleDots, House, ListBullets } from '@phosphor-icons/react';
import { savedBookings } from '@/lib/storage';
import { useSlug, useStudio } from './StudioRoot';

// Re-render when bookings are saved in this tab (custom event) or another tab (storage event).
export const BOOKINGS_CHANGED = 'beauty:bookings-changed';
function subscribe(cb: () => void) {
  window.addEventListener(BOOKINGS_CHANGED, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(BOOKINGS_CHANGED, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useUpcomingCount(slug: string): number {
  const snapshot = useSyncExternalStore(subscribe, () => {
    const now = Date.now();
    return savedBookings(slug).filter((b) => new Date(b.startsAt).getTime() > now).length;
  });
  return snapshot;
}

export function StudioLayout() {
  const slug = useSlug();
  const { tenant } = useStudio();
  const upcoming = useUpcomingCount(slug);
  const { pathname } = useLocation();
  const base = `/s/${slug}`;
  const items = [
    { to: base, label: 'Главная', icon: House, end: true },
    { to: `${base}/services`, label: 'Услуги', icon: ListBullets },
    { to: `${base}/me`, label: 'Мои записи', icon: CalendarCheck, badge: upcoming },
    { to: `${base}/chat`, label: 'Помощник', icon: ChatCircleDots },
  ];
  return (
    <>
      {tenant.status === 'preview' && (
        <p className="demo-banner" role="note">
          Демо-версия: записи тестовые, уведомления не отправляются
        </p>
      )}
      <main className="app-shell" data-route={pathname}>
        <Outlet />
      </main>
      <nav className="bottom-nav glass" aria-label="Навигация" style={{ ['--nav-count' as string]: items.length }}>
        {items.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end} className="nav-item tap">
            {({ isActive }) => (
              <>
                <Icon size={22} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                <span>{label}</span>
                {badge ? (
                  <span className="nav-badge" aria-label={`${badge} предстоящих`}>
                    {badge}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
