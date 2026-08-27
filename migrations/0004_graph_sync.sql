-- Two-way graph mailbox matching ai-memory-system Neo4j schema:
-- Fact, Session (via LEARNED_IN), RELATED_TO, Assistant (locus_agents).
-- Native Neo4j clustering is one-way (primary → replica). Home and this hub
-- sync over HTTPS: pull / push / cypher apply.

create table if not exists locus_related (
  a_name text not null,
  b_name text not null,
  created_at timestamptz not null default now(),
  primary key (a_name, b_name),
  check (a_name < b_name)
);

create index if not exists locus_related_b_idx on locus_related (b_name);

create table if not exists locus_sync_state (
  agent text primary key,
  last_pull_at timestamptz,
  last_push_at timestamptz,
  last_seq integer not null default 0
);
