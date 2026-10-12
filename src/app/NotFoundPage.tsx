import { Theme } from '@astryxdesign/core';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Button } from '@astryxdesign/core/Button';
import { studioTheme } from '@/lib/theme';

export function NotFoundPage({ title = 'Страница не найдена', description = 'Проверьте ссылку или вернитесь на главную студии.', homeHref = '/' }) {
  return (
    <Theme theme={studioTheme()} mode="dark">
      <main className="app-shell center-screen">
        <EmptyState title={title} description={description} headingLevel={1} actions={<Button label="На главную" href={homeHref} variant="secondary" />} />
      </main>
    </Theme>
  );
}
