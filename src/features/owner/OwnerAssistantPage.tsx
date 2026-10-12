import { VStack } from '@astryxdesign/core/VStack';
import { ChatPanel } from '@/features/assistant/ChatPanel';
import { useOwner } from './OwnerRoot';

export function OwnerAssistantPage() {
  const { tenant } = useOwner();
  return (
    <>
      <header className="owner-top">
        <VStack gap={0}>
          <span className="eyebrow">{tenant.name}</span>
          <h1 style={{ margin: 0, fontSize: 24 }}>Помощник</h1>
        </VStack>
      </header>
      <div className="section" style={{ paddingTop: 16 }}>
        <ChatPanel
          slug={tenant.slug}
          scope="owner"
          intro="Отвечаю по записям и оплатам вашей студии. Ничего не меняю сам — только показываю данные."
          suggestions={['Что у меня завтра?', 'Сколько визитов на неделе?', 'Сколько денег получено за неделю?', 'Что у меня сегодня?']}
        />
      </div>
    </>
  );
}
