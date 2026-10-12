-- Lifecycle of demo studios: a preview that is not launched within N days goes to the
-- archive automatically (link shows "studio not found", demo rows are removed). The shared
-- platform domain is never touched — only the studio's own data.

alter table public.tenants add column if not exists archived_at timestamptz;
alter table public.tenants add column if not exists preview_expires_at timestamptz;

update public.tenants set preview_expires_at = coalesce(published_at, created_at) + interval '14 days'
 where status = 'preview' and preview_expires_at is null;

create or replace function private.set_preview_expiry() returns trigger
language plpgsql as $$
begin
  if new.status = 'preview' and new.preview_expires_at is null then
    new.preview_expires_at := now() + interval '14 days';
  end if;
  if new.status = 'live' then
    new.preview_expires_at := null; -- launched studios never expire
  end if;
  return new;
end $$;
create trigger tenants_preview_expiry before insert or update of status on public.tenants
  for each row execute function private.set_preview_expiry();

-- Hide a studio: keeps rows so it can be restored, removes demo traffic and push data.
create or replace function private.archive_tenant(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_demo int;
begin
  delete from public.bookings where tenant_id = p_tenant and is_demo;
  get diagnostics v_demo = row_count;
  delete from public.resource_occupancies where tenant_id = p_tenant and is_demo;
  delete from public.clients c where c.tenant_id = p_tenant
    and not exists (select 1 from public.bookings b where b.client_id = c.id);
  update public.notification_jobs set status = 'cancelled', lease_until = null
   where tenant_id = p_tenant and status in ('pending', 'processing');
  update public.tenants set status = 'archived', archived_at = now() where id = p_tenant;
  return jsonb_build_object('archived', true, 'demo_bookings_removed', v_demo);
end $$;

-- Bring an archived studio back as a fresh preview with a new 14-day window.
create or replace function private.restore_tenant(p_tenant uuid, p_days int default 14) returns void
language sql security definer set search_path = '' as $$
  update public.tenants
     set status = 'preview', archived_at = null, preview_expires_at = now() + make_interval(days => p_days)
   where id = p_tenant and status = 'archived'
$$;

create or replace function private.expire_previews() returns int
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  n int := 0;
begin
  for t in select id from public.tenants where status = 'preview' and preview_expires_at < now() loop
    perform private.archive_tenant(t.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function private.archive_tenant(uuid) from public;
revoke execute on function private.restore_tenant(uuid, int) from public;
revoke execute on function private.expire_previews() from public;

select cron.schedule('expire-previews', '23 * * * *', 'select private.expire_previews()');
