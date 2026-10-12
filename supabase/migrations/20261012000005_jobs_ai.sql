-- Notification outbox (lease + dedupe), cron wiring, and AI budget counters.
-- Everything here is executable by service_role only (edge functions).

-- Claim due jobs with a lease. Expired leases are reclaimed, so a crashed worker
-- never loses a reminder; SKIP LOCKED lets several workers run concurrently.
create or replace function public.claim_notification_jobs(p_limit int default 20, p_lease_seconds int default 120)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  j public.notification_jobs;
  b public.bookings;
  t public.tenants;
begin
  for j in
    with picked as (
      select id from public.notification_jobs
      where (status = 'pending' and run_at <= now())
         or (status = 'processing' and lease_until < now())
      order by run_at
      limit least(greatest(p_limit, 1), 100)
      for update skip locked)
    update public.notification_jobs nj
       set status = 'processing', attempts = nj.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds)
      from picked where nj.id = picked.id
    returning nj.*
  loop
    select * into b from public.bookings where id = j.booking_id;
    select * into t from public.tenants where id = j.tenant_id;
    -- Stale jobs (cancelled / moved booking, preview studio) are closed, never sent.
    if b.status <> 'confirmed' or b.starts_at <> j.booking_starts_at or b.is_demo or t.status <> 'live' then
      update public.notification_jobs set status = 'cancelled', lease_until = null where id = j.id;
      continue;
    end if;
    v_out := v_out || jsonb_build_object(
      'job_id', j.id, 'kind', j.kind, 'attempts', j.attempts,
      'booking', jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'service_name', b.service_name,
                                    'resource_name', (select name from public.resources where id = b.resource_id)),
      'tenant', jsonb_build_object('slug', t.slug, 'name', t.name, 'timezone', t.timezone, 'address', t.address),
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
                                 from public.push_subscriptions where booking_id = b.id), '[]'));
  end loop;
  return v_out;
end $$;

create or replace function public.complete_notification_job(
  p_job uuid, p_outcome text, p_error text default '', p_gone_endpoints text[] default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.notification_jobs;
begin
  select * into j from public.notification_jobs where id = p_job for update;
  if not found or j.status <> 'processing' then
    return; -- lease lost or already finished: never double-complete
  end if;
  delete from public.push_subscriptions where booking_id = j.booking_id and endpoint = any (p_gone_endpoints);
  if p_outcome = 'sent' then
    update public.notification_jobs set status = 'sent', sent_at = now(), lease_until = null, last_error = '' where id = j.id;
  elsif p_outcome = 'skipped' then
    update public.notification_jobs set status = 'skipped', lease_until = null, last_error = left(coalesce(p_error, ''), 500)
     where id = j.id;
  elsif j.attempts >= 5 then
    update public.notification_jobs set status = 'failed', lease_until = null, last_error = left(coalesce(p_error, ''), 500)
     where id = j.id;
  else
    update public.notification_jobs
       set status = 'pending', lease_until = null, last_error = left(coalesce(p_error, ''), 500),
           run_at = now() + make_interval(mins => 2 * j.attempts)
     where id = j.id;
  end if;
end $$;

-- ------------------------------------------------------------ AI budget
create or replace function public.ai_consume_quota(
  p_slug text, p_ip text, p_scope text, p_daily_requests int, p_daily_tokens int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  u private.llm_usage;
  v_day date;
begin
  select * into t from public.tenants where slug = lower(p_slug) and status in ('preview', 'live');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'tenant_not_found');
  end if;
  begin
    perform private.hit_rate('ai-ip:' || coalesce(p_ip, 'unknown'), 20, 600);
    perform private.hit_rate('ai-tenant:' || t.id || ':' || p_scope, 120, 600);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'tenant_id', t.id);
  end;
  v_day := (now() at time zone t.timezone)::date;
  insert into private.llm_usage as lu (tenant_id, day, requests) values (t.id, v_day, 1)
  on conflict (tenant_id, day) do update set requests = lu.requests + 1
  returning * into u;
  if u.requests > p_daily_requests or u.tokens >= p_daily_tokens then
    return jsonb_build_object('ok', false, 'reason', 'budget_exhausted', 'tenant_id', t.id);
  end if;
  return jsonb_build_object('ok', true, 'tenant_id', t.id, 'requests', u.requests, 'tokens', u.tokens);
end $$;

create or replace function public.ai_record_usage(p_tenant uuid, p_tokens int) returns void
language sql security definer set search_path = '' as $$
  insert into private.llm_usage as lu (tenant_id, day, tokens)
  values (p_tenant, (now() at time zone (select timezone from public.tenants where id = p_tenant))::date, greatest(p_tokens, 0))
  on conflict (tenant_id, day) do update set tokens = lu.tokens + greatest(p_tokens, 0)
$$;

revoke execute on function public.claim_notification_jobs(int, int) from public, anon, authenticated;
revoke execute on function public.complete_notification_job(uuid, text, text, text[]) from public, anon, authenticated;
revoke execute on function public.ai_consume_quota(text, text, text, int, int) from public, anon, authenticated;
revoke execute on function public.ai_record_usage(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_notification_jobs(int, int) to service_role;
grant execute on function public.complete_notification_job(uuid, text, text, text[]) to service_role;
grant execute on function public.ai_consume_quota(text, text, text, int, int) to service_role;
grant execute on function public.ai_record_usage(uuid, int) to service_role;

-- ----------------------------------------------------------------- cron
-- Supabase Cron calls the push-dispatch edge function every minute. URL and secret
-- live in Vault (see SETUP.md); without them the job is a no-op, never a fake send.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.invoke_push_dispatch() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'dispatch_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (select 1 from public.notification_jobs
                 where (status = 'pending' and run_at <= now()) or (status = 'processing' and lease_until < now())) then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000);
end $$;
revoke execute on function private.invoke_push_dispatch() from public;

select cron.schedule('push-dispatch', '* * * * *', 'select private.invoke_push_dispatch()');
select cron.schedule('rate-counters-gc', '17 * * * *',
  $$delete from private.rate_counters where window_start < now() - interval '1 day'$$);
