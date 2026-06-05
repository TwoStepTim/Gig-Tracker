-- GigTrak Supabase Schema
-- Run this in your Supabase SQL editor

create table if not exists public.shifts (
  id              text        primary key,
  date            date        not null,
  platform        text        not null default 'DoorDash',
  start_mileage   numeric     not null default 0,
  end_mileage     numeric     not null default 0,
  earnings        numeric     not null default 0,
  start_time      time            null,
  end_time        time            null,
  notes           text        not null default '',

  -- Calculated fields (stored for fast reads & export)
  miles           numeric     not null default 0,
  gas_cost        numeric     not null default 0,
  wear_cost       numeric     not null default 0,
  net_profit      numeric     not null default 0,
  hours           numeric     not null default 0,
  gross_hourly    numeric     not null default 0,
  net_hourly      numeric     not null default 0,
  tax_deduction   numeric     not null default 0,

  created_at      timestamptz not null default now()
);

-- Index for date-sorted queries
create index if not exists shifts_date_idx on public.shifts (date desc);
create index if not exists shifts_created_idx on public.shifts (created_at desc);

-- Enable Row Level Security
alter table public.shifts enable row level security;

-- Policy: open access (single-user personal app).
-- If you want auth later, replace with: using (auth.uid() = user_id)
create policy "Allow all access" on public.shifts
  for all using (true) with check (true);
