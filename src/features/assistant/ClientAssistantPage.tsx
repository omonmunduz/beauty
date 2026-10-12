import { VStack } from '@astryxdesign/core/VStack';
import { useSlug, useStudio } from '@/features/studio/StudioRoot';
import { ChatPanel } from './ChatPanel';

export function ClientAssistantPage() {
  const slug = useSlug();
  const { tenant, services } = useStudio();
  const popular = services.find((s) => s.popular) ?? services[0];
  return (
    <div className="section" style={{ paddingTop: 'calc(var(--safe-t) + 24px)' }}>
      <VStack gap={4}>
        <VStack gap={1}>
          <span className="eyebrow">{tenant.name}</span>
          <h1 className="section-title" style={{ fontSize: 40, margin: 0 }}>
            Помощник
          </h1>
        </VStack>
        <ChatPanel
          slug={slug}
          scope="client"
          intro="Здравствуйте! Подскажу цены, свободное время у мастеров и как нас найти. Отвечаю по актуальному расписанию студии."
          suggestions={[
            'Когда ближайшее окно?',
            popular ? `Сколько стоит ${popular.name.toLowerCase()}?` : 'Какие у вас цены?',
            'Как вас найти?',
            'Какие мастера работают?',
          ]}
        />
      </VStack>
    </div>
  );
}
