import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';
import { Badge } from '@astryxdesign/core/Badge';
import {
  Certificate, Clock, Drop, Flower, Gift, HandHeart, Heart, Leaf, Lightning, ShieldCheck, Snowflake, Sparkle, Star, Thermometer,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { errorText } from '@/lib/errors';
import type { BookingStatus } from '@/lib/types';

/** Fades sections in as they scroll into view; respects prefers-reduced-motion via CSS. */
export function Reveal({ children, as: Tag = 'section', className = '', id }: { children: ReactNode; as?: 'section' | 'div'; className?: string; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} id={id} className={`reveal ${visible ? 'is-visible' : ''} ${className}`}>
      {children}
    </Tag>
  );
}

export function Photo({ src, alt, className, eager = false }: { src: string; alt: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={className} role="img" aria-label={alt} />;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : 'auto'}
      onError={() => setFailed(true)}
    />
  );
}

export function LoadingBlock({ rows = 4, label = 'Загрузка' }: { rows?: number; label?: string }) {
  return (
    <VStack gap={2} aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={56} index={i} radius={4} />
      ))}
    </VStack>
  );
}

export function ErrorBlock({ error, onRetry, title = 'Не удалось загрузить' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Banner
      status="error"
      title={title}
      description={errorText(error)}
      collapsible={false}
      endContent={onRetry ? <Button label="Повторить" size="sm" onClick={onRetry} /> : undefined}
    />
  );
}

const ICONS: Record<string, PhosphorIcon> = {
  sparkle: Sparkle,
  'shield-check': ShieldCheck,
  leaf: Leaf,
  clock: Clock,
  heart: Heart,
  drop: Drop,
  thermometer: Thermometer,
  star: Star,
  certificate: Certificate,
  gift: Gift,
  lightning: Lightning,
  'hand-heart': HandHeart,
  snowflake: Snowflake,
  flower: Flower,
};
export const INFO_ICON_NAMES = Object.keys(ICONS);

export function InfoIcon({ name, size = 22 }: { name: string; size?: number }) {
  const I = ICONS[name] ?? Sparkle;
  return <I size={size} weight="duotone" aria-hidden />;
}

const STATUS: Record<BookingStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'neutral' | 'error' }> = {
  confirmed: { label: 'Ожидается', variant: 'info' },
  arrived: { label: 'Пришла', variant: 'warning' },
  done: { label: 'Готово', variant: 'success' },
  cancelled: { label: 'Отменена', variant: 'neutral' },
  no_show: { label: 'Не пришла', variant: 'error' },
};
export function StatusBadge({ status }: { status: BookingStatus }) {
  const s = STATUS[status];
  return <Badge label={s.label} variant={s.variant} />;
}
export const statusLabel = (s: BookingStatus) => STATUS[s].label;

/** Stable idempotency key for one user intent; regenerated when the intent changes. */
export function useIdempotencyKey(deps: unknown[]): string {
  const [state, setState] = useState(() => ({ deps: JSON.stringify(deps), key: crypto.randomUUID() }));
  const next = JSON.stringify(deps);
  if (next !== state.deps) {
    const fresh = { deps: next, key: crypto.randomUUID() };
    setState(fresh);
    return fresh.key;
  }
  return state.key;
}
