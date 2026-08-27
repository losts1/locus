-- File-tree + fact graph matching losts1/ai-memory-system.
-- L1 MEMORY.md, L2 memory/*.md, L3 QMD folders, L4 facts (Postgres stand-in for Neo4j).

create table if not exists locus_files (
  path text primary key,
  kind text not null check (kind in ('soul', 'user', 'curated', 'daily', 'qmd', 'heartbeat')),
  qmd_type text,
  folder text,
  slug text,
  title text not null,
  body text not null,
  summary text not null default '',
  tags text not null default '',
  assistant text not null default 'shared',
  evidence text not null default '',
  day date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'active' check (status in ('active', 'completed', 'on-hold', 'draft', 'archived')),
  access text not null default 'public' check (access in ('public', 'private')),
  related text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists locus_files_kind_idx on locus_files (kind);
create index if not exists locus_files_folder_idx on locus_files (folder);
create index if not exists locus_files_day_idx on locus_files (day);
create index if not exists locus_files_updated_idx on locus_files (updated_at desc);

create table if not exists locus_facts (
  name text primary key,
  summary text not null default '',
  content text not null default '',
  key_points text not null default '',
  assistant text not null default 'shared',
  source_path text,
  evidence text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists locus_facts_assistant_idx on locus_facts (assistant);

create table if not exists locus_learned_in (
  fact_name text not null,
  session_path text not null,
  primary key (fact_name, session_path)
);
