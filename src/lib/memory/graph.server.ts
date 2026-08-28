import { getSql, withTransaction } from "@/lib/db";
import { HttpError } from "@/lib/memory/errors";
import {
  backfillRelatedTx,
  exportCypherTx,
  pullGraphTx,
  pushGraphTx,
  type PushBody,
} from "@/lib/memory/mailbox";
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

function inClause(names: string[], offset: number) {
  return names.map((_, i) => `$${offset + i}`).join(", ");
}

export async function backfillRelated() {
  await backfillRelatedTx(await getSql());
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
  const sql = await getSql();
  await backfillRelatedTx(sql);
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
  return pullGraphTx(await getSql(), agent, since);
}

export async function pushGraph(agent: string, body: PushBody) {
  return withTransaction((sql) => pushGraphTx(sql, agent, body));
}

export async function exportCypher() {
  return exportCypherTx(await getSql());
}
