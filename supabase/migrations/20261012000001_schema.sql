-- Beauty booking platform: multi-tenant schema.
-- One Supabase project, one shared frontend build; every dependent row carries tenant_id
-- and references its parent through a composite (tenant_id, id) foreign key, so a row can
-- never point at another studio's data even if an id leaks.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Server-only secrets (token HMAC key). Never exposed through PostgREST.
create table private.settings (
  key text primary key,
  value text not null
);
insert into private.settings (key, value)
values ('token_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict do nothing;

create or replace function private.is_valid_timezone(tz text) returns boolean
language sql stable as $$
  select exists (select 1 from pg_timezone_names where name = tz)
$$;

-- ---------------------------------------------------------------- tenants
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  status text not null default 'preview' check (status in ('preview', 'live', 'archived')),
  niche text not null default 'depilation',
  name text not null check (length(name) between 1 and 80),
  tagline text not null default '',
  about text not null default '',
  timezone text not null default 'Europe/Moscow',
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'ru-RU',
  accent text not null default '#E8A0B4' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  phone text not null default '',
  whatsapp text not null default '',
  telegram text not null default '',
  instagram text not null default '',
  address text not null default '',
  address_note text not null default '',
  map_url text not null default '',
  info_cards jsonb not null default '[]'::jsonb check (jsonb_typeof(info_cards) = 'array'),
  cancel_hours int not null default 12 check (cancel_hours between 0 and 168),
  slot_step_min int not null default 15 check (slot_step_min in (5, 10, 15, 20, 30, 60)),
  horizon_days int not null default 30 check (horizon_days between 1 and 180),
  min_lead_min int not null default 60 check (min_lead_min between 0 and 2880),
  hero_url text not null default '',
  hero_source text not null default 'config' check (hero_source in ('config', 'owner')),
  logo_url text not null default '',
  logo_source text not null default 'config' check (logo_source in ('config', 'owner')),
  config_version int not null default 0,
  published_at timestamptz,
  live_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.check_tenant_timezone() returns trigger
language plpgsql as $$
begin
  if not private.is_valid_timezone(new.timezone) then
    raise exception 'invalid_timezone: %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger tenants_tz before insert or update on public.tenants
  for each row execute function private.check_tenant_timezone();

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user on public.tenant_members (user_id);

-- ISO weekday 1 = Monday .. 7 = Sunday. Missing row = day off.
create table public.working_hours (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  primary key (tenant_id, weekday),
  check (closes > opens)
);

-- Per-date override: opens/closes null = closed that day.
create table public.schedule_exceptions (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  opens time,
  closes time,
  note text not null default '',
  primary key (tenant_id, day),
  check ((opens is null and closes is null) or (opens is not null and closes is not null and closes > opens))
);

-- --------------------------------------------------------------- catalog
-- Bookable resources: masters (and, if a studio needs it, cabinets/devices).
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  config_key text,
  kind text not null default 'master' check (kind in ('master', 'room', 'device')),
  name text not null check (length(name) between 1 and 80),
  role_title text not null default '',
  bio text not null default '',
  photo_url text not null default '',
  photo_source text not null default 'config' check (photo_source in ('config', 'owner')),
  experience_years int check (experience_years between 0 and 80),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, config_key)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  config_key text,
  category text not null default '',
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  duration_min int not null check (duration_min between 5 and 4320),
  buffer_min int not null default 0 check (buffer_min between 0 and 240),
  price numeric(12, 2) not null check (price >= 0),
  price_is_from boolean not null default false,
  allow_overnight boolean not null default false,
  popular boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, config_key)
);

create table public.resource_services (
  tenant_id uuid not null,
  resource_id uuid not null,
  service_id uuid not null,
  primary key (resource_id, service_id),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade
);
create index resource_services_service on public.resource_services (tenant_id, service_id);

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  config_key text,
  image_url text not null,
  caption text not null default '',
  source text not null default 'config' check (source in ('config', 'owner')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, config_key)
);

-- ------------------------------------------------------------- operations
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  phone text not null,
  phone_norm text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, phone_norm)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  service_id uuid not null,
  resource_id uuid not null,
  client_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'arrived', 'done', 'cancelled', 'no_show')),
  -- Snapshots: later catalog edits never rewrite history.
  service_name text not null,
  price numeric(12, 2) not null check (price >= 0),
  duration_min int not null,
  buffer_min int not null default 0,
  source text not null default 'client' check (source in ('client', 'owner')),
  notes text not null default '',
  idempotency_key uuid not null,
  request_hash text not null,
  access_token_hash bytea,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  arrived_at timestamptz,
  done_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text not null default '',
  cancelled_by text check (cancelled_by in ('client', 'owner')),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  check (ends_at > starts_at),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id)
);
create index bookings_tenant_start on public.bookings (tenant_id, starts_at);
create unique index bookings_token on public.bookings (access_token_hash) where access_token_hash is not null;

-- Single source of truth for "this resource is busy": bookings AND manual blocks.
-- The EXCLUDE constraint makes double booking impossible even under concurrency.
create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  booking_id uuid unique,
  kind text not null check (kind in ('booking', 'block')),
  period tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  note text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  check ((kind = 'booking') = (booking_id is not null)),
  constraint resource_occupancies_no_overlap
    exclude using gist (resource_id with =, period with &&)
);
create index resource_occupancies_tenant on public.resource_occupancies using gist (tenant_id, period);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('payment', 'refund')),
  amount numeric(12, 2) not null check (amount > 0),
  method text not null default 'card' check (method in ('cash', 'card', 'transfer', 'other')),
  note text not null default '',
  idempotency_key uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  unique (tenant_id, idempotency_key)
);
create index payments_tenant_created on public.payments (tenant_id, created_at);

-- ---------------------------------------------------------- notifications
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade,
  unique (booking_id, endpoint)
);

-- Outbox. dedupe_key embeds the booking start, so a reschedule creates a new job
-- and the old one is cancelled rather than silently re-used.
create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('reminder_24h', 'reminder_2h')),
  run_at timestamptz not null,
  booking_starts_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped')),
  dedupe_key text not null unique,
  attempts int not null default 0,
  lease_until timestamptz,
  last_error text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete cascade
);
create index notification_jobs_due on public.notification_jobs (run_at) where status in ('pending', 'processing');

-- ------------------------------------------------------------ guard rails
create table private.rate_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create table private.llm_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  requests int not null default 0,
  tokens int not null default 0,
  primary key (tenant_id, day)
);
