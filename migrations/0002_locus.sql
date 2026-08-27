-- Locus remote memory hub. Unowned rows (single-tenant workspace).
-- Access is gated by a hashed workspace key in locus_vault, not by user_id.

create table if not exists locus_vault (
  id integer primary key check (id = 1),
  salt text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists locus_agents (
  id text primary key,
  display_name text not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists locus_memories (
  id text primary key,
  layer text not null check (layer in ('curated', 'daily', 'fact')),
  title text not null,
  body text not null,
  summary text not null default '',
  tags text not null default '',
  source text not null default 'ui',
  assistant text not null default 'shared',
  evidence text not null default '',
  day date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'active' check (status in ('active', 'draft', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists locus_memories_layer_idx on locus_memories (layer);
create index if not exists locus_memories_day_idx on locus_memories (day);
create index if not exists locus_memories_updated_idx on locus_memories (updated_at desc);
create index if not exists locus_memories_assistant_idx on locus_memories (assistant);
create index if not exists locus_memories_status_idx on locus_memories (status);
