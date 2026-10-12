import { useSyncExternalStore } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { installPrompt, isIos, isStandalone } from '@/lib/pwa';

/** Optional install suggestion; never blocks booking. */
export function InstallHint() {
  const available = useSyncExternalStore(installPrompt.subscribe, installPrompt.available);
  if (isStandalone()) return null;
  if (available) {
    return (
      <Banner
        status="info"
        title="Добавить студию на экран"
        description="Откроется как приложение, без адресной строки — запись в одно касание."
        collapsible={false}
        endContent={<Button label="Установить" size="sm" onClick={() => void installPrompt.prompt()} />}
      />
    );
  }
  if (isIos()) {
    return (
      <Banner
        status="info"
        title="Добавить на экран «Домой»"
        description="В Safari нажмите «Поделиться» → «На экран Домой». Так же включаются напоминания на iPhone."
        collapsible={false}
      />
    );
  }
  return null;
}
