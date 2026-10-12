-- Owner cabinet: membership-checked RPCs. Every function derives the tenant from the
-- booking/resource row and verifies auth.uid() is a member of that tenant on the server.

create or replace function private.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid())
$$;

create or replace function private.assert_member(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(p_tenant) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
end $$;

create or replace function private.owned_booking(p_booking uuid, p_lock boolean default false) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if p_lock then
    select * into b from public.bookings where id = p_booking for update;
  else
    select * into b from public.bookings where id = p_booking;
  end if;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  perform private.assert_member(b.tenant_id);
  return b;
end $$;

-- Resolve /s/{slug}/owner/ to a tenant the signed-in user is allowed to manage.
create or replace function public.owner_context(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  m public.tenant_members;
begin
  select * into t from public.tenants where slug = lower(p_slug);
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0001';
  end if;
  select * into m from public.tenant_members where tenant_id = t.id and user_id = auth.uid();
  if not found then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return jsonb_build_object('tenant', to_jsonb(t), 'role', m.role);
end $$;

-- Schedule for a local date range: bookings with client contacts, payments, blocks.
create or replace function public.owner_schedule(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.assert_member(p_tenant);
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  select timezone into tz from public.tenants where id = p_tenant;
  v_start := p_from::timestamp at time zone tz;
  v_end := (p_to + 1)::timestamp at time zone tz;
  return jsonb_build_object(
    'timezone', tz,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
        'service_id', b.service_id, 'service_name', b.service_name, 'price', b.price,
        'duration_min', b.duration_min, 'resource_id', b.resource_id, 'resource_name', r.name,
        'client_name', c.name, 'client_phone', c.phone, 'notes', b.notes, 'source', b.source,
        'is_demo', b.is_demo, 'cancel_reason', b.cancel_reason, 'cancelled_by', b.cancelled_by,
        'paid', coalesce(p.paid, 0), 'refunded', coalesce(p.refunded, 0))
        order by b.starts_at)
      from public.bookings b
      join public.resources r on r.id = b.resource_id
      join public.clients c on c.id = b.client_id
      left join lateral (
        select sum(amount) filter (where kind = 'payment') as paid,
               sum(amount) filter (where kind = 'refund') as refunded
        from public.payments where booking_id = b.id) p on true
      where b.tenant_id = p_tenant and b.starts_at < v_end and b.ends_at > v_start), '[]'),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'resource_id', o.resource_id, 'resource_name', r.name,
        'starts_at', lower(o.period), 'ends_at', upper(o.period), 'note', o.note)
        order by lower(o.period))
      from public.resource_occupancies o join public.resources r on r.id = o.resource_id
      where o.tenant_id = p_tenant and o.kind = 'block' and o.period && tstzrange(v_start, v_end, '[)')), '[]'));
end $$;

create or replace function public.owner_booking_payments(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.owned_booking(p_booking);
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', id, 'kind', kind, 'amount', amount, 'method', method, 'note', note, 'created_at', created_at)
            order by created_at)
          from public.payments where booking_id = b.id), '[]');
end $$;

create or replace function public.owner_create_booking(
  p_tenant uuid, p_service_id uuid, p_resource_id uuid, p_starts_at timestamptz,
  p_name text, p_phone text, p_notes text, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_tenant);
  -- Owners may book outside the public slot grid (e.g. stay late), but never onto a busy master.
  return private.book(p_tenant, p_service_id, p_resource_id, p_starts_at, p_name, p_phone,
                      p_notes, p_idempotency_key, 'owner', false);
end $$;

-- Atomic move: the occupancy row is updated in the same statement batch as the booking.
-- If the target range is taken the EXCLUDE constraint aborts and the original stays intact.
create or replace function public.owner_reschedule(
  p_booking uuid, p_starts_at timestamptz, p_resource_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_resource uuid;
begin
  b := private.owned_booking(p_booking, true);
  if b.status <> 'confirmed' then
    raise exception 'cannot_reschedule_status' using errcode = 'P0001';
  end if;
  v_resource := coalesce(p_resource_id, b.resource_id);
  if not exists (select 1 from public.resources where id = v_resource and tenant_id = b.tenant_id and active) then
    raise exception 'resource_not_found' using errcode = 'P0001';
  end if;
  if b.starts_at = p_starts_at and b.resource_id = v_resource then
    return private.booking_result(b.id, null, true);
  end if;
  begin
    update public.resource_occupancies
       set resource_id = v_resource,
           period = tstzrange(p_starts_at, p_starts_at + make_interval(mins => b.duration_min + b.buffer_min), '[)')
     where booking_id = b.id;
    update public.bookings
       set starts_at = p_starts_at,
           ends_at = p_starts_at + make_interval(mins => b.duration_min),
           resource_id = v_resource, updated_at = now()
     where id = b.id;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  end;
  perform private.schedule_reminders(b.id);
  return private.booking_result(b.id, null, false);
end $$;

create or replace function public.owner_cancel_booking(p_booking uuid, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.owned_booking(p_booking, true);
  if b.status = 'cancelled' then
    return private.booking_result(b.id, null, true);
  end if;
  if b.status not in ('confirmed', 'no_show') then
    raise exception 'cannot_cancel_status' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner',
         cancel_reason = left(coalesce(p_reason, ''), 300), updated_at = now()
   where id = b.id;
  delete from public.resource_occupancies where booking_id = b.id;
  perform private.schedule_reminders(b.id);
  return private.booking_result(b.id, null, false);
end $$;

create or replace function public.owner_set_status(p_booking uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_ok boolean;
begin
  b := private.owned_booking(p_booking, true);
  if b.status = p_status then
    return private.booking_result(b.id, null, true);
  end if;
  v_ok := (b.status, p_status) in (
    ('confirmed', 'arrived'), ('confirmed', 'done'), ('confirmed', 'no_show'),
    ('arrived', 'done'), ('arrived', 'confirmed'), ('done', 'arrived'), ('no_show', 'confirmed'));
  if not v_ok then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = p_status, updated_at = now(),
         arrived_at = case when p_status in ('arrived', 'done') then coalesce(arrived_at, now())
                           when p_status = 'confirmed' then null else arrived_at end,
         done_at = case when p_status = 'done' then now() when p_status <> 'done' then null end
   where id = b.id;
  perform private.schedule_reminders(b.id);
  return private.booking_result(b.id, null, false);
end $$;

create or replace function public.owner_add_payment(
  p_booking uuid, p_kind text, p_amount numeric, p_method text, p_note text, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_net numeric;
  v_id uuid;
begin
  b := private.owned_booking(p_booking, true); -- row lock serializes concurrent refunds
  if p_kind not in ('payment', 'refund') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if p_idempotency_key is not null then
    select id into v_id from public.payments where tenant_id = b.tenant_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;
  if p_kind = 'refund' then
    select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) into v_net
      from public.payments where booking_id = b.id;
    if p_amount > v_net then
      raise exception 'refund_exceeds_paid' using errcode = 'P0001';
    end if;
  end if;
  insert into public.payments (tenant_id, booking_id, kind, amount, method, note, idempotency_key, created_by)
  values (b.tenant_id, b.id, p_kind, round(p_amount, 2), coalesce(p_method, 'card'), left(coalesce(p_note, ''), 300),
          p_idempotency_key, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

create or replace function public.owner_block_resource(
  p_resource uuid, p_from timestamptz, p_to timestamptz, p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.resources;
  v_id uuid;
begin
  select * into r from public.resources where id = p_resource;
  if not found then
    raise exception 'resource_not_found' using errcode = 'P0001';
  end if;
  perform private.assert_member(r.tenant_id);
  if p_to <= p_from or p_to - p_from > interval '60 days' then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  begin
    insert into public.resource_occupancies (tenant_id, resource_id, kind, period, note)
    values (r.tenant_id, r.id, 'block', tstzrange(p_from, p_to, '[)'), left(coalesce(p_note, ''), 200))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.owner_unblock(p_occupancy uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.resource_occupancies;
begin
  select * into o from public.resource_occupancies where id = p_occupancy and kind = 'block';
  if not found then
    raise exception 'block_not_found' using errcode = 'P0001';
  end if;
  perform private.assert_member(o.tenant_id);
  delete from public.resource_occupancies where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

-- Statistics are computed in SQL, in the studio timezone, for a local date range.
-- visits    = clients who actually came (arrived or done) with a visit start in the range
-- completed = visits marked done
-- received  = payments minus refunds registered in the range (cash basis, real money)
-- expected  = price of still-confirmed future visits in the range; NOT revenue
create or replace function public.owner_stats(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.assert_member(p_tenant);
  if p_to < p_from or p_to - p_from > 370 then
    raise exception 'invalid_range' using errcode = 'P0001';
  end if;
  select timezone into tz from public.tenants where id = p_tenant;
  v_start := p_from::timestamp at time zone tz;
  v_end := (p_to + 1)::timestamp at time zone tz;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', tz,
    'visits', (select count(*) from public.bookings
               where tenant_id = p_tenant and starts_at >= v_start and starts_at < v_end
                 and status in ('arrived', 'done')),
    'completed', (select count(*) from public.bookings
                  where tenant_id = p_tenant and starts_at >= v_start and starts_at < v_end and status = 'done'),
    'booked', (select count(*) from public.bookings
               where tenant_id = p_tenant and starts_at >= v_start and starts_at < v_end and status <> 'cancelled'),
    'cancelled', (select count(*) from public.bookings
                  where tenant_id = p_tenant and starts_at >= v_start and starts_at < v_end and status = 'cancelled'),
    'no_show', (select count(*) from public.bookings
                where tenant_id = p_tenant and starts_at >= v_start and starts_at < v_end and status = 'no_show'),
    'payments_total', (select coalesce(sum(amount), 0) from public.payments
                       where tenant_id = p_tenant and kind = 'payment' and created_at >= v_start and created_at < v_end),
    'refunds_total', (select coalesce(sum(amount), 0) from public.payments
                      where tenant_id = p_tenant and kind = 'refund' and created_at >= v_start and created_at < v_end),
    'received', (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
                 from public.payments
                 where tenant_id = p_tenant and created_at >= v_start and created_at < v_end),
    'expected', (select coalesce(sum(price), 0) from public.bookings
                 where tenant_id = p_tenant and starts_at >= greatest(v_start, now()) and starts_at < v_end
                   and status = 'confirmed'),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d::date,
        'visits', (select count(*) from public.bookings
                   where tenant_id = p_tenant and status in ('arrived', 'done')
                     and starts_at >= d::timestamp at time zone tz
                     and starts_at < (d + interval '1 day')::timestamp at time zone tz),
        'received', (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
                     from public.payments
                     where tenant_id = p_tenant
                       and created_at >= d::timestamp at time zone tz
                       and created_at < (d + interval '1 day')::timestamp at time zone tz))
        order by d)
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d), '[]'),
    'top_services', coalesce((
      select jsonb_agg(s.x order by s.n desc) from (
        select jsonb_build_object('name', service_name, 'count', count(*)) as x, count(*) as n
        from public.bookings
        where tenant_id = p_tenant and starts_at >= v_start and starts_at < v_end and status in ('arrived', 'done')
        group by service_name order by count(*) desc limit 5) s), '[]'));
end $$;

-- Live activation gate.
create or replace function private.readiness(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(problem), '[]'::jsonb) from (
    select 'name_missing' as problem from public.tenants where id = p_tenant and length(trim(name)) = 0
    union all select 'phone_missing' from public.tenants where id = p_tenant and length(private.normalize_phone(phone)) < 10
    union all select 'address_missing' from public.tenants where id = p_tenant and length(trim(address)) = 0
    union all select 'no_working_hours' where not exists (select 1 from public.working_hours where tenant_id = p_tenant)
    union all select 'no_services' where not exists (select 1 from public.services where tenant_id = p_tenant and active)
    union all select 'no_masters' where not exists (select 1 from public.resources where tenant_id = p_tenant and active)
    union all select 'service_without_master:' || s.name from public.services s
      where s.tenant_id = p_tenant and s.active
        and not exists (select 1 from public.resource_services rs join public.resources r on r.id = rs.resource_id and r.active
                        where rs.service_id = s.id)
    union all select 'no_owner' where not exists (select 1 from public.tenant_members where tenant_id = p_tenant)
  ) p
$$;

create or replace function public.owner_readiness(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_member(p_tenant);
  return private.readiness(p_tenant);
end $$;

create or replace function private.go_live(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_problems jsonb;
begin
  v_problems := private.readiness(p_tenant);
  if jsonb_array_length(v_problems) > 0 then
    raise exception 'not_ready: %', v_problems using errcode = 'P0001';
  end if;
  -- Preview data was explicitly demo; it never survives into live operation.
  delete from public.bookings where tenant_id = p_tenant and is_demo;
  delete from public.resource_occupancies where tenant_id = p_tenant and is_demo;
  delete from public.clients c where c.tenant_id = p_tenant
    and not exists (select 1 from public.bookings b where b.client_id = c.id);
  update public.tenants set status = 'live', live_at = now() where id = p_tenant;
  return jsonb_build_object('status', 'live');
end $$;

create or replace function public.owner_go_live(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_tenant);
  return private.go_live(p_tenant);
end $$;
