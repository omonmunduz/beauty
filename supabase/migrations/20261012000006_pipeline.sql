-- Tenant pipeline: tenants/<slug>/business.json -> normalized JSON -> this function.
-- Republishing updates config-owned rows (matched by config_key) and never touches
-- bookings, payments, clients, owner-uploaded photos or owner-created catalog rows.

create or replace function private.apply_business_config(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_item jsonb;
  v_master_keys text[];
  v_service_keys text[];
  v_gallery_keys text[];
  v_sort int;
begin
  insert into public.tenants as t (
    slug, niche, name, tagline, about, timezone, currency, locale, accent,
    phone, whatsapp, telegram, instagram, address, address_note, map_url, info_cards,
    cancel_hours, slot_step_min, horizon_days, min_lead_min, hero_url, logo_url,
    config_version, published_at)
  values (
    p ->> 'slug', coalesce(p ->> 'niche', 'depilation'), p ->> 'name', coalesce(p ->> 'tagline', ''),
    coalesce(p ->> 'about', ''), p ->> 'timezone', coalesce(p ->> 'currency', 'RUB'),
    coalesce(p ->> 'locale', 'ru-RU'), p ->> 'accent',
    coalesce(p ->> 'phone', ''), coalesce(p ->> 'whatsapp', ''), coalesce(p ->> 'telegram', ''),
    coalesce(p ->> 'instagram', ''), coalesce(p ->> 'address', ''), coalesce(p ->> 'address_note', ''),
    coalesce(p ->> 'map_url', ''), coalesce(p -> 'info_cards', '[]'),
    coalesce((p ->> 'cancel_hours')::int, 12), coalesce((p ->> 'slot_step_min')::int, 15),
    coalesce((p ->> 'horizon_days')::int, 30), coalesce((p ->> 'min_lead_min')::int, 60),
    coalesce(p ->> 'hero_url', ''), coalesce(p ->> 'logo_url', ''), 1, now())
  on conflict (slug) do update set
    niche = excluded.niche, name = excluded.name, tagline = excluded.tagline, about = excluded.about,
    timezone = excluded.timezone, currency = excluded.currency, locale = excluded.locale,
    accent = excluded.accent, phone = excluded.phone, whatsapp = excluded.whatsapp,
    telegram = excluded.telegram, instagram = excluded.instagram, address = excluded.address,
    address_note = excluded.address_note, map_url = excluded.map_url, info_cards = excluded.info_cards,
    cancel_hours = excluded.cancel_hours, slot_step_min = excluded.slot_step_min,
    horizon_days = excluded.horizon_days, min_lead_min = excluded.min_lead_min,
    hero_url = case when t.hero_source = 'owner' then t.hero_url else excluded.hero_url end,
    logo_url = case when t.logo_source = 'owner' then t.logo_url else excluded.logo_url end,
    config_version = t.config_version + 1, published_at = now()
  returning id into v_tenant;

  -- Hours and date exceptions are fully config-owned.
  delete from public.working_hours where tenant_id = v_tenant;
  insert into public.working_hours (tenant_id, weekday, opens, closes)
  select v_tenant, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
  from jsonb_array_elements(coalesce(p -> 'hours', '[]')) h;

  delete from public.schedule_exceptions where tenant_id = v_tenant;
  insert into public.schedule_exceptions (tenant_id, day, opens, closes, note)
  select v_tenant, (e ->> 'date')::date, (e ->> 'opens')::time, (e ->> 'closes')::time, coalesce(e ->> 'note', '')
  from jsonb_array_elements(coalesce(p -> 'exceptions', '[]')) e;

  -- Masters.
  v_sort := 0;
  v_master_keys := '{}';
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'masters', '[]')) loop
    v_sort := v_sort + 1;
    v_master_keys := v_master_keys || (v_item ->> 'key');
    insert into public.resources as r (tenant_id, config_key, kind, name, role_title, bio, photo_url,
                                       experience_years, active, sort)
    values (v_tenant, v_item ->> 'key', coalesce(v_item ->> 'kind', 'master'), v_item ->> 'name',
            coalesce(v_item ->> 'role_title', ''), coalesce(v_item ->> 'bio', ''),
            coalesce(v_item ->> 'photo_url', ''), (v_item ->> 'experience_years')::int, true, v_sort)
    on conflict (tenant_id, config_key) do update set
      kind = excluded.kind, name = excluded.name, role_title = excluded.role_title, bio = excluded.bio,
      photo_url = case when r.photo_source = 'owner' then r.photo_url else excluded.photo_url end,
      experience_years = excluded.experience_years, active = true, sort = excluded.sort;
  end loop;
  update public.resources set active = false
   where tenant_id = v_tenant and config_key is not null and not (config_key = any (v_master_keys));

  -- Services. Prices change for future bookings only; existing bookings keep their snapshot.
  v_sort := 0;
  v_service_keys := '{}';
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'services', '[]')) loop
    v_sort := v_sort + 1;
    v_service_keys := v_service_keys || (v_item ->> 'key');
    insert into public.services as s (tenant_id, config_key, category, name, description, duration_min,
                                      buffer_min, price, price_is_from, allow_overnight, popular, active, sort)
    values (v_tenant, v_item ->> 'key', coalesce(v_item ->> 'category', ''), v_item ->> 'name',
            coalesce(v_item ->> 'description', ''), (v_item ->> 'duration_min')::int,
            coalesce((v_item ->> 'buffer_min')::int, 0), (v_item ->> 'price')::numeric,
            coalesce((v_item ->> 'price_is_from')::boolean, false),
            coalesce((v_item ->> 'allow_overnight')::boolean, false),
            coalesce((v_item ->> 'popular')::boolean, false), true, v_sort)
    on conflict (tenant_id, config_key) do update set
      category = excluded.category, name = excluded.name, description = excluded.description,
      duration_min = excluded.duration_min, buffer_min = excluded.buffer_min, price = excluded.price,
      price_is_from = excluded.price_is_from, allow_overnight = excluded.allow_overnight,
      popular = excluded.popular, active = true, sort = excluded.sort, updated_at = now();
  end loop;
  update public.services set active = false
   where tenant_id = v_tenant and config_key is not null and not (config_key = any (v_service_keys));

  delete from public.resource_services rs
   using public.services s, public.resources r
   where rs.service_id = s.id and rs.resource_id = r.id and rs.tenant_id = v_tenant
     and s.config_key is not null and r.config_key is not null;
  insert into public.resource_services (tenant_id, resource_id, service_id)
  select v_tenant, r.id, s.id
  from jsonb_array_elements(coalesce(p -> 'services', '[]')) sv
  cross join lateral jsonb_array_elements_text(sv -> 'masters') mk
  join public.services s on s.tenant_id = v_tenant and s.config_key = sv ->> 'key'
  join public.resources r on r.tenant_id = v_tenant and r.config_key = mk
  on conflict do nothing;

  -- Gallery: config cards are upserted unless the owner has taken them over.
  v_sort := 0;
  v_gallery_keys := '{}';
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'gallery', '[]')) loop
    v_sort := v_sort + 1;
    v_gallery_keys := v_gallery_keys || (v_item ->> 'key');
    insert into public.gallery_items as g (tenant_id, config_key, image_url, caption, source, sort)
    values (v_tenant, v_item ->> 'key', v_item ->> 'image_url', coalesce(v_item ->> 'caption', ''), 'config', v_sort)
    on conflict (tenant_id, config_key) do update set
      image_url = case when g.source = 'owner' then g.image_url else excluded.image_url end,
      caption = case when g.source = 'owner' then g.caption else excluded.caption end,
      sort = case when g.source = 'owner' then g.sort else excluded.sort end,
      updated_at = now();
  end loop;
  delete from public.gallery_items
   where tenant_id = v_tenant and source = 'config' and config_key is not null
     and not (config_key = any (v_gallery_keys));

  return v_tenant;
end $$;

-- Demo traffic for preview studios only: clearly flagged rows (is_demo) so the owner
-- cabinet and statistics look alive. They are deleted on go-live.
create or replace function private.seed_demo_bookings(p_tenant uuid, p_count int default 24) returns int
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_names text[] := array['Анна', 'Мария', 'Екатерина', 'Ольга', 'Дарья', 'Алина', 'Виктория', 'Полина',
                          'Ксения', 'Наталья', 'Юлия', 'София'];
  v_made int := 0;
  v_try int := 0;
  v_service public.services;
  v_res uuid;
  v_day date;
  v_start timestamptz;
  v_open time;
  v_result jsonb;
  v_status text;
begin
  select * into t from public.tenants where id = p_tenant;
  if t.status <> 'preview' then
    raise exception 'demo_only_in_preview' using errcode = 'P0001';
  end if;
  perform setseed(0.42);
  while v_made < p_count and v_try < p_count * 8 loop
    v_try := v_try + 1;
    select * into v_service from public.services where tenant_id = p_tenant and active order by random() limit 1;
    select rs.resource_id into v_res from public.resource_services rs where rs.service_id = v_service.id
      order by random() limit 1;
    v_day := (now() at time zone t.timezone)::date + (floor(random() * 14) - 6)::int;
    select coalesce(ex.opens, wh.opens) into v_open
      from (select 1) x
      left join public.schedule_exceptions ex on ex.tenant_id = p_tenant and ex.day = v_day
      left join public.working_hours wh on wh.tenant_id = p_tenant and wh.weekday = extract(isodow from v_day)::int;
    continue when v_open is null or v_res is null;
    v_start := (v_day + v_open + make_interval(mins => (floor(random() * 16) * 30)::int)) at time zone t.timezone;
    begin
      v_result := private.book(p_tenant, v_service.id, v_res, v_start, v_names[1 + floor(random() * 12)::int],
                               '+7 9' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0'),
                               '', gen_random_uuid(), case when random() < 0.7 then 'client' else 'owner' end, false);
    exception when others then
      continue;
    end;
    v_made := v_made + 1;
    if v_start < now() then
      v_status := case when random() < 0.85 then 'done' else 'no_show' end;
      update public.bookings set status = v_status,
             arrived_at = case when v_status = 'done' then v_start end,
             done_at = case when v_status = 'done' then v_start + make_interval(mins => duration_min) end
       where id = (v_result ->> 'booking_id')::uuid;
      if v_status = 'done' then
        insert into public.payments (tenant_id, booking_id, kind, amount, method, created_at)
        select p_tenant, b.id, 'payment', b.price, case when random() < 0.6 then 'card' else 'cash' end,
               b.ends_at
        from public.bookings b where b.id = (v_result ->> 'booking_id')::uuid and b.price > 0;
      end if;
    end if;
  end loop;
  return v_made;
end $$;

revoke execute on function private.apply_business_config(jsonb) from public;
revoke execute on function private.seed_demo_bookings(uuid, int) from public;
