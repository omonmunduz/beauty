import { Link } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CaretRight, Clock, ImageSquare, Images, ListBullets, Rocket, Storefront, UsersThree, ArrowSquareOut } from '@phosphor-icons/react';
import { useOwner } from '../OwnerRoot';

export const SECTIONS = [
  { id: 'profile', label: 'Студия и контакты', hint: 'Название, адрес, телефон, карточки на главной', icon: Storefront },
  { id: 'media', label: 'Логотип и главное фото', hint: 'То, что клиент видит первым', icon: ImageSquare },
  { id: 'services', label: 'Услуги и цены', hint: 'Цены, длительность, кто выполняет', icon: ListBullets },
  { id: 'masters', label: 'Мастера', hint: 'Фото, специализация, активность', icon: UsersThree },
  { id: 'hours', label: 'График и выходные', hint: 'Часы работы и особые дни', icon: Clock },
  { id: 'gallery', label: 'Фото работ', hint: 'Добавить, заменить фото, изменить подпись', icon: Images },
  { id: 'launch', label: 'Запуск', hint: 'Проверка и перевод из превью в работу', icon: Rocket },
] as const;

export function SettingsPage() {
  const { tenant, session, signOut } = useOwner();
  return (
    <>
      <header className="owner-top">
        <VStack gap={0}>
          <span className="eyebrow">{tenant.name}</span>
          <h1 style={{ margin: 0, fontSize: 24 }}>Настройки</h1>
        </VStack>
      </header>
      <div className="section" style={{ paddingTop: 16 }}>
        <VStack gap={4}>
          <nav className="settings-list" aria-label="Разделы настроек">
            {SECTIONS.map(({ id, label, hint, icon: Icon }) => (
              <Link key={id} to={id} className="settings-item tap">
                <Icon size={22} className="accent-text" aria-hidden />
                <span>
                  <span style={{ display: 'block', fontWeight: 650 }}>{label}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {hint}
                  </span>
                </span>
                <CaretRight size={16} aria-hidden />
              </Link>
            ))}
          </nav>
          <Button label="Открыть страницу студии" icon={<ArrowSquareOut size={18} />} href={`/s/${tenant.slug}`} target="_blank" />
          <VStack gap={1}>
            <Text type="supporting">Вы вошли как {session.user.email}</Text>
            <Button label="Выйти из кабинета" variant="ghost" onClick={() => void signOut()} />
          </VStack>
        </VStack>
      </div>
    </>
  );
}
