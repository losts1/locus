-- Edge timestamps so incremental pull cannot drop RELATED_TO / LEARNED_IN
-- between unchanged facts. Auth event log for setup/unlock throttle.

alter table locus_learned_in
  add column if not exists created_at timestamptz not null default now();

create index if not exists locus_learned_created_idx on locus_learned_in (created_at);
create index if not exists locus_related_created_idx on locus_related (created_at);
create index if not exists locus_facts_updated_idx on locus_facts (updated_at);

create table if not exists locus_auth_events (
  action text not null,
  at timestamptz not null default now()
);

create index if not exists locus_auth_events_at_idx on locus_auth_events (at);
