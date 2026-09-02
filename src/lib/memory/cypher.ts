export type CypherFact = {
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

export function cypherStr(value: string): string {
  return (
    "'" +
    value
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r") +
    "'"
  );
}

export function factMergeCypher(f: CypherFact): string {
  const incoming = `datetime(${cypherStr(iso(f.updated_at) ?? "")})`;
  return `MERGE (f:Fact {name: ${cypherStr(f.name)}})
FOREACH (_ IN CASE WHEN f.updated_at IS NULL OR ${incoming} >= f.updated_at THEN [1] ELSE [] END |
  SET f.summary = ${cypherStr(f.summary)},
      f.content = ${cypherStr(f.content)},
      f.key_points = ${cypherStr(f.key_points)},
      f.assistant = ${cypherStr(f.assistant)},
      f.evidence = ${cypherStr(f.evidence)},
      f.source_file = ${cypherStr(f.source_path ?? "")},
      f.updated_at = ${incoming}
);`;
}

export function renderCypherDump(input: {
  facts: CypherFact[];
  related: { a_name: string; b_name: string }[];
  learned: { fact_name: string; session_path: string }[];
  agents: { id: string }[];
}): string {
  const lines: string[] = [
    "// Locus → home Neo4j. Last-write-wins on Fact.updated_at (FOREACH skip if local is newer).",
    "// Native Neo4j clustering is one-way (primary → replica).",
    "// Two-way sync is this mailbox: pull JSON, apply Cypher, push local facts back.",
    "",
  ];
  for (const a of input.agents) {
    lines.push(
      `MERGE (x:Assistant {id: ${cypherStr(a.id)}}) SET x.name = ${cypherStr(a.id)}, x.type = 'agent';`,
    );
  }
  for (const f of input.facts) lines.push(factMergeCypher(f));
  const sessions = [...new Set(input.learned.map((r) => r.session_path))];
  for (const path of sessions) {
    lines.push(`MERGE (s:Session {id: ${cypherStr(path)}}) SET s.source = ${cypherStr(path)};`);
  }
  for (const row of input.learned) {
    lines.push(
      `MATCH (f:Fact {name: ${cypherStr(row.fact_name)}}), (s:Session {id: ${cypherStr(row.session_path)}})
 MERGE (f)-[:LEARNED_IN]->(s);`,
    );
  }
  for (const edge of input.related) {
    lines.push(
      `MATCH (a:Fact {name: ${cypherStr(edge.a_name)}}), (b:Fact {name: ${cypherStr(edge.b_name)}})
 MERGE (a)-[:RELATED_TO]->(b)
 MERGE (b)-[:RELATED_TO]->(a);`,
    );
  }
  return lines.join("\n");
}
