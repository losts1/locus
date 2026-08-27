import { getSql } from "@/lib/db";
import { HttpError } from "@/lib/memory/errors";
import type { FactRecord } from "@/lib/memory/types";

type FactRow = {
  name: string;
  summary: string;
  content: string;
  key_points: string;
  assistant: string;
  source_path: string | null;
  evidence: string;
  created_at: string | Date;
  updated_at: string | Date;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function mapFact(row: FactRow): FactRecord {
  return {
    name: row.name,
    summary: row.summary,
    content: row.content,
    keyPoints: row.key_points,
    assistant: row.assistant,
    sourcePath: row.source_path,
    evidence: row.evidence,
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
  };
}

const FACT_SELECT =
  "name, summary, content, key_points, assistant, source_path, evidence, created_at, updated_at";

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function cypherStr(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function inClause(names: string[], offset: number) {
  return names.map((_, i) => `$${offset + i}`).join(", ");
}

export async function backfillRelated() {
  const sql = await getSql();
  await sql.query(
    `insert into locus_related (a_name, b_name)
     select least(a.fact_name, b.fact_name), greatest(a.fact_name, b.fact_name)
     from locus_learned_in a
     join locus_learned_in b
       on a.session_path = b.session_path and a.fact_name < b.fact_name
     on conflict do nothing`,
  );
}

export async function linkCoSession(factName: string, sessionPath: string) {
  const sql = await getSql();
  await sql.query(
    `insert into locus_related (a_name, b_name)
     select least($1, fact_name), greatest($1, fact_name)
     from locus_learned_in
     where session_path = $2 and fact_name <> $1
     on conflict do nothing`,
    [factName, sessionPath],
  );
}

export async function traverse(
  start: string,
  depth = 1,
): Promise<{ start: FactRecord; related: FactRecord[]; depth: number }> {
  const sql = await getSql();
  const hops = Math.min(Math.max(depth, 1), 3);
  const seed = await sql.query<FactRow>(
    `select ${FACT_SELECT} from locus_facts where name = $1`,
    [start],
  );
  if (!seed[0]) throw new HttpError(404, "Fact not found.");

  const visited = new Set<string>([start]);
  let frontier = [start];
  const found: string[] = [];
  for (let d = 0; d < hops; d += 1) {
    if (!frontier.length) break;
    const list = inClause(frontier, 1);
    const edges = await sql.query<{ a_name: string; b_name: string }>(
      `select a_name, b_name from locus_related
       where a_name in (${list}) or b_name in (${list})`,
      frontier,
    );
    const next: string[] = [];
    for (const edge of edges) {
      for (const node of [edge.a_name, edge.b_name]) {
        if (visited.has(node)) continue;
        visited.add(node);
        next.push(node);
        found.push(node);
      }
    }
    frontier = next;
  }

  let rows: FactRow[] = [];
  if (found.length) {
    const list = inClause(found, 1);
    rows = await sql.query<FactRow>(
      `select ${FACT_SELECT} from locus_facts where name in (${list}) order by name`,
      found,
    );
  } else {
    rows = await sql.query<FactRow>(
      `select distinct f.name, f.summary, f.content, f.key_points, f.assistant, f.source_path, f.evidence, f.created_at, f.updated_at
       from locus_facts f
       join locus_learned_in a on a.fact_name = f.name
       join locus_learned_in b on b.session_path = a.session_path
       where b.fact_name = $1 and f.name <> $1
       limit 20`,
      [start],
    );
  }
  return { start: mapFact(seed[0]), related: rows.map(mapFact), depth: hops };
}

export async function graphStats() {
  await backfillRelated();
  const sql = await getSql();
  const [facts] = await sql.query<{ n: number }>("select count(*)::int as n from locus_facts");
  const [related] = await sql.query<{ n: number }>("select count(*)::int as n from locus_related");
  const [learned] = await sql.query<{ n: number }>("select count(*)::int as n from locus_learned_in");
  const agents = await sql.query<{
    agent: string;
    last_pull_at: string | Date | null;
    last_push_at: string | Date | null;
  }>("select agent, last_pull_at, last_push_at from locus_sync_state order by agent");
  return {
    facts: facts?.n ?? 0,
    related: related?.n ?? 0,
    learned: learned?.n ?? 0,
    agents: agents.map((a) => ({
      id: a.agent,
      lastPullAt: iso(a.last_pull_at),
      lastPushAt: iso(a.last_push_at),
    })),
  };
}

export async function pullGraph(agent: string, since?: string) {
  await backfillRelated();
  const sql = await getSql();
  const params: unknown[] = [];
  let where = "";
  if (since) {
    params.push(since);
    where = `where updated_at > $1::timestamptz`;
  }
  const facts = await sql.query<FactRow>(
    `select ${FACT_SELECT} from locus_facts ${where} order by updated_at, name`,
    params,
  );
  const names = facts.map((f) => f.name);
  let learned: { fact_name: string; session_path: string }[] = [];
  let related: { a_name: string; b_name: string }[] = [];
  if (names.length) {
    const list = inClause(names, 1);
    learned = await sql.query<{ fact_name: string; session_path: string }>(
      `select fact_name, session_path from locus_learned_in where fact_name in (${list})`,
      names,
    );
    related = await sql.query<{ a_name: string; b_name: string }>(
      `select a_name, b_name from locus_related
       where a_name in (${list}) or b_name in (${list})`,
      names,
    );
  }
  await sql.query(
    `insert into locus_sync_state (agent, last_pull_at)
     values ($1, now())
     on conflict (agent) do update set last_pull_at = now()`,
    [agent],
  );
  return {
    facts: facts.map(mapFact),
    learned: learned.map((r) => ({ factName: r.fact_name, sessionPath: r.session_path })),
    related: related.map((r) => ({ a: r.a_name, b: r.b_name })),
    generatedAt: new Date().toISOString(),
  };
}

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

export async function pushGraph(
  agent: string,
  body: {
    facts?: IncomingFact[];
    related?: { a: string; b: string }[];
    learned?: { factName: string; sessionPath: string }[];
  },
) {
  const sql = await getSql();
  let upserted = 0;
  let skipped = 0;
  let linked = 0;
  for (const raw of body.facts ?? []) {
    const name = raw.name.trim().slice(0, 200);
    if (!name) continue;
    const existing = await sql.query<{ updated_at: string | Date }>(
      "select updated_at from locus_facts where name = $1",
      [name],
    );
    const incomingAt = raw.updatedAt ? Date.parse(raw.updatedAt) : Date.now();
    const localAt = existing[0] ? Date.parse(String(existing[0].updated_at)) : 0;
    if (existing[0] && Number.isFinite(incomingAt) && incomingAt < localAt) {
      skipped += 1;
    } else {
      await sql.query(
        `insert into locus_facts (name, summary, content, key_points, assistant, source_path, evidence, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7, coalesce($8::timestamptz, now()))
         on conflict (name) do update set
           summary = excluded.summary,
           content = excluded.content,
           key_points = excluded.key_points,
           assistant = excluded.assistant,
           source_path = coalesce(excluded.source_path, locus_facts.source_path),
           evidence = excluded.evidence,
           updated_at = excluded.updated_at`,
        [
          name,
          (raw.summary ?? "").slice(0, 400),
          (raw.content ?? "").slice(0, 4000),
          (raw.keyPoints ?? "").slice(0, 1000),
          raw.assistant || agent,
          raw.sourcePath ?? null,
          raw.evidence ?? "",
          raw.updatedAt ?? null,
        ],
      );
      upserted += 1;
    }
    if (raw.sourcePath) {
      await sql.query(
        `insert into locus_learned_in (fact_name, session_path) values ($1,$2)
         on conflict do nothing`,
        [name, raw.sourcePath],
      );
      await linkCoSession(name, raw.sourcePath);
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
    await linkCoSession(row.factName, row.sessionPath);
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

export async function exportCypher(): Promise<{ cypher: string; facts: number; related: number }> {
  const sql = await getSql();
  const facts = await sql.query<FactRow>(
    `select ${FACT_SELECT} from locus_facts order by name limit 200`,
  );
  const related = await sql.query<{ a_name: string; b_name: string }>(
    "select a_name, b_name from locus_related order by a_name, b_name limit 400",
  );
  const learned = await sql.query<{ fact_name: string; session_path: string }>(
    "select fact_name, session_path from locus_learned_in limit 400",
  );
  const agents = await sql.query<{ id: string }>("select id from locus_agents");
  const lines: string[] = [
    "// Locus → home Neo4j. Last-write-wins on Fact.updated_at.",
    "// Native Neo4j clustering is one-way (primary → replica).",
    "// Two-way sync is this mailbox: pull JSON, apply Cypher, push local facts back.",
    "",
  ];
  for (const a of agents) {
    lines.push(
      `MERGE (x:Assistant {id: ${cypherStr(a.id)}}) SET x.name = ${cypherStr(a.id)}, x.type = 'agent';`,
    );
  }
  for (const f of facts) {
    lines.push(
      `MERGE (f:Fact {name: ${cypherStr(f.name)}})
 SET f.summary = ${cypherStr(f.summary)},
     f.content = ${cypherStr(f.content)},
     f.key_points = ${cypherStr(f.key_points)},
     f.assistant = ${cypherStr(f.assistant)},
     f.evidence = ${cypherStr(f.evidence)},
     f.source_file = ${cypherStr(f.source_path ?? "")},
     f.updated_at = datetime(${cypherStr(iso(f.updated_at) ?? "")});`,
    );
  }
  const sessions = [...new Set(learned.map((r) => r.session_path))];
  for (const path of sessions) {
    lines.push(`MERGE (s:Session {id: ${cypherStr(path)}}) SET s.source = ${cypherStr(path)};`);
  }
  for (const row of learned) {
    lines.push(
      `MATCH (f:Fact {name: ${cypherStr(row.fact_name)}}), (s:Session {id: ${cypherStr(row.session_path)}})
 MERGE (f)-[:LEARNED_IN]->(s);`,
    );
  }
  for (const edge of related) {
    lines.push(
      `MATCH (a:Fact {name: ${cypherStr(edge.a_name)}}), (b:Fact {name: ${cypherStr(edge.b_name)}})
 MERGE (a)-[:RELATED_TO]->(b)
 MERGE (b)-[:RELATED_TO]->(a);`,
    );
  }
  return { cypher: lines.join("\n"), facts: facts.length, related: related.length };
}
