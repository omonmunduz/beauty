-- Row level security, strict grants and storage policies.
-- anon never touches a table directly: it only executes the public booking RPCs.
-- authenticated (owners) read their tenant through RLS and mutate bookings only via RPCs.

grant usage on schema private to authenticated, service_role;

-- Functions are executable by PUBLIC by default in Postgres - close that first.
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

grant execute on function private.is_member(uuid) to authenticated;

create or replace function private.is_member_folder(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_member(v_folder::uuid);
end $$;
revoke execute on function private.is_member_folder(text) from public, anon;
grant execute on function private.is_member_folder(text) to authenticated;

-- ------------------------------------------------------------------- RLS
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.working_hours enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.resources enable row level security;
alter table public.services enable row level security;
alter table public.resource_services enable row level security;
alter table public.gallery_items enable row level security;
alter table public.clients enable row level security;
alter table public.bookings enable row level security;
alter table public.resource_occupancies enable row level security;
alter table public.payments enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create policy tenants_member_select on public.tenants for select to authenticated
  using (private.is_member(id));
create policy tenants_member_update on public.tenants for update to authenticated
  using (private.is_member(id)) with check (private.is_member(id));

create policy members_self on public.tenant_members for select to authenticated
  using (user_id = auth.uid());

do $$
declare tbl text;
begin
  foreach tbl in array array['working_hours', 'schedule_exceptions', 'resources', 'services',
                             'resource_services', 'gallery_items'] loop
    execute format('create policy %1$s_member_all on public.%1$s for all to authenticated
                    using (private.is_member(tenant_id)) with check (private.is_member(tenant_id))', tbl);
  end loop;
  foreach tbl in array array['clients', 'bookings', 'resource_occupancies', 'payments'] loop
    execute format('create policy %1$s_member_select on public.%1$s for select to authenticated
                    using (private.is_member(tenant_id))', tbl);
  end loop;
end $$;
-- push_subscriptions / notification_jobs: no policies -> invisible to anon and owners.

-- Column-level: owners may edit their profile but not status, slug, or config bookkeeping.
grant select on public.tenants to authenticated;
grant update (name, tagline, about, timezone, accent, phone, whatsapp, telegram, instagram, address,
              address_note, map_url, info_cards, cancel_hours, slot_step_min, horizon_days, min_lead_min,
              hero_url, hero_source, logo_url, logo_source)
  on public.tenants to authenticated;
grant select on public.tenant_members to authenticated;
grant select, insert, update, delete on public.working_hours, public.schedule_exceptions, public.resources,
  public.services, public.resource_services, public.gallery_items to authenticated;
grant select on public.clients, public.bookings, public.resource_occupancies, public.payments to authenticated;

-- ------------------------------------------------------- RPC execute grants
grant execute on function public.get_storefront(text) to anon, authenticated;
grant execute on function public.get_availability(text, uuid, uuid, date, int) to anon, authenticated;
grant execute on function public.create_booking(text, uuid, uuid, timestamptz, text, text, text, uuid) to anon, authenticated;
grant execute on function public.get_booking(text) to anon, authenticated;
grant execute on function public.cancel_booking(text, text) to anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to anon, authenticated;
grant execute on function public.delete_push_subscription(text, text) to anon, authenticated;

grant execute on function public.owner_context(text) to authenticated;
grant execute on function public.owner_schedule(uuid, date, date) to authenticated;
grant execute on function public.owner_booking_payments(uuid) to authenticated;
grant execute on function public.owner_create_booking(uuid, uuid, uuid, timestamptz, text, text, text, uuid) to authenticated;
grant execute on function public.owner_reschedule(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.owner_cancel_booking(uuid, text) to authenticated;
grant execute on function public.owner_set_status(uuid, text) to authenticated;
grant execute on function public.owner_add_payment(uuid, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.owner_block_resource(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.owner_unblock(uuid) to authenticated;
grant execute on function public.owner_stats(uuid, date, date) to authenticated;
grant execute on function public.owner_readiness(uuid) to authenticated;
grant execute on function public.owner_go_live(uuid) to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy tenant_media_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-media' and private.is_member_folder(name));
create policy tenant_media_member_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-media' and private.is_member_folder(name))
  with check (bucket_id = 'tenant-media' and private.is_member_folder(name));
create policy tenant_media_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-media' and private.is_member_folder(name));
