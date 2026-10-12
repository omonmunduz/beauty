import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, ChatCircleDots, MapPin, NavigationArrow, Phone, TelegramLogo, WhatsappLogo } from '@phosphor-icons/react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Button } from '@astryxdesign/core/Button';
import { api } from '@/lib/api';
import { duration, fmt, humanDate, localDate, phoneHref, plural, priceLabel } from '@/lib/format';
import { openStatus, weekTable } from '@/lib/hours';
import type { Service } from '@/lib/types';
import { InfoIcon, Photo, Reveal } from '@/components/ui';
import { useSlug, useStudio } from './StudioRoot';

function NextSlotHint({ service }: { service: Service }) {
  const slug = useSlug();
  const { tenant } = useStudio();
  const today = localDate(new Date(), tenant.timezone);
  const q = useQuery({
    queryKey: ['availability', slug, service.id, null, today, 7],
    queryFn: () => api.availability(slug, service.id, null, today, 7),
    staleTime: 60_000,
  });
  if (q.isPending) return <Text type="supporting">Ищем ближайшее окно…</Text>;
  if (q.isError) return null;
  for (const d of q.data.days) {
    const slot = d.slots.find((s) => s.free);
    if (slot) {
      return (
        <Link className="pill glass tap" to={`/s/${slug}/book?service=${service.id}&start=${encodeURIComponent(slot.start)}`}>
          <span className="pill--dot" style={{ ['--dot' as string]: 'var(--studio-accent)' }} />
          Ближайшее окно: {humanDate(d.date, tenant.timezone)}, {fmt(slot.start, tenant.timezone, 'HH:mm')}
        </Link>
      );
    }
  }
  return <Text type="supporting">На неделю вперёд всё занято — выберите другую дату в записи.</Text>;
}

export function HomePage() {
  const slug = useSlug();
  const sf = useStudio();
  const { tenant, services, resources, gallery } = sf;
  const status = useMemo(() => openStatus(sf), [sf]);
  const popular = useMemo(() => {
    const p = services.filter((s) => s.popular);
    return (p.length ? p : services).slice(0, 3);
  }, [services]);
  const categories = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of services) map.set(s.category || 'Услуги', [...(map.get(s.category || 'Услуги') ?? []), s]);
    return [...map.entries()];
  }, [services]);
  const minPrice = services.filter((s) => s.price > 0).reduce((m, s) => Math.min(m, s.price), Infinity);
  const book = `/s/${slug}/book`;

  return (
    <>
      <header className="hero">
        <Photo src={tenant.hero_url} alt="" className="hero__img" eager />
        <div className="hero__top">
          <span className="pill glass pill--dot" style={{ ['--dot' as string]: status.open ? '#6ad49a' : '#a9a0a6' }}>
            {status.text}
          </span>
          {tenant.phone && (
            <a className="icon-btn glass tap" href={phoneHref(tenant.phone)} aria-label={`Позвонить: ${tenant.phone}`}>
              <Phone size={19} weight="bold" aria-hidden />
            </a>
          )}
        </div>
        <div className="hero__body">
          <h1 className="hero__name">{tenant.name}</h1>
          {tenant.tagline && <p className="hero__tagline">{tenant.tagline}</p>}
          <div className="hero__meta">
            {Number.isFinite(minPrice) && <span className="pill glass">от {priceLabel(minPrice, tenant.currency)}</span>}
            <span className="pill glass">
              {resources.length} {plural(resources.length, 'мастер', 'мастера', 'мастеров')}
            </span>
            {tenant.address && (
              <span className="pill glass">
                <MapPin size={14} aria-hidden /> {tenant.address.split(',').slice(-2).join(',').trim()}
              </span>
            )}
          </div>
          <Link className="cta-glass glass tap" to={book}>
            <span>Записаться</span>
            <span className="cta-glass__arrow" aria-hidden>
              <ArrowRight size={20} weight="bold" />
            </span>
          </Link>
        </div>
      </header>

      <Reveal className="section" id="booking">
        <h2 className="section-title">Запись в студию</h2>
        <VStack gap={3}>
          <Text color="secondary">Выберите процедуру — покажем свободное время у мастеров. Без регистрации, около минуты.</Text>
          {popular[0] && <NextSlotHint service={popular[0]} />}
          <ul className="service-list" aria-label="Популярные процедуры">
            {popular.map((s) => (
              <li key={s.id}>
                <Link className="service-row tap" to={`${book}?service=${s.id}`} style={{ textDecoration: 'none' }}>
                  <span className="service-row__name">{s.name}</span>
                  <span className="service-row__price">{priceLabel(s.price, tenant.currency, s.price_is_from)}</span>
                  <span className="service-row__meta">
                    <span>{duration(s.duration_min)}</span>
                    <span className="service-row__go">Выбрать время →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Button label="Все услуги и цены" href={`/s/${slug}/services`} variant="secondary" width="100%" />
        </VStack>
      </Reveal>

      {tenant.info_cards.length > 0 && (
        <Reveal className="section">
          <div className="info-grid">
            {tenant.info_cards.map((c, i) => (
              <article key={i} className="info-card">
                <span className="info-card__icon">
                  <InfoIcon name={c.icon} />
                </span>
                <div>
                  <h3>{c.title}</h3>
                  <p>{c.text}</p>
                </div>
              </article>
            ))}
          </div>
        </Reveal>
      )}

      <Reveal className="section">
        <h2 className="section-title">Услуги и цены</h2>
        <VStack gap={5}>
          {categories.slice(0, 3).map(([cat, list]) => (
            <VStack gap={1} key={cat}>
              <span className="eyebrow">{cat}</span>
              <ul className="service-list">
                {list.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    <Link className="service-row tap" to={`${book}?service=${s.id}`} style={{ textDecoration: 'none' }}>
                      <span className="service-row__name">{s.name}</span>
                      <span className="service-row__price">{priceLabel(s.price, tenant.currency, s.price_is_from)}</span>
                      <span className="service-row__meta">{duration(s.duration_min)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </VStack>
          ))}
          <Link to={`/s/${slug}/services`} className="accent-text" style={{ fontWeight: 700 }}>
            Смотреть все {services.length} {plural(services.length, 'услугу', 'услуги', 'услуг')} →
          </Link>
        </VStack>
      </Reveal>

      {resources.length > 0 && (
        <Reveal className="section">
          <h2 className="section-title">Мастера</h2>
          <div className="rail" style={{ ['--rail-w' as string]: '44%' }}>
            {resources.map((m) => (
              <Link key={m.id} className="master-card tap" to={`${book}?master=${m.id}`} style={{ textDecoration: 'none' }} aria-label={`Записаться к мастеру ${m.name}`}>
                <span className="master-card__photo" data-empty={!m.photo_url}>
                  {m.photo_url ? <Photo src={m.photo_url} alt={m.name} /> : <span className="master-card__mono" aria-hidden>{m.name.charAt(0)}</span>}
                </span>
                <span>
                  <span className="master-card__name" style={{ display: 'block' }}>{m.name}</span>
                  <span className="master-card__role" style={{ display: 'block' }}>
                    {m.role_title}
                    {m.experience_years ? ` · ${m.experience_years} ${plural(m.experience_years, 'год', 'года', 'лет')}` : ''}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      {gallery.length > 0 && (
        <Reveal className="section">
          <h2 className="section-title">Наши работы</h2>
          <div className="rail">
            {gallery.map((g) => (
              <figure key={g.id} className="photo-card">
                <Photo src={g.image_url} alt={g.caption || 'Фото работы'} />
                {g.caption && <figcaption>{g.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </Reveal>
      )}

      {tenant.about && (
        <Reveal className="section">
          <h2 className="section-title">О студии</h2>
          <Text color="secondary" as="p">
            {tenant.about}
          </Text>
        </Reveal>
      )}

      <Reveal className="section">
        <h2 className="section-title">Как нас найти</h2>
        <VStack gap={3}>
          <div className="contact-card">
            {tenant.address && (
              <a className="contact-row" href={tenant.map_url || undefined} target="_blank" rel="noopener noreferrer">
                <MapPin size={20} aria-hidden className="accent-text" />
                <span>
                  <strong style={{ display: 'block' }}>{tenant.address}</strong>
                  {tenant.address_note && <span className="muted" style={{ fontSize: 13 }}>{tenant.address_note}</span>}
                </span>
                {tenant.map_url ? <NavigationArrow size={18} aria-label="Маршрут" /> : <span />}
              </a>
            )}
            {tenant.phone && (
              <a className="contact-row" href={phoneHref(tenant.phone)}>
                <Phone size={20} aria-hidden className="accent-text" />
                <span>{tenant.phone}</span>
                <ArrowUpRight size={16} aria-hidden />
              </a>
            )}
            {tenant.whatsapp && (
              <a className="contact-row" href={`https://wa.me/${tenant.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
                <WhatsappLogo size={20} aria-hidden className="accent-text" />
                <span>WhatsApp</span>
                <ArrowUpRight size={16} aria-hidden />
              </a>
            )}
            {tenant.telegram && (
              <a className="contact-row" href={`https://t.me/${tenant.telegram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">
                <TelegramLogo size={20} aria-hidden className="accent-text" />
                <span>Telegram</span>
                <ArrowUpRight size={16} aria-hidden />
              </a>
            )}
          </div>
          <div className="contact-card" style={{ padding: 16 }}>
            <Heading level={3}>Часы работы</Heading>
            <table className="hours-table" style={{ marginTop: 8 }}>
              <tbody>
                {weekTable(sf).map((r) => (
                  <tr key={r.day} data-today={r.today}>
                    <td>{r.day}</td>
                    <td>{r.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link className="cta-glass glass tap" to={`/s/${slug}/chat`} style={{ minHeight: 54 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ChatCircleDots size={20} aria-hidden /> Спросить помощника
            </span>
            <ArrowRight size={18} aria-hidden style={{ marginRight: 12 }} />
          </Link>
        </VStack>
      </Reveal>

      <footer className="section" style={{ paddingBottom: 8 }}>
        <Text type="supporting">
          © {tenant.name}. <Link to={`/s/${slug}/owner`} style={{ color: 'inherit' }}>Кабинет студии</Link>
        </Text>
      </footer>
    </>
  );
}
