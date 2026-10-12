import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Star } from '@phosphor-icons/react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import { duration, plural, priceLabel } from '@/lib/format';
import { useSlug, useStudio } from './StudioRoot';

export function ServicesPage() {
  const slug = useSlug();
  const { tenant, services, resources } = useStudio();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const categories = useMemo(() => [...new Set(services.map((s) => s.category || 'Услуги'))], [services]);
  const masterName = useMemo(() => new Map(resources.map((r) => [r.id, r.name.split(' ')[0]])), [resources]);

  // First names when they tell masters apart, otherwise just how many can do it.
  const mastersLabel = (ids: string[]) => {
    const names = ids.map((id) => masterName.get(id)).filter(Boolean);
    return new Set(names).size === names.length ? names.join(', ') : `${names.length} ${plural(names.length, 'мастер', 'мастера', 'мастеров')}`;
  };
  const filtered = services.filter((s) => {
    const q = query.trim().toLowerCase();
    if (category !== 'all' && (s.category || 'Услуги') !== category) return false;
    return !q || `${s.name} ${s.category} ${s.description}`.toLowerCase().includes(q);
  });
  const grouped = categories
    .map((c) => [c, filtered.filter((s) => (s.category || 'Услуги') === c)] as const)
    .filter(([, list]) => list.length);

  return (
    <div className="section" style={{ paddingTop: 'calc(var(--safe-t) + 24px)' }}>
      <VStack gap={4}>
        <VStack gap={1}>
          <span className="eyebrow">{tenant.name}</span>
          <h1 className="section-title" style={{ fontSize: 40, margin: 0 }}>
            Услуги и цены
          </h1>
        </VStack>
        <TextInput label="Поиск услуги" isLabelHidden placeholder="Например, бикини" value={query} onChange={setQuery} hasClear size="lg" />
        <div className="chips" role="group" aria-label="Категории">
          <button type="button" className="chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            Все
          </button>
          {categories.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        {grouped.length === 0 ? (
          <EmptyState title="Ничего не нашли" description="Попробуйте другое слово или спросите помощника." isCompact />
        ) : (
          grouped.map(([cat, list]) => (
            <VStack gap={1} key={cat}>
              <h2 className="eyebrow" style={{ margin: 0 }}>
                {cat}
              </h2>
              <ul className="service-list">
                {list.map((s) => (
                  <li key={s.id}>
                    <Link className="service-row tap" to={`/s/${slug}/book?service=${s.id}`} style={{ textDecoration: 'none' }}>
                      <span className="service-row__name">{s.name}</span>
                      <span className="service-row__price">{priceLabel(s.price, tenant.currency, s.price_is_from)}</span>
                      {s.description && <span className="service-row__desc">{s.description}</span>}
                      <span className="service-row__meta">
                        {s.popular && (
                          <span className="tag-popular">
                            <Star size={11} weight="fill" aria-hidden /> Популярное
                          </span>
                        )}
                        <span>{duration(s.duration_min)}</span>
                        <span>· {mastersLabel(s.resource_ids)}</span>
                        <span className="service-row__go" style={{ marginLeft: 'auto' }}>
                          Записаться →
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </VStack>
          ))
        )}
      </VStack>
    </div>
  );
}
