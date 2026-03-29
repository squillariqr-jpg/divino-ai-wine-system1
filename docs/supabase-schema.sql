-- Divino AI — Supabase schema
-- Run once in the Supabase SQL editor

-- ─── LEADS ───────────────────────────────────────────────────────────────────

create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  name            text,
  segment         text,           -- novizio-curioso | appassionato-pratico | builder-digitale | buyer-professionale
  product_name    text,
  source          text,           -- quiz-risultato | sito | ...
  interest        text,
  emails_sent     int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_email_idx on leads (email);
create index if not exists leads_segment_idx on leads (segment);

-- ─── EMAIL THREADS ───────────────────────────────────────────────────────────

create table if not exists email_threads (
  id              uuid primary key default gen_random_uuid(),
  thread_id       text not null unique,   -- AgentMail thread_id
  lead_id         uuid references leads(id),
  subject         text,
  status          text not null default 'active',   -- active | resolved | handoff
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists threads_lead_idx on email_threads (lead_id);

-- ─── EMAIL MESSAGES ──────────────────────────────────────────────────────────

create table if not exists email_messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           text not null,
  message_id          text unique,        -- AgentMail message_id
  lead_id             uuid references leads(id),
  direction           text not null,      -- inbound | outbound
  from_address        text,
  subject             text,
  body                text,
  intent              text,               -- wine_advice | fit_check | price_objection | human_help | unknown
  intent_confidence   text,               -- high | medium | low
  created_at          timestamptz not null default now()
);

create index if not exists messages_thread_idx on email_messages (thread_id);
create index if not exists messages_lead_idx   on email_messages (lead_id);

-- ─── AGENT ACTIONS ───────────────────────────────────────────────────────────

create table if not exists agent_actions (
  id              uuid primary key default gen_random_uuid(),
  thread_id       text not null,
  action_type     text not null,          -- reply | handoff | review_required | ask_clarification
  action_payload  jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists actions_thread_idx on agent_actions (thread_id);

-- ─── EMAIL SEQUENCE JOBS ─────────────────────────────────────────────────────
-- Tracks scheduled follow-up emails (day 2, 4, 7) per lead

create table if not exists email_sequence_jobs (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references leads(id),
  sequence_step   int not null,           -- 1 | 2 | 3 | 4
  segment         text not null,
  scheduled_for   timestamptz not null,
  sent_at         timestamptz,
  status          text not null default 'pending',  -- pending | sent | cancelled
  created_at      timestamptz not null default now()
);

create index if not exists seq_jobs_lead_idx     on email_sequence_jobs (lead_id);
create index if not exists seq_jobs_status_idx   on email_sequence_jobs (status, scheduled_for);
