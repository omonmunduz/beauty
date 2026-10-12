-- Availability, atomic booking and token-based client access.
-- All public entry points are SECURITY DEFINER with an empty search_path; the client
-- never supplies price, duration or tenant_id - they are derived from slug/service.

-- ------------------------------------------------------------- utilities
create or replace function private.request_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), ''),
    nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''),
    'local'
  )
$$;

-- Atomic fixed-window counter shared by every public endpoint and the AI budget.
create or replace function private.hit_rate(p_bucket text, p_max int, p_window_s int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  v_hits int;
begin
  insert into private.rate_counters as rc (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rc.hits + 1
  returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'retry_later';
  end if;
end $$;

create or replace function private.normalize_phone(p text) returns text
language sql immutable as $$
  select case
    when length(d) = 11 and left(d, 1) = '8' then '7' || substr(d, 2)
    when length(d) = 10 and left(d, 1) = '9' then '7' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function private.tenant_by_slug(p_slug text) returns public.tenants
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  select * into t from public.tenants where slug = lower(p_slug) and status in ('preview', 'live');
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0001';
  end if;
  return t;
end $$;

create or replace function private.token_for(p_booking uuid, p_idem uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(
    extensions.hmac(p_booking::text || ':' || p_idem::text,
                    (select value from private.settings where key = 'token_secret'), 'sha256'),
    'hex')
$$;

create or replace function private.token_hash(p_token text) returns bytea
language sql immutable as $$
  select extensions.digest(coalesce(p_token, ''), 'sha256')
$$;

create or replace function private.local_day(p_tenant uuid, p_at timestamptz) returns date
language sql stable set search_path = '' as $$
  select (p_at at time zone (select timezone from public.tenants where id = p_tenant))::date
$$;

-- ------------------------------------------------------------ schedule
-- Opening windows per local date. Working hours define when a visit may START.
create or replace function private.day_windows(p_tenant uuid, p_from date, p_to date)
returns table (day date, open_at timestamptz, close_at timestamptz)
language sql stable set search_path = '' as $$
  select d::date,
         (d::date + coalesce(ex.opens, wh.opens)) at time zone t.timezone,
         (d::date + coalesce(ex.closes, wh.closes)) at time zone t.timezone
  from public.tenants t
  cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  left join public.schedule_exceptions ex on ex.tenant_id = t.id and ex.day = d::date
  left join public.working_hours wh on wh.tenant_id = t.id and wh.weekday = extract(isodow from d)::int
  where t.id = p_tenant
    and case when ex.day is not null then ex.opens is not null else wh.weekday is not null end
$$;

-- Every grid start x every qualifying resource, with whether the resource is free for
-- the whole continuous range [start, start + duration + buffer) - even across days.
create or replace function private.slot_candidates(
  p_tenant uuid, p_service uuid, p_resource uuid, p_from date, p_to date
) returns table (starts_at timestamptz, resource_id uuid, is_free boolean)
language sql stable set search_path = '' as $$
  with t as (select * from public.tenants where id = p_tenant),
  s as (select * from public.services where id = p_service and tenant_id = p_tenant and active),
  starts as (
    select gs as starts_at
    from private.day_windows(p_tenant, p_from, p_to) w
    cross join s cross join t
    cross join lateral generate_series(
      w.open_at,
      case when s.allow_overnight then w.close_at - interval '1 minute'
           else w.close_at - make_interval(mins => s.duration_min) end,
      make_interval(mins => t.slot_step_min)) gs
    where gs >= now() + make_interval(mins => t.min_lead_min)
      and gs < now() + make_interval(days => t.horizon_days)
  ),
  r as (
    select rs.resource_id
    from public.resource_services rs
    join public.resources res on res.id = rs.resource_id and res.active
    where rs.tenant_id = p_tenant and rs.service_id = p_service
      and (p_resource is null or rs.resource_id = p_resource)
  )
  select st.starts_at, r.resource_id,
         not exists (
           select 1 from public.resource_occupancies o
           where o.resource_id = r.resource_id
             and o.period && tstzrange(st.starts_at,
                                       st.starts_at + make_interval(mins => s.duration_min + s.buffer_min), '[)'))
  from starts st cross join r cross join s
$$;

-- ---------------------------------------------------------- reminders
create or replace function private.schedule_reminders(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  t public.tenants;
  v_kind text;
  v_run timestamptz;
begin
  select * into b from public.bookings where id = p_booking;
  select * into t from public.tenants where id = b.tenant_id;

  -- Any pending job for an older start time (reschedule) or a dead booking is cancelled.
  update public.notification_jobs
     set status = 'cancelled', lease_until = null
   where booking_id = p_booking and status in ('pending', 'processing')
     and (booking_starts_at <> b.starts_at or b.status <> 'confirmed');

  -- Preview studios and demo rows never produce real notifications.
  if b.status <> 'confirmed' or b.is_demo or t.status <> 'live' then
    return;
  end if;

  if b.starts_at - interval '24 hours' > now() + interval '5 minutes' then
    v_kind := 'reminder_24h'; v_run := b.starts_at - interval '24 hours';
  elsif b.starts_at - interval '2 hours' > now() + interval '5 minutes' then
    v_kind := 'reminder_2h'; v_run := b.starts_at - interval '2 hours';
  else
    return;
  end if;

  insert into public.notification_jobs (tenant_id, booking_id, kind, run_at, booking_starts_at, dedupe_key)
  values (b.tenant_id, b.id, v_kind, v_run, b.starts_at,
          v_kind || ':' || b.id || ':' || extract(epoch from b.starts_at)::bigint)
  on conflict (dedupe_key) do nothing;
end $$;

-- --------------------------------------------------------------- booking
create or replace function private.booking_result(p_booking uuid, p_token text, p_replayed boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'booking_id', b.id,
    'token', p_token,
    'replayed', p_replayed,
    'status', b.status,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'service_name', b.service_name,
    'price', b.price,
    'resource_id', b.resource_id,
    'resource_name', r.name,
    'is_demo', b.is_demo)
  from public.bookings b join public.resources r on r.id = b.resource_id
  where b.id = p_booking
$$;

-- The one place a booking is created. Idempotent per (tenant, idempotency_key):
-- a retry with the same key returns the same booking and re-issues the same token.
create or replace function private.book(
  p_tenant uuid, p_service uuid, p_resource uuid, p_starts timestamptz,
  p_name text, p_phone text, p_notes text, p_idem uuid, p_source text, p_enforce_grid boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_phone text := private.normalize_phone(p_phone);
  v_name text := trim(coalesce(p_name, ''));
  v_hash text;
  v_existing public.bookings;
  v_client uuid;
  v_id uuid := gen_random_uuid();
  v_token text;
  v_candidates uuid[];
  v_any_start boolean;
  v_r uuid;
  v_booked boolean := false;
  v_constraint text;
begin
  if p_idem is null then
    raise exception 'idempotency_key_required' using errcode = 'P0001';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'invalid_notes' using errcode = 'P0001';
  end if;

  v_hash := md5(concat_ws('|', p_service, coalesce(p_resource::text, '*'), p_starts, v_phone));

  -- Replay of an already-completed request.
  select * into v_existing from public.bookings where tenant_id = p_tenant and idempotency_key = p_idem;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_conflict' using errcode = 'P0001';
    end if;
    return private.booking_result(v_existing.id, private.token_for(v_existing.id, p_idem), true);
  end if;

  select * into t from public.tenants where id = p_tenant;
  select * into s from public.services where id = p_service and tenant_id = p_tenant and active;
  if not found then
    raise exception 'service_not_found' using errcode = 'P0001';
  end if;

  if p_enforce_grid then
    select coalesce(array_agg(c.resource_id order by load.n, c.resource_id) filter (where c.is_free), '{}'),
           count(*) > 0
      into v_candidates, v_any_start
      from private.slot_candidates(p_tenant, p_service, p_resource,
                                   private.local_day(p_tenant, p_starts),
                                   private.local_day(p_tenant, p_starts)) c
      cross join lateral (
        select count(*) as n from public.bookings b
        where b.resource_id = c.resource_id and b.status <> 'cancelled'
          and private.local_day(p_tenant, b.starts_at) = private.local_day(p_tenant, p_starts)
      ) load
     where c.starts_at = p_starts;
    if not v_any_start then
      raise exception 'slot_invalid' using errcode = 'P0001';
    end if;
  else
    select coalesce(array_agg(r.id order by r.sort, r.id), '{}') into v_candidates
      from public.resources r
     where r.tenant_id = p_tenant and r.active
       and (case when p_resource is not null then r.id = p_resource
                 else exists (select 1 from public.resource_services rs
                              where rs.resource_id = r.id and rs.service_id = p_service) end);
    if cardinality(v_candidates) = 0 then
      raise exception 'resource_not_found' using errcode = 'P0001';
    end if;
  end if;

  if cardinality(v_candidates) = 0 then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  insert into public.clients as c (tenant_id, name, phone, phone_norm)
  values (p_tenant, v_name, trim(p_phone), v_phone)
  on conflict (tenant_id, phone_norm) do update set name = excluded.name
  returning id into v_client;

  v_token := private.token_for(v_id, p_idem);

  foreach v_r in array v_candidates loop
    begin
      insert into public.bookings (
        id, tenant_id, service_id, resource_id, client_id, starts_at, ends_at,
        service_name, price, duration_min, buffer_min, source, notes,
        idempotency_key, request_hash, access_token_hash, is_demo)
      values (
        v_id, p_tenant, s.id, v_r, v_client, p_starts, p_starts + make_interval(mins => s.duration_min),
        s.name, s.price, s.duration_min, s.buffer_min, p_source, coalesce(p_notes, ''),
        p_idem, v_hash, private.token_hash(v_token), t.status = 'preview');

      insert into public.resource_occupancies (tenant_id, resource_id, booking_id, kind, period, is_demo)
      values (p_tenant, v_r, v_id, 'booking',
              tstzrange(p_starts, p_starts + make_interval(mins => s.duration_min + s.buffer_min), '[)'),
              t.status = 'preview');
      v_booked := true;
      exit;
    exception
      when exclusion_violation then
        continue; -- this master just got taken; try the next free one
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'bookings_tenant_id_idempotency_key_key' then
          -- A concurrent identical request committed first: behave as a replay.
          select * into v_existing from public.bookings where tenant_id = p_tenant and idempotency_key = p_idem;
          if v_existing.request_hash <> v_hash then
            raise exception 'idempotency_conflict' using errcode = 'P0001';
          end if;
          return private.booking_result(v_existing.id, private.token_for(v_existing.id, p_idem), true);
        end if;
        raise;
    end;
  end loop;

  if not v_booked then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  perform private.schedule_reminders(v_id);
  return private.booking_result(v_id, v_token, false);
end $$;

-- --------------------------------------------------------- public API
create or replace function public.get_storefront(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'status', t.status, 'niche', t.niche, 'name', t.name,
      'tagline', t.tagline, 'about', t.about, 'timezone', t.timezone, 'currency', t.currency,
      'locale', t.locale, 'accent', t.accent, 'phone', t.phone, 'whatsapp', t.whatsapp,
      'telegram', t.telegram, 'instagram', t.instagram, 'address', t.address,
      'address_note', t.address_note, 'map_url', t.map_url, 'info_cards', t.info_cards,
      'cancel_hours', t.cancel_hours, 'horizon_days', t.horizon_days,
      'hero_url', t.hero_url, 'logo_url', t.logo_url),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', weekday, 'opens', opens, 'closes', closes) order by weekday)
                       from public.working_hours where tenant_id = t.id), '[]'),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'opens', opens, 'closes', closes, 'note', note) order by day)
                            from public.schedule_exceptions
                            where tenant_id = t.id and day >= (now() at time zone t.timezone)::date
                              and day < (now() at time zone t.timezone)::date + t.horizon_days), '[]'),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', s.id, 'category', s.category, 'name', s.name, 'description', s.description,
                            'duration_min', s.duration_min, 'price', s.price, 'price_is_from', s.price_is_from,
                            'popular', s.popular,
                            'resource_ids', coalesce((select jsonb_agg(rs.resource_id) from public.resource_services rs
                                                      join public.resources r on r.id = rs.resource_id and r.active
                                                      where rs.service_id = s.id), '[]'))
                            order by s.sort, s.name)
                          from public.services s where s.tenant_id = t.id and s.active), '[]'),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', r.id, 'kind', r.kind, 'name', r.name, 'role_title', r.role_title,
                             'bio', r.bio, 'photo_url', r.photo_url, 'experience_years', r.experience_years)
                             order by r.sort, r.name)
                           from public.resources r where r.tenant_id = t.id and r.active), '[]'),
    'gallery', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'image_url', g.image_url, 'caption', g.caption)
                                          order by g.sort, g.created_at)
                         from public.gallery_items g where g.tenant_id = t.id), '[]'));
end $$;

create or replace function public.get_availability(
  p_slug text, p_service_id uuid, p_resource_id uuid default null, p_from date default null, p_days int default 7
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_from date;
  v_to date;
  v_days int := least(greatest(coalesce(p_days, 7), 1), 31);
begin
  t := private.tenant_by_slug(p_slug);
  perform private.hit_rate('avail:' || private.request_ip(), 240, 60);
  v_from := greatest(coalesce(p_from, (now() at time zone t.timezone)::date), (now() at time zone t.timezone)::date);
  v_to := least(v_from + v_days - 1, (now() at time zone t.timezone)::date + t.horizon_days);

  if not exists (select 1 from public.services where id = p_service_id and tenant_id = t.id and active) then
    raise exception 'service_not_found' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'timezone', t.timezone,
    'from', v_from,
    'to', v_to,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d::date,
        'is_open', w.day is not null,
        'slots', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'start', x.starts_at,
                   'free', x.free_ids <> '{}',
                   'resource_ids', to_jsonb(x.free_ids)) order by x.starts_at)
          from (
            select c.starts_at, coalesce(array_agg(c.resource_id) filter (where c.is_free), '{}') as free_ids
            from private.slot_candidates(t.id, p_service_id, p_resource_id, d::date, d::date) c
            group by c.starts_at
          ) x), '[]'))
        order by d)
      from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
      left join private.day_windows(t.id, v_from, v_to) w on w.day = d::date), '[]'));
end $$;

create or replace function public.create_booking(
  p_slug text, p_service_id uuid, p_resource_id uuid, p_starts_at timestamptz,
  p_name text, p_phone text, p_notes text, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  perform private.hit_rate('book-ip:' || private.request_ip(), 20, 600);
  perform private.hit_rate('book-tenant:' || t.id, 300, 3600);
  return private.book(t.id, p_service_id, p_resource_id, p_starts_at, p_name, p_phone,
                      p_notes, p_idempotency_key, 'client', true);
end $$;

create or replace function private.booking_by_token(p_token text) returns public.bookings
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  select * into b from public.bookings where access_token_hash = private.token_hash(p_token);
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  return b;
end $$;

create or replace function public.get_booking(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  t public.tenants;
begin
  perform private.hit_rate('getb:' || private.request_ip(), 120, 60);
  b := private.booking_by_token(p_token);
  select * into t from public.tenants where id = b.tenant_id;
  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'service_name', b.service_name, 'price', b.price, 'duration_min', b.duration_min,
    'notes', b.notes, 'is_demo', b.is_demo,
    'client_name', (select name from public.clients where id = b.client_id),
    'resource', (select jsonb_build_object('id', r.id, 'name', r.name, 'role_title', r.role_title, 'photo_url', r.photo_url)
                 from public.resources r where r.id = b.resource_id),
    'tenant', jsonb_build_object('slug', t.slug, 'name', t.name, 'status', t.status, 'timezone', t.timezone,
                                 'address', t.address, 'phone', t.phone, 'currency', t.currency,
                                 'cancel_hours', t.cancel_hours, 'map_url', t.map_url),
    'cancel_deadline', b.starts_at - make_interval(hours => t.cancel_hours),
    'can_cancel', b.status = 'confirmed' and now() < b.starts_at - make_interval(hours => t.cancel_hours),
    'push_subscribed', exists (select 1 from public.push_subscriptions ps where ps.booking_id = b.id),
    'reminders_enabled', t.status = 'live' and not b.is_demo);
end $$;

create or replace function public.cancel_booking(p_token text, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  t public.tenants;
begin
  perform private.hit_rate('cancel:' || private.request_ip(), 20, 600);
  b := private.booking_by_token(p_token);
  select * into b from public.bookings where id = b.id for update;
  if b.status = 'cancelled' then
    return jsonb_build_object('id', b.id, 'status', b.status, 'replayed', true);
  end if;
  select * into t from public.tenants where id = b.tenant_id;
  if b.status <> 'confirmed' then
    raise exception 'cannot_cancel_status' using errcode = 'P0001';
  end if;
  if now() >= b.starts_at - make_interval(hours => t.cancel_hours) then
    raise exception 'cancel_window_closed' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client',
         cancel_reason = left(coalesce(p_reason, ''), 300), updated_at = now()
   where id = b.id;
  delete from public.resource_occupancies where booking_id = b.id;
  perform private.schedule_reminders(b.id);
  return jsonb_build_object('id', b.id, 'status', 'cancelled', 'replayed', false);
end $$;

create or replace function public.save_push_subscription(
  p_token text, p_endpoint text, p_p256dh text, p_auth text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform private.hit_rate('push:' || private.request_ip(), 30, 600);
  b := private.booking_by_token(p_token);
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'invalid_subscription' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions (tenant_id, booking_id, endpoint, p256dh, auth)
  values (b.tenant_id, b.id, p_endpoint, p_p256dh, p_auth)
  on conflict (booking_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  perform private.schedule_reminders(b.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.delete_push_subscription(p_token text, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.booking_by_token(p_token);
  delete from public.push_subscriptions where booking_id = b.id and endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $$;
