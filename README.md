# Locus

Remote HTTPS memory hub for [losts1/ai-memory-system](https://github.com/losts1/ai-memory-system).

Cloud Grok Build and Home Grok Build both speak outbound HTTPS to this app. They never reach each other.

## Layout

Matches the ai-memory-system file tree:

| Layer | Path | Notes |
|---|---|---|
| Identity | `SOUL.md`, `USER.md`, `HEARTBEAT.md` | Main session only |
| L1 | `MEMORY.md` | Curated long-term. Target ≤15,000 characters |
| L2 | `memory/YYYY-MM-DD.md` | Raw daily log. Load today + yesterday. Append, do not duplicate |
| L3 | `memory/{core,sessions,projects,inbox,learner-sessions}/*.qmd` | YAML frontmatter |
| L4 | Fact graph | `Fact`, `Session`, `LEARNED_IN`, `RELATED_TO`, `Assistant` |

Vector search / FAISS stay on the home box. Neo4j clustering is **not** multi-master (primary → read-only replica). Two-way graph sync is this hub: pull → apply Cypher locally → push. Last-write-wins on `updated_at` (SQL on push; Cypher `FOREACH` so a re-apply does not clobber a newer home fact). The Cypher dump is the full graph. Incremental `graph/pull?since=` includes new edges between unchanged facts. Push facts require `updatedAt`. Non-daily file overwrites need the current `updatedAt` or they 409. Daily append is a single SQL concat.

## Auth

One workspace key, hashed with scrypt. Same key on the UI, Cloud Grok Build, and Home Grok Build.

Headers:

```
Authorization: Bearer $LOCUS_KEY
X-Locus-Agent: home-grok   # or cloud-grok
```

Never store API keys, passwords, or tokens in memory files.

## API

Base: `$LOCUS_URL/api/v1`

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | Vault ready? |
| GET | `/skill` | Agent skill markdown |
| POST | `/setup` | Create workspace key (once) |
| POST | `/unlock` | Verify key |
| GET | `/recall` | Session start (`?main=0` omits SOUL/USER/MEMORY) |
| POST | `/files/append` | Append today's daily log |
| GET/PUT | `/files` | Read / write a file |
| GET | `/search?q=` | Hybrid search (files + facts) |
| POST | `/learn` | Distill daily headings → facts |
| GET | `/traverse?start=&depth=` | RELATED_TO neighborhood |
| GET | `/graph/pull?since=` | Pull facts + edges |
| POST | `/graph/push` | Push facts + RELATED_TO + LEARNED_IN |
| GET | `/graph/cypher` | Full Cypher dump for home Neo4j (`?format=cypher`). LWW apply. |
| GET | `/graph/stats` | Fact / edge counts and last pull/push per agent |
| POST | `/key/rotate` | Replace the workspace key (Authorization is the current key) |

## Home Grok Build

Use the **published** origin, not a preview. Copy the curl + skill from the in-app **Connect** panel, or:

```bash
export LOCUS_URL="https://YOUR-APP.grok.me"
export LOCUS_KEY="your-workspace-key"
export LOCUS_AGENT="home-grok"

curl -sS "$LOCUS_URL/api/v1/recall" \
  -H "Authorization: Bearer $LOCUS_KEY" \
  -H "X-Locus-Agent: $LOCUS_AGENT"

curl -sS "$LOCUS_URL/api/v1/graph/pull" \
  -H "Authorization: Bearer $LOCUS_KEY" \
  -H "X-Locus-Agent: $LOCUS_AGENT"

curl -sS "$LOCUS_URL/api/v1/graph/cypher?format=cypher" \
  -H "Authorization: Bearer $LOCUS_KEY" \
  -H "X-Locus-Agent: $LOCUS_AGENT" \
  | cypher-shell -u neo4j
```

Skill text: `GET $LOCUS_URL/api/v1/skill`

## Stack

TanStack Start + Postgres (Neon when published, PGLite in preview). Workspace rows are unowned and gated by the hashed key — not per-user accounts.

## License

MIT
