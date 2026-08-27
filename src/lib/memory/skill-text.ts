export const LOCUS_SKILL = `# Locus — remote host of ai-memory-system

Layout matches https://github.com/losts1/ai-memory-system

- L1 \`MEMORY.md\` — curated long-term. Main session only. Target ≤15,000 chars.
- L2 \`memory/YYYY-MM-DD.md\` — raw daily log. Load today + yesterday. Append, never duplicate.
- L3 QMD — \`memory/core|sessions|projects|inbox|archive|learner-sessions/*.qmd\` with YAML frontmatter.
- L4 Fact graph on this hub. Schema matches Neo4j: Fact, Session, LEARNED_IN, RELATED_TO, Assistant.
- Vector embeddings / FAISS stay on the home box.

Both Grok Builds talk to this hub over HTTPS. They never talk to each other.

## Config

- \`LOCUS_URL\` — published origin
- \`LOCUS_KEY\` — workspace key
- \`LOCUS_AGENT\` — \`cloud-grok\` or \`home-grok\`

Headers: \`Authorization: Bearer $LOCUS_KEY\` and \`X-Locus-Agent: $LOCUS_AGENT\`

## Session start

1. \`GET $LOCUS_URL/api/v1/recall\` (omit MEMORY/SOUL/USER in shared contexts: \`?main=0\`)
2. Read \`soul\`, \`user\`, \`memory\` in the main session only
3. Read \`recent\` (today + yesterday)
4. Check \`heartbeat\`

## During the session

Append to today's log:

\`POST $LOCUS_URL/api/v1/files/append\`
\`{"body":"what happened","evidence":"USER-VERIFIED"}\`

Facts: \`POST $LOCUS_URL/api/v1/facts\` \`{"name":"...","summary":"...","content":"...","sourcePath":"memory/YYYY-MM-DD.md"}\`

Search: \`GET $LOCUS_URL/api/v1/search?q=...\`

Distill dailies → facts: \`POST $LOCUS_URL/api/v1/learn\`

Traverse RELATED_TO: \`GET $LOCUS_URL/api/v1/traverse?start=...&depth=2\`

## Two-way graph with home Neo4j

Neo4j clustering is **not** multi-master. CCDR (2026.03+) is one-way: primary → read-only replica. Community Edition has no clustering. Two independent graphs (home Docker + this hub) cannot replicate natively.

This hub **is** the two-way mailbox. Last-write-wins on \`updated_at\`.

Pull (home ← Locus):

\`GET $LOCUS_URL/api/v1/graph/pull\`
Optional \`?since=2026-08-01T00:00:00Z\`

Apply to local Neo4j:

\`GET $LOCUS_URL/api/v1/graph/cypher?format=cypher\`
Pipe into \`cypher-shell\` or Neo4j Browser.

Push (home → Locus):

\`POST $LOCUS_URL/api/v1/graph/push\`
\`{"facts":[{"name":"...","summary":"...","content":"...","updatedAt":"...","sourcePath":"..."}],"related":[{"a":"...","b":"..."}]}\`

Stats: \`GET $LOCUS_URL/api/v1/graph/stats\`

Embeddings stay local. Do not upload vectors.

## Evidence

\`TOOL-VERIFIED\`, \`USER-VERIFIED\`, \`INFERRED\`. No reference-only evidence.

## Do not store

API keys, passwords, tokens.
`;
