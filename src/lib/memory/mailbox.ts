import { HttpError } from "./errors.ts";
import { parseIsoTime } from "./parse.ts";
import { renderCypherDump, type CypherFact } from "./cypher.ts";
import type { MailboxSql } from "./sql.ts";

const MAX_BODY = 80_000;
const FACT_SELECT =
  "name, summary, content, key_points, assistant, source_path, evidence, created_at, updated_at";

export type IncomingFact = {
  name: string;
  summary?: string;
  content?: string;
  keyPoints?: string;
  evidence?: string;
  sourcePath?: string | null;
  assistant?: string;
  updatedAt?: string;
};

export type PushBody = {
  facts?: IncomingFact[];
  related?: { a: string; b: string }[];
  learned?: { factName: string; sessionPath: string }[];
};

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function inClause(names: string[], offset: number) {
  return names.map((_, i) => `$${offset + i}`).join(", ");
}

export async function backfillRelatedTx(sql: MailboxSql) {
  await sql.query(
    `insert into locus_related (a_name, b_name)
     select least(a.fact_name, b.fact_name), greatest(a.fact_name, b.fact_name)
     from locus_learned_in a
     join locus_learned_in b
       on a.session_path = b.session_path and a.fact_name < b.fact_name
     on conflict do nothing`,
  );
}

export async function linkCoSessionTx(sql: MailboxSql, factName: string, sessionPath: string) {
  await sql.query(
    `insert into locus_related (a_name, b_name)
     select least($1, fact_name), greatest($1, fact_name)
     from locus_learned_in
     where session_path = $2 and fact_name <> $1
     on conflict do nothing`,
    [factName, sessionPath],
  );
}

export async function pushGraphTx(sql: MailboxSql, agent: string, body: PushBody) {
  let upserted = 0;
  let skipped = 0;
  let linked = 0;
  for (const raw of body.facts ?? []) {
    const name = raw.name.trim().slice(0, 200);
    if (!name) continue;
    if (!raw.updatedAt) {
      throw new HttpError(400, "Each pushed fact needs updatedAt (ISO timestamp).");
    }
    const updatedAt = parseIsoTime(raw.updatedAt);
    const rows = await sql.query<{ name: string }>(
      `insert into locus_facts (name, summary, content, key_points, assistant, source_path, evidence, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
       on conflict (name) do update set
         summary = excluded.summary,
         content = excluded.content,
         key_points = excluded.key_points,
         assistant = excluded.assistant,
         source_path = coalesce(excluded.source_path, locus_facts.source_path),
         evidence = excluded.evidence,
         updated_at = excluded.updated_at
       where locus_facts.updated_at <= excluded.updated_at
       returning name`,
      [
        name,
        (raw.summary ?? "").slice(0, 400),
        (raw.content ?? "").slice(0, 4000),
        (raw.keyPoints ?? "").slice(0, 1000),
        raw.assistant || agent,
        raw.sourcePath ?? null,
        raw.evidence ?? "",
        updatedAt,
      ],
    );
    if (rows[0]) upserted += 1;
    else skipped += 1;
    if (raw.sourcePath) {
      await sql.query(
        `insert into locus_learned_in (fact_name, session_path) values ($1,$2)
         on conflict do nothing`,
        [name, raw.sourcePath],
      );
      await linkCoSessionTx(sql, name, raw.sourcePath);
      linked += 1;
    }
  }
  for (const edge of body.related ?? []) {
    const a = edge.a.trim();
    const b = edge.b.trim();
    if (!a || !b || a === b) continue;
    const [left, right] = pair(a, b);
    await sql.query(
      `insert into locus_related (a_name, b_name) values ($1,$2) on conflict do nothing`,
      [left, right],
    );
    linked += 1;
  }
  for (const row of body.learned ?? []) {
    if (!row.factName || !row.sessionPath) continue;
    await sql.query(
      `insert into locus_learned_in (fact_name, session_path) values ($1,$2)
       on conflict do nothing`,
      [row.factName, row.sessionPath],
    );
    await linkCoSessionTx(sql, row.factName, row.sessionPath);
    linked += 1;
  }
  await sql.query(
    `insert into locus_sync_state (agent, last_push_at)
     values ($1, now())
     on conflict (agent) do update set last_push_at = now()`,
    [agent],
  );
  return { upserted, skipped, linked };
}

export async function pullGraphTx(sql: MailboxSql, agent: string, since?: string) {
  await backfillRelatedTx(sql);
  type FactRow = CypherFact;
  type EdgeRow = { a_name: string; b_name: string };
  type LearnedRow = { fact_name: string; session_path: string };

  let facts: FactRow[];
  let related: EdgeRow[];
  let learned: LearnedRow[];

  if (!since) {
    facts = await sql.query<FactRow>(
      `select ${FACT_SELECT} from locus_facts order by updated_at, name`,
    );
    related = await sql.query<EdgeRow>(
      "select a_name, b_name from locus_related order by a_name, b_name",
    );
    learned = await sql.query<LearnedRow>(
      "select fact_name, session_path from locus_learned_in",
    );
  } else {
    facts = await sql.query<FactRow>(
      `select ${FACT_SELECT} from locus_facts
       where updated_at > $1::timestamptz
       order by updated_at, name`,
      [since],
    );
    related = await sql.query<EdgeRow>(
      `select a_name, b_name from locus_related
       where created_at > $1::timestamptz
          or a_name in (select name from locus_facts where updated_at > $1::timestamptz)
          or b_name in (select name from locus_facts where updated_at > $1::timestamptz)`,
      [since],
    );
    learned = await sql.query<LearnedRow>(
      `select fact_name, session_path from locus_learned_in
       where created_at > $1::timestamptz
          or fact_name in (select name from locus_facts where updated_at > $1::timestamptz)`,
      [since],
    );
    const have = new Set(facts.map((f) => f.name));
    const missing: string[] = [];
    for (const e of related) {
      if (!have.has(e.a_name)) missing.push(e.a_name);
      if (!have.has(e.b_name)) missing.push(e.b_name);
    }
    for (const row of learned) {
      if (!have.has(row.fact_name)) missing.push(row.fact_name);
    }
    const extra = [...new Set(missing)];
    if (extra.length) {
      const list = inClause(extra, 1);
      const more = await sql.query<FactRow>(
        `select ${FACT_SELECT} from locus_facts where name in (${list})`,
        extra,
      );
      facts = facts.concat(more);
    }
  }

  await sql.query(
    `insert into locus_sync_state (agent, last_pull_at)
     values ($1, now())
     on conflict (agent) do update set last_pull_at = now()`,
    [agent],
  );

  return {
    facts: facts.map((row) => ({
      name: row.name,
      summary: row.summary,
      content: row.content,
      keyPoints: row.key_points,
      assistant: row.assistant,
      sourcePath: row.source_path,
      evidence: row.evidence,
      createdAt: iso(row.created_at) ?? "",
      updatedAt: iso(row.updated_at) ?? "",
    })),
    learned: learned.map((r) => ({ factName: r.fact_name, sessionPath: r.session_path })),
    related: related.map((r) => ({ a: r.a_name, b: r.b_name })),
    generatedAt: new Date().toISOString(),
  };
}

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function exportCypherTx(sql: MailboxSql) {
  const facts = await sql.query<CypherFact>(
    `select ${FACT_SELECT} from locus_facts order by name`,
  );
  const related = await sql.query<{ a_name: string; b_name: string }>(
    "select a_name, b_name from locus_related order by a_name, b_name",
  );
  const learned = await sql.query<{ fact_name: string; session_path: string }>(
    "select fact_name, session_path from locus_learned_in",
  );
  const agents = await sql.query<{ id: string }>("select id from locus_agents");
  return {
    cypher: renderCypherDump({ facts, related, learned, agents }),
    facts: facts.length,
    related: related.length,
  };
}

export async function appendDailyTx(
  sql: MailboxSql,
  body: string,
  agent: string,
  displayName: string,
  evidence: string,
  day: string,
) {
  const chunk = body.trim();
  if (!chunk) throw new HttpError(400, "Nothing to append.");
  const path = `memory/${day}.md`;
  const stamp = new Date().toISOString().slice(11, 16);
  const block = `\n\n## ${stamp} UTC — ${displayName}\n\n${chunk}\n`;
  const initial = `# ${day}\n${block}`;
  const rows = await sql.query<{
    path: string;
    title: string;
    body: string;
    summary: string;
    tags: string;
    assistant: string;
    evidence: string;
    day: string | null;
    kind: string;
    status: string;
    access: string;
    created_at: string | Date;
    updated_at: string | Date;
  }>(
    `insert into locus_files
       (path, kind, title, body, summary, tags, assistant, evidence, day)
     values ($1,'daily',$2,$3,$4,'',$5,$6,$7::date)
     on conflict (path) do update set
       body = left(locus_files.body || $8, ${MAX_BODY}),
       summary = excluded.summary,
       assistant = excluded.assistant,
       evidence = case when excluded.evidence = '' then locus_files.evidence else excluded.evidence end,
       updated_at = now()
     returning path, kind, title, body, summary, tags, assistant, evidence, day, status, access, created_at, updated_at`,
    [path, `Daily log ${day}`, initial, chunk.slice(0, 200), agent, evidence, day, block],
  );
  return rows[0];
}

export async function throttleAuthTx(
  sql: MailboxSql,
  action: string,
  limit = 20,
  windowSec = 60,
) {
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from locus_auth_events
     where at > now() - ($1::int * interval '1 second')`,
    [windowSec],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    throw new HttpError(429, "Too many attempts. Wait a minute.");
  }
  await sql.query(`insert into locus_auth_events (action) values ($1)`, [action]);
  await sql.query(`delete from locus_auth_events where at < now() - interval '1 hour'`);
}

export async function rotateVaultTx(sql: MailboxSql, salt: string, keyHash: string) {
  const rows = await sql.query<{ id: number }>(
    "update locus_vault set salt = $1, key_hash = $2 where id = 1 returning id",
    [salt, keyHash],
  );
  if (!rows[0]) throw new HttpError(409, "Workspace is not set up yet.");
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}
