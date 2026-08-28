# Locus mailbox sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Locus a real two-writer mailbox: complete LWW Cypher, atomic fact/file writes, incremental edges, and a setup/unlock path that is not first-claimer/DoS brittle.

**Architecture:** Extract pure helpers (path, parse, cypher, LWW) so node:test can cover them without Vite. Graph/file mutations take an injected `Sql` and run inside `withTransaction`. A new migration adds `created_at` on `LEARNED_IN`, indexes, and `locus_auth_events` for throttle. HTTP stays the single `/api/v1/$` splat.

**Tech Stack:** TanStack Start, Postgres/PGLite, Kysely-free `sql.query`, node:test, scrypt.

**Spec:** Session review of losts1/locus@750bc8c — six mailbox fixes.

## Global Constraints

- Do not add a replacement dump cap (no `LIMIT 200/400` on export/pull).
- SQL stays parameterized. Path writes stay on the existing allowlist.
- `POST /facts` (hub-local) may use `now()`; `POST /graph/push` facts require a valid `updatedAt`.
- Successful cached key verifies skip scrypt; throttle failed/setup attempts *before* scrypt.
- Occupancy (`updatedAt` must match) on overwrite of non-daily files.
- `access=private` and `?main=0` actually hide private files.
- No Better Auth rewrite. No dump of secrets into facts.

---

### Task 1: Pure helpers (path, parse, cypher LWW)

**Files:**
- Create: `src/lib/memory/parse.ts`, `src/lib/memory/parse.test.ts`
- Create: `src/lib/memory/path.ts`, `src/lib/memory/path.test.ts`
- Create: `src/lib/memory/cypher.ts`, `src/lib/memory/cypher.test.ts`
- Modify: `package.json` test script

- [ ] Failing tests then helpers: `parseBoundedInt`, `parseIsoTime`, `restPath` (URIError → HttpError 400), `assertPath`, `factMergeCypher` uses FOREACH LWW and never emits `limit 200`.

---

### Task 2: PGlite mailbox SQL

**Files:**
- Create: `migrations/0005_mailbox_sync.sql`
- Create: `src/lib/memory/sql.ts` (`Sql` type + `withTransaction` lives in `db.ts`)
- Create: `src/lib/memory/mailbox.test.ts`
- Modify: `src/lib/db.ts` (`withTransaction`)
- Modify: `src/lib/memory/graph.server.ts`, `store.server.ts`

- [ ] PGlite tests: older push skipped; newer applied; omitted/invalid `updatedAt` on push → 400; two appends both survive; `pullGraph(since)` returns a new RELATED_TO between unchanged facts plus endpoint facts; exportCypher has no LIMIT and LWW FOREACH.
- [ ] Implement atomic `ON CONFLICT … WHERE updated_at <= excluded.updated_at`, atomic daily `body = body || chunk`, edge-aware pull.

---

### Task 3: Auth throttle, 409 setup, rotate

**Files:**
- Modify: `store.server.ts`, `crypto.server.ts` (hmac cache), `http.server.ts`
- Test: `src/lib/memory/auth-mailbox.test.ts`

- [ ] Unique vault insert → 409. `POST /key/rotate` with current Bearer. Failed/setup counted in `locus_auth_events`; 20/min then 429 before scrypt. Valid key hmac-cached.

---

### Task 4: HTTP / UI / docs

**Files:**
- Modify: `http.server.ts`, `api.ts`, `memory-app.tsx`, `skill-text.ts`, `README.md`, `connect-panel.tsx`

- [ ] Query ints via `parseBoundedInt`. List files omit bodies (fetch on select). Occupancy 409. `main=0` hides private. Skill/README describe LWW Cypher, required `updatedAt` on push, rotate, occupancy.

---

### Task 5: Verify and PR

- [ ] `npm test`, `npm run typecheck`. Commit. Push `fix/mailbox-sync` and open PR.
