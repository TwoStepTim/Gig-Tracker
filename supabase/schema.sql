create table if not exists public.shifts (
  id uuid primary key,
  created_at timestamptz default now(),

  date date not null,
  platform text not null,

  start_mileage numeric(12,1) not null,
  end_mileage numeric(12,1) not null,
  earnings numeric(10,2) not null,

  start_time text,
  end_time text,

  gas_price numeric(10,2),
  mpg numeric(10,2),
  wear_rate numeric(10,2),

  business_purpose text,
  notes text,

  miles numeric(10,1),
  gas_cost numeric(10,2),
  wear_cost numeric(10,2),
  net_profit numeric(10,2),
  hours numeric(10,2),
  gross_hourly numeric(10,2),
  net_hourly numeric(10,2),
  tax_deduction numeric(10,2)
);

-- Simple personal-project setup:
-- Keep Row Level Security OFF while you are learning and only using this privately.
-- Do NOT share your Supabase project keys publicly.
alter table public.shifts disable row level security;
