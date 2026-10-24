-- schema.sql - run ONCE in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Creates the two tables used by the Wi-Fi mapper.

-- One row per floor survey.
create table if not exists surveys (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  width    double precision not null,          -- metres
  height   double precision not null,          -- metres
  plan     text,                               -- floor-plan image as a data URL (optional)
  router   jsonb,                              -- {"x": .., "y": ..} or null
  created  timestamptz not null default now()
);

-- One row per measured point. Deleting a survey deletes its readings (cascade).
create table if not exists readings (
  id         uuid primary key default gen_random_uuid(),
  survey_id  uuid not null references surveys(id) on delete cascade,
  x          double precision not null,        -- metres from the left edge
  y          double precision not null,        -- metres from the top edge
  rssi_mean  double precision not null,        -- average of the samples (dBm)
  rssi_std   double precision not null,        -- standard deviation (dB)
  "min"      double precision not null,
  "max"      double precision not null,
  samples    jsonb not null,                   -- every raw sample, e.g. [-61,-62,...]
  ssid       text,
  method     text,                             -- how it was read: netsh-rssi, manual...
  "time"     timestamptz not null default now()
);

create index if not exists readings_survey_idx on readings(survey_id);

-- Upgrade for the live version (safe to run again - "if not exists"):
-- Wi-Fi channel and band of the connected network, and how the reading was taken.
alter table readings add column if not exists channel integer;
alter table readings add column if not exists band    text;     -- "2.4 GHz" / "5 GHz"
alter table readings add column if not exists mode    text;     -- "measure" | "walk" | "manual"
-- How to find the guided points in the real room:
-- {"corner": "door corner", "wall": "window wall", "step_m": 0.75}
alter table surveys  add column if not exists setup   jsonb;

-- Row Level Security is on, with no public policies: only the backend, using
-- the secret / service_role key from backend/.env, can read and write.
alter table surveys  enable row level security;
alter table readings enable row level security;
