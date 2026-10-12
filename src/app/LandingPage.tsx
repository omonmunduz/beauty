import { Theme } from '@astryxdesign/core';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { studioTheme } from '@/lib/theme';

// The bare domain intentionally lists no studios: each owner receives only their own link.
export function LandingPage() {
  return (
    <Theme theme={studioTheme()} mode="dark">
      <main className="app-shell center-screen">
        <VStack gap={3} hAlign="center">
          <span className="eyebrow">Онлайн-запись</span>
          <Heading level={1}>
            <span className="display">Запись в студию по ссылке</span>
          </Heading>
          <Text color="secondary">Откройте ссылку вашей студии вида /s/название/ — она пришла вам в сообщении.</Text>
        </VStack>
      </main>
    </Theme>
  );
}
