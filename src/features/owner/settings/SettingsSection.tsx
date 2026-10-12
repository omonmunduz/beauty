import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { CaretLeft } from '@phosphor-icons/react';
import { useOwner } from '../OwnerRoot';
import { SECTIONS } from './SettingsPage';
import { ProfileSection } from './ProfileSection';
import { MediaSection } from './MediaSection';
import { ServicesSection } from './ServicesSection';
import { MastersSection } from './MastersSection';
import { HoursSection } from './HoursSection';
import { GallerySection } from './GallerySection';
import { LaunchSection } from './LaunchSection';

/** After any settings change: refresh the cabinet and the public storefront. */
export function useRefreshStudio() {
  const qc = useQueryClient();
  const { tenant } = useOwner();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['owner-context', tenant.slug] }),
      qc.invalidateQueries({ queryKey: ['owner', tenant.id] }),
      qc.invalidateQueries({ queryKey: ['storefront', tenant.slug] }),
      qc.invalidateQueries({ queryKey: ['availability', tenant.slug] }),
    ]);
}

const VIEWS: Record<string, () => React.JSX.Element> = {
  profile: ProfileSection,
  media: MediaSection,
  services: ServicesSection,
  masters: MastersSection,
  hours: HoursSection,
  gallery: GallerySection,
  launch: LaunchSection,
};

export function SettingsSection() {
  const { section = '' } = useParams();
  const { tenant } = useOwner();
  const meta = SECTIONS.find((s) => s.id === section);
  const View = VIEWS[section];
  return (
    <>
      <header className="owner-top">
        <HStack gap={2} vAlign="center">
          <Link to={`/s/${tenant.slug}/owner/settings`} className="icon-btn tap" aria-label="Назад к настройкам">
            <CaretLeft size={20} />
          </Link>
          <VStack gap={0}>
            <span className="eyebrow">Настройки</span>
            <h1 style={{ margin: 0, fontSize: 22 }}>{meta?.label ?? 'Раздел'}</h1>
          </VStack>
        </HStack>
      </header>
      <div className="section" style={{ paddingTop: 16 }}>{View ? <View /> : <EmptyState title="Раздел не найден" />}</div>
    </>
  );
}
