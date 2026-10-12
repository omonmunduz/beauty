import { useEffect, useRef } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router';

// Moves keyboard/screen-reader focus to the new page's main heading on navigation,
// so route changes are announced and Tab starts from the top of the new content.
function FocusOnNavigate() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const target = document.querySelector<HTMLElement>('main h1, main [data-page-title]');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  }, [pathname]);
  return null;
}

export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration getKey={(loc) => loc.pathname} />
      <FocusOnNavigate />
    </>
  );
}
