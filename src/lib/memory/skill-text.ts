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

This hub **is** the two-way mailbox. Last-write-wins on \`updated_at\` is enforced in SQL on push and in the Cypher dump (\`FOREACH\` skip if home is newer). The dump is the **full** graph — no 200-fact cap.

Pull (home ← Locus):

\`GET $LOCUS_URL/api/v1/graph/pull\`
Optional \`?since=2026-08-01T00:00:00Z\` (ISO). Incremental pull includes new RELATED_TO / LEARNED_IN even when both facts were unchanged, plus the endpoint facts.

Apply to local Neo4j:

\`GET $LOCUS_URL/api/v1/graph/cypher?format=cypher\`
Pipe into \`cypher-shell\` or Neo4j Browser. Safe to re-apply: older hub rows do not overwrite newer home facts.

Push (home → Locus):

\`POST $LOCUS_URL/api/v1/graph/push\`
Every fact **must** include \`updatedAt\` (ISO). Missing or invalid timestamps are 400, not "use now".

\`{"facts":[{"name":"...","summary":"...","content":"...","updatedAt":"2026-08-28T16:00:00Z","sourcePath":"..."}],"related":[{"a":"...","b":"..."}]}\`

Overwrite a non-daily file with \`updatedAt\` matching the current row, or the hub returns 409.

Rotate the workspace key: \`POST $LOCUS_URL/api/v1/key/rotate\` \`{"key":"<new 12+ char key>"}\` with the current key in \`Authorization\`.

Stats: \`GET $LOCUS_URL/api/v1/graph/stats\`

Embeddings stay local. Do not upload vectors.

## Evidence

\`TOOL-VERIFIED\`, \`USER-VERIFIED\`, \`INFERRED\`. No reference-only evidence.

## Do not store

API keys, passwords, tokens.
`;
