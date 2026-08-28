import { getSql, dbSource } from "@/lib/db";
import {
  cachedValid,
  forgetValid,
  hashKey,
  keyFingerprint,
  newSalt,
  rememberValid,
  verifyKey,
} from "@/lib/memory/crypto.server";
import { HttpError } from "@/lib/memory/errors";
import {
  appendDailyTx,
  backfillRelatedTx,
  isUniqueViolation,
  linkCoSessionTx,
  rotateVaultTx,
  throttleAuthTx,
} from "@/lib/memory/mailbox";
import { assertPath, assertUnchanged, kindFromPath } from "@/lib/memory/path";
import {
  AGENT_PRESETS,
  type AgentRecord,
  type FactRecord,
  type FileKind,
  type FileRecord,
  type MemoryPriority,
  type MemoryStatus,
  type QmdFolder,
  type QmdType,
  type RecallPayload,
  type VaultStatus,
} from "@/lib/memory/types";

export { HttpError, assertPath };

const MIN_KEY = 12;
const MAX_KEY = 128;
const MAX_BODY = 80_000;

type FileRow = {
  path: string;
  kind: FileKind;
  qmd_type: QmdType | null;
  folder: QmdFolder | null;
  slug: string | null;
  title: string;
  body: string;
  summary: string;
  tags: string;
  assistant: string;
  evidence: string;
  day: string | null;
  priority: MemoryPriority;
  status: MemoryStatus;
  access: "public" | "private";
  related: string;
  created_at: string | Date;
  updated_at: string | Date;
  chars_n?: number;
};

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

type AgentRow = {
  id: string;
  display_name: string;
  last_seen_at: string | Date | null;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function mapFile(row: FileRow): FileRecord {
  return {
    path: row.path,
    kind: row.kind,
    qmdType: row.qmd_type,
    folder: row.folder,
    slug: row.slug,
    title: row.title,
    body: row.body,
    summary: row.summary,
    tags: row.tags,
    assistant: row.assistant,
    evidence: row.evidence,
    day: row.day,
    priority: row.priority,
    status: row.status,
    access: row.access,
    related: row.related,
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    chars: row.chars_n ?? row.body.length,
  };
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

function mapAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    lastSeenAt: iso(row.last_seen_at),
  };
}

function cleanAgent(raw: string | null | undefined): string {
  const id = (raw ?? "ui").trim().toLowerCase().slice(0, 40);
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(id)) {
    throw new HttpError(400, "Agent id must be short letters, numbers, dot, dash, underscore.");
  }
  return id;
}

function displayFor(agent: string): string {
  return AGENT_PRESETS.find((a) => a.id === agent)?.displayName ?? agent;
}

function requireKeyShape(key: string): string {
  if (key.length < MIN_KEY || key.length > MAX_KEY) {
    throw new HttpError(400, `Workspace key must be ${MIN_KEY}–${MAX_KEY} characters.`);
  }
  return key;
}

function likeQuery(raw: string): string {
  const cleaned = raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  return `%${cleaned}%`;
}

const FILE_SELECT = `path, kind, qmd_type, folder, slug, title, body, summary, tags, assistant, evidence, day, priority, status, access, related, created_at, updated_at`;
const FILE_LIST_SELECT = `path, kind, qmd_type, folder, slug, title, '' as body, length(body)::int as chars_n, summary, tags, assistant, evidence, day, priority, status, access, related, created_at, updated_at`;

export async function vaultStatus(): Promise<VaultStatus> {
  const sql = await getSql();
  const rows = await sql.query<{ n: number }>("select count(*)::int as n from locus_vault");
  return { setup: (rows[0]?.n ?? 0) > 0, ephemeral: dbSource === "pglite" };
}

async function touchAgent(agent: string) {
  const sql = await getSql();
  await sql.query(
    `insert into locus_agents (id, display_name, last_seen_at)
     values ($1, $2, now())
     on conflict (id) do update set last_seen_at = now(), display_name = excluded.display_name`,
    [agent, displayFor(agent)],
  );
}

export async function assertKey(key: string | null, agentRaw: string | null): Promise<string> {
  if (!key) throw new HttpError(401, "Missing workspace key.");
  const agent = cleanAgent(agentRaw);
  const sql = await getSql();
  const rows = await sql.query<{ salt: string; key_hash: string }>(
    "select salt, key_hash from locus_vault where id = 1",
  );
  const vault = rows[0];
  if (!vault) throw new HttpError(409, "Workspace is not set up yet.");
  const fp = keyFingerprint(key, vault.salt);
  if (!cachedValid(fp)) {
    await throttleAuthTx(sql, "unlock");
    const ok = await verifyKey(key, vault.salt, vault.key_hash);
    if (!ok) throw new HttpError(401, "Wrong workspace key.");
    rememberValid(fp);
  }
  await touchAgent(agent);
  await ensureBootstrap(agent);
  return agent;
}

export async function setupVault(key: string, agentRaw: string | null) {
  requireKeyShape(key);
  const agent = cleanAgent(agentRaw);
  const sql = await getSql();
  await throttleAuthTx(sql, "setup");
  const existing = await sql.query<{ n: number }>("select count(*)::int as n from locus_vault");
  if ((existing[0]?.n ?? 0) > 0) {
    throw new HttpError(409, "Workspace already has a key. Unlock instead.");
  }
  const salt = newSalt();
  const keyHash = await hashKey(key, salt);
  try {
    await sql.query("insert into locus_vault (id, salt, key_hash) values (1, $1, $2)", [salt, keyHash]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, "Workspace already has a key. Unlock instead.");
    }
    throw err;
  }
  rememberValid(keyFingerprint(key, salt));
  await touchAgent(agent);
  await ensureBootstrap(agent);
  return { ok: true as const, agent };
}

export async function rotateVault(currentKey: string, nextKey: string, agentRaw: string | null) {
  requireKeyShape(nextKey);
  const agent = await assertKey(currentKey, agentRaw);
  const sql = await getSql();
  const salt = newSalt();
  const keyHash = await hashKey(nextKey, salt);
  await rotateVaultTx(sql, salt, keyHash);
  forgetValid();
  rememberValid(keyFingerprint(nextKey, salt));
  return { ok: true as const, agent };
}

async function putFileRow(file: {
  path: string;
  title: string;
  body: string;
  summary?: string;
  tags?: string;
  assistant: string;
  evidence?: string;
  priority?: MemoryPriority;
  status?: MemoryStatus;
  access?: "public" | "private";
  related?: string;
  qmdType?: QmdType | null;
  updatedAt?: string;
}) {
  const path = assertPath(file.path);
  const meta = kindFromPath(path);
  const sql = await getSql();
  if (meta.kind !== "daily") {
    const existing = await sql.query<{ updated_at: string | Date }>(
      "select updated_at from locus_files where path = $1",
      [path],
    );
    if (existing[0]) {
      assertUnchanged(file.updatedAt, iso(existing[0].updated_at) ?? "");
    }
  }
  const body = file.body.slice(0, MAX_BODY);
  const summary = (file.summary ?? body).trim().slice(0, 200);
  await sql.query(
    `insert into locus_files
      (path, kind, qmd_type, folder, slug, title, body, summary, tags, assistant, evidence, day, priority, status, access, related)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (path) do update set
       title = excluded.title,
       body = excluded.body,
       summary = excluded.summary,
       tags = excluded.tags,
       assistant = excluded.assistant,
       evidence = excluded.evidence,
       priority = excluded.priority,
       status = excluded.status,
       access = excluded.access,
       related = excluded.related,
       qmd_type = excluded.qmd_type,
       updated_at = now()`,
    [
      path,
      meta.kind,
      file.qmdType ?? meta.qmdType,
      meta.folder,
      meta.slug,
      file.title,
      body,
      summary,
      file.tags ?? "",
      file.assistant,
      file.evidence ?? "",
      meta.day,
      file.priority ?? "medium",
      file.status ?? "active",
      file.access ?? "public",
      file.related ?? "",
    ],
  );
  return getFile(path);
}

export async function getFile(path: string, main = true): Promise<FileRecord> {
  const sql = await getSql();
  const rows = await sql.query<FileRow>(`select ${FILE_SELECT} from locus_files where path = $1`, [
    assertPath(path),
  ]);
  const row = rows[0];
  if (!row) throw new HttpError(404, "File not found.");
  if (!main && row.access === "private") throw new HttpError(404, "File not found.");
  return mapFile(row);
}

export async function listFiles(opts: {
  kind?: FileKind | "all";
  folder?: QmdFolder | "all";
  q?: string;
  status?: MemoryStatus | "all";
  limit?: number;
  main?: boolean;
}): Promise<FileRecord[]> {
  const sql = await getSql();
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (frag: string, value: unknown) => {
    params.push(value);
    clauses.push(frag.replace("?", `$${params.length}`));
  };
  if (opts.kind && opts.kind !== "all") {
    if (opts.kind === "soul") {
      params.push("soul", "user", "heartbeat");
      clauses.push(`kind in ($${params.length - 2}, $${params.length - 1}, $${params.length})`);
    } else add("kind = ?", opts.kind);
  }
  if (opts.folder && opts.folder !== "all") {
    if (opts.folder === "core") {
      params.push("core", "memory/INDEX.qmd");
      clauses.push(`(folder = $${params.length - 1} or path = $${params.length})`);
    } else add("folder = ?", opts.folder);
  }
  if (opts.status && opts.status !== "all") add("status = ?", opts.status);
  else add("status <> ?", "archived");
  if (opts.q?.trim()) {
    const like = likeQuery(opts.q.trim());
    params.push(like);
    const n = params.length;
    clauses.push(
      `(path ilike $${n} or title ilike $${n} or body ilike $${n} or summary ilike $${n} or tags ilike $${n})`,
    );
  }
  if (opts.main === false) add("access <> ?", "private");
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  params.push(limit);
  const rows = await sql.query<FileRow>(
    `select ${FILE_LIST_SELECT} from locus_files ${where} order by
       case kind when 'soul' then 0 when 'user' then 1 when 'curated' then 2 when 'heartbeat' then 3 when 'daily' then 4 else 5 end,
       path
     limit $${params.length}`,
    params,
  );
  return rows.map(mapFile);
}

export async function upsertFile(
  input: {
    path?: string;
    kind?: FileKind;
    folder?: QmdFolder;
    slug?: string;
    title: string;
    body: string;
    summary?: string;
    tags?: string;
    evidence?: string;
    qmdType?: QmdType;
    priority?: MemoryPriority;
    status?: MemoryStatus;
    access?: "public" | "private";
    updatedAt?: string;
  },
  agent: string,
): Promise<FileRecord> {
  const title = input.title.trim();
  const body = input.body;
  if (!title) throw new HttpError(400, "Title is required.");
  if (!body.trim()) throw new HttpError(400, "Body is required.");
  let path = input.path;
  if (!path) {
    if (input.kind === "daily") path = `memory/${todayUtc()}.md`;
    else if (input.kind === "curated") path = "MEMORY.md";
    else if (input.kind === "soul") path = "SOUL.md";
    else if (input.kind === "user") path = "USER.md";
    else if (input.kind === "heartbeat") path = "HEARTBEAT.md";
    else {
      const folder = input.folder ?? "inbox";
      const slug = (input.slug ?? title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      if (!slug) throw new HttpError(400, "Need a kebab-case slug for the QMD file.");
      path = `memory/${folder}/${slug}.qmd`;
    }
  }
  return putFileRow({
    path,
    title,
    body,
    summary: input.summary,
    tags: input.tags,
    assistant: agent,
    evidence: input.evidence,
    priority: input.priority,
    status: input.status,
    access: input.access,
    qmdType: input.qmdType,
    updatedAt: input.updatedAt,
  });
}

export async function appendDaily(body: string, agent: string, evidence = ""): Promise<FileRecord> {
  const day = todayUtc();
  await appendDailyTx(await getSql(), body, agent, displayFor(agent), evidence, day);
  return getFile(`memory/${day}.md`);
}

export async function archiveFile(path: string): Promise<void> {
  const sql = await getSql();
  const rows = await sql.query<{ path: string }>(
    "update locus_files set status = 'archived', updated_at = now() where path = $1 returning path",
    [assertPath(path)],
  );
  if (!rows[0]) throw new HttpError(404, "File not found.");
}

export async function listAgents(): Promise<AgentRecord[]> {
  const sql = await getSql();
  const rows = await sql.query<AgentRow>(
    "select id, display_name, last_seen_at from locus_agents order by last_seen_at desc nulls last, id",
  );
  return rows.map(mapAgent);
}

export async function listFacts(opts: { q?: string; assistant?: string; limit?: number }): Promise<FactRecord[]> {
  const sql = await getSql();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.assistant) {
    params.push(opts.assistant);
    clauses.push(`assistant = $${params.length}`);
  }
  if (opts.q?.trim()) {
    const like = likeQuery(opts.q.trim());
    params.push(like);
    const n = params.length;
    clauses.push(`(name ilike $${n} or summary ilike $${n} or content ilike $${n})`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  params.push(limit);
  const rows = await sql.query<FactRow>(
    `select name, summary, content, key_points, assistant, source_path, evidence, created_at, updated_at
     from locus_facts ${where} order by updated_at desc limit $${params.length}`,
    params,
  );
  return rows.map(mapFact);
}

export async function upsertFact(
  input: {
    name: string;
    summary?: string;
    content?: string;
    keyPoints?: string;
    evidence?: string;
    sourcePath?: string | null;
  },
  agent: string,
): Promise<FactRecord> {
  const name = input.name.trim().slice(0, 200);
  if (!name) throw new HttpError(400, "Fact name is required.");
  const sql = await getSql();
  await sql.query(
    `insert into locus_facts (name, summary, content, key_points, assistant, source_path, evidence)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (name) do update set
       summary = excluded.summary,
       content = excluded.content,
       key_points = excluded.key_points,
       assistant = excluded.assistant,
       source_path = coalesce(excluded.source_path, locus_facts.source_path),
       evidence = excluded.evidence,
       updated_at = now()`,
    [
      name,
      (input.summary ?? "").slice(0, 400),
      (input.content ?? "").slice(0, 4000),
      (input.keyPoints ?? "").slice(0, 1000),
      agent,
      input.sourcePath ?? null,
      input.evidence ?? "",
    ],
  );
  if (input.sourcePath) {
    await sql.query(
      `insert into locus_learned_in (fact_name, session_path) values ($1,$2)
       on conflict do nothing`,
      [name, input.sourcePath],
    );
    await linkCoSessionTx(await getSql(), name, input.sourcePath);
  }
  const rows = await sql.query<FactRow>(
    `select name, summary, content, key_points, assistant, source_path, evidence, created_at, updated_at
     from locus_facts where name = $1`,
    [name],
  );
  return mapFact(rows[0]);
}

export async function searchHybrid(
  q: string,
  limit = 8,
  main = true,
): Promise<{ files: FileRecord[]; facts: FactRecord[] }> {
  const query = q.trim();
  if (!query) return { files: [], facts: [] };
  const files = await listFiles({ q: query, limit, main });
  const facts = await listFacts({ q: query, limit });
  return { files, facts };
}

export async function learn(agent: string, days = 7): Promise<{ synced: number }> {
  const sql = await getSql();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const files = await sql.query<FileRow>(
    `select ${FILE_SELECT} from locus_files
     where kind = 'daily' and status = 'active' and day >= $1
     order by day desc`,
    [cutoffDay],
  );
  let synced = 0;
  for (const file of files) {
    const headings = file.body.split("\n").filter((line) => /^#{2,3}\s+/.test(line));
    for (const heading of headings) {
      const name = heading.replace(/^#+\s+/, "").replace(/\s+UTC.*$/, "").trim().slice(0, 120);
      if (name.length < 4) continue;
      if (/^\d{1,2}:\d{2}$/.test(name)) continue;
      await upsertFact(
        {
          name,
          summary: name,
          content: `Distilled from ${file.path}`,
          sourcePath: file.path,
          evidence: "INFERRED",
        },
        agent,
      );
      synced += 1;
    }
  }
  await backfillRelatedTx(sql);
  return { synced };
}

export async function recall(main = true): Promise<RecallPayload> {
  const sql = await getSql();
  const one = async (path: string) => {
    const rows = await sql.query<FileRow>(`select ${FILE_SELECT} from locus_files where path = $1`, [path]);
    return rows[0] ? mapFile(rows[0]) : null;
  };
  const recent = await sql.query<FileRow>(
    `select ${FILE_SELECT} from locus_files
     where kind = 'daily' and status = 'active' and day in ($1, $2)
     order by day desc, path`,
    [todayUtc(), yesterdayUtc()],
  );
  const core = await sql.query<FileRow>(
    `select ${FILE_SELECT} from locus_files
     where kind = 'qmd' and folder = 'core' and status = 'active'
     order by path`,
  );
  const facts = await listFacts({ limit: 12 });
  const memory = main ? await one("MEMORY.md") : null;
  return {
    soul: main ? await one("SOUL.md") : null,
    user: main ? await one("USER.md") : null,
    memory,
    heartbeat: await one("HEARTBEAT.md"),
    recent: recent.map(mapFile).filter((f) => main || f.access !== "private"),
    core: core.map(mapFile).filter((f) => main || f.access !== "private"),
    facts,
    agents: await listAgents(),
    generatedAt: new Date().toISOString(),
    memoryChars: memory?.chars ?? 0,
  };
}

async function ensureBootstrap(agent: string) {
  const sql = await getSql();
  const count = await sql.query<{ n: number }>("select count(*)::int as n from locus_files");
  if ((count[0]?.n ?? 0) > 0) return;

  const old = await sql.query<{
    layer: string;
    title: string;
    body: string;
    summary: string;
    tags: string;
    evidence: string;
    day: string | null;
    assistant: string;
  }>("select layer, title, body, summary, tags, evidence, day, assistant from locus_memories");

  if (old.length) {
    const curated = old.filter((r) => r.layer === "curated");
    const dailies = old.filter((r) => r.layer === "daily");
    const facts = old.filter((r) => r.layer === "fact");
    if (curated.length) {
      await putFileRow({
        path: "MEMORY.md",
        title: "MEMORY.md",
        body: curated.map((c) => `## ${c.title}\n\n${c.body}`).join("\n\n"),
        summary: "Migrated from earlier Locus notes.",
        tags: "locus",
        assistant: agent,
        evidence: "INFERRED",
      });
    }
    for (const d of dailies) {
      const day = d.day ?? todayUtc();
      await putFileRow({
        path: `memory/${day}.md`,
        title: d.title,
        body: d.body,
        summary: d.summary,
        tags: d.tags,
        assistant: d.assistant || agent,
        evidence: d.evidence,
      });
    }
    for (const f of facts) {
      await upsertFact(
        { name: f.title, summary: f.summary, content: f.body, evidence: f.evidence },
        f.assistant || agent,
      );
    }
  }

  const still = await sql.query<{ n: number }>("select count(*)::int as n from locus_files");
  if ((still[0]?.n ?? 0) > 0) {
    await seedMissingIdentity(agent);
    return;
  }
  await seedWorkspace(agent);
}

async function seedMissingIdentity(agent: string) {
  for (const seed of seeds(agent)) {
    try {
      await getFile(seed.path);
    } catch {
      await putFileRow({ ...seed, assistant: agent });
    }
  }
}

function seeds(agent: string) {
  const day = todayUtc();
  const now = new Date().toISOString().slice(0, 19);
  return [
    {
      path: "SOUL.md",
      title: "SOUL.md",
      tags: "identity",
      evidence: "USER-VERIFIED",
      body: `# SOUL.md — Who You Are

## Identity

**Name:** Locus
**Type:** AI assistant
**Role:** Shared memory between Cloud Grok Build and Home Grok Build

**What makes you different:**
- Persistent memory (MEMORY.md + daily notes + fact graph)
- Both Grok Builds speak HTTPS to this hub; they never reach each other
- File layout matches losts1/ai-memory-system

## Core Truths

Be genuinely helpful, not performatively helpful.
Have opinions.
Be resourceful before asking.
Verify before claiming completion.
Write it down. Mental notes do not survive session restarts.
`,
    },
    {
      path: "USER.md",
      title: "USER.md",
      tags: "identity, private",
      evidence: "USER-VERIFIED",
      access: "private" as const,
      body: `# USER.md — About Your Human

- **Name:** (fill in)
- **Timezone:** America/New_York
- **Notes:** Runs a home Grok Build and this cloud Grok Build against the same Locus hub.

## Context

Hardware, solar, and local-agent work live in daily logs and MEMORY.md. Keep secrets out of this file.
`,
    },
    {
      path: "MEMORY.md",
      title: "MEMORY.md",
      tags: "curated",
      evidence: "USER-VERIFIED",
      priority: "high" as const,
      body: `# MEMORY.md — Long-Term Memory (Curated)

## Memory System
Locus is the remote host of the ai-memory-system layout. Layers: L1 MEMORY.md, L2 memory/YYYY-MM-DD.md, L3 QMD under memory/core|sessions|projects|inbox, L4 fact graph (Postgres here; Neo4j + FAISS stay on the home box). Last verified: ${day}.

## Architecture
Cloud Grok Build and Home Grok Build are outbound-only. This hub is the mailbox. Workspace key is hashed (scrypt); plaintext is never stored. [TOOL-VERIFIED]

## Hygiene
- MEMORY.md target ≤ 15,000 characters
- Append to today's daily log; do not spawn duplicate files
- Distill dailies into QMD, then into this file
- Never store API keys, passwords, or tokens
`,
    },
    {
      path: "HEARTBEAT.md",
      title: "HEARTBEAT.md",
      tags: "ops",
      evidence: "",
      body: `# HEARTBEAT.md

Empty. Add a short checklist if a periodic agent should do work. Reply HEARTBEAT_OK when there is nothing to do.
`,
    },
    {
      path: "memory/INDEX.qmd",
      title: "Memory index",
      tags: "memory, qmd",
      qmdType: "index" as QmdType,
      summary: "Master index for the QMD memory system",
      body: `---
id: memory-index
type: index
tags: [memory, qmd]
created: ${day}
updated: "${now}"
priority: high
status: active
summary: "Master index for the QMD memory system"
---

# Memory Index

\`\`\`
SOUL.md USER.md MEMORY.md HEARTBEAT.md
memory/
├── INDEX.qmd
├── inbox/
├── core/
├── sessions/
├── projects/
├── learner-sessions/
└── YYYY-MM-DD.md
\`\`\`
`,
    },
    {
      path: "memory/core/identity.qmd",
      title: "Identity",
      tags: "identity",
      qmdType: "identity" as QmdType,
      summary: "Locus, shared memory assistant",
      body: `---
id: identity-locus
type: identity
tags: [identity]
created: ${day}
updated: "${now}"
priority: high
status: active
summary: "Locus, shared memory between two Grok Builds"
---

# Identity: Locus

Remote memory for Cloud Grok Build (\`cloud-grok\`) and Home Grok Build (\`home-grok\`).
`,
    },
    {
      path: "memory/core/people.qmd",
      title: "People",
      tags: "person, private",
      qmdType: "person" as QmdType,
      access: "private" as const,
      summary: "People directory — main session only",
      body: `---
id: people
type: person
tags: [person, private]
created: ${day}
updated: "${now}"
priority: high
status: active
access: private
summary: "People I know"
---

# People

Main session only. Keep this sparse and respectful.
`,
    },
    {
      path: "memory/core/preferences.qmd",
      title: "Preferences",
      tags: "preferences",
      qmdType: "preferences" as QmdType,
      summary: "Workflow preferences",
      body: `---
id: prefs
type: preferences
tags: [preferences]
created: ${day}
updated: "${now}"
priority: medium
status: active
summary: "Workflow preferences"
---

# Preferences

- Write it down
- Evidence tags on claims
- Distill weekly into MEMORY.md
`,
    },
    {
      path: "memory/core/setup.qmd",
      title: "Setup",
      tags: "setup",
      qmdType: "setup" as QmdType,
      summary: "Locus hub setup",
      body: `---
id: setup
type: setup
tags: [setup]
created: ${day}
updated: "${now}"
priority: high
status: active
summary: "How this hub is wired"
---

# Setup

HTTPS API at /api/v1. Agents: cloud-grok, home-grok, ui.
Home Neo4j / FAISS remain local. This hub holds files + keyword facts.
`,
    },
    {
      path: `memory/${day}.md`,
      title: `Daily log ${day}`,
      tags: "session",
      evidence: "TOOL-VERIFIED",
      body: `# ${day}

## Stood up Locus as the remote ai-memory-system

File tree now matches losts1/ai-memory-system. Cloud Grok Build can write here. Home Grok Build uses the published URL, the same workspace key, and agent id home-grok.

Evidence: [TOOL-VERIFIED] bootstrap seed on ${day}.
`,
    },
  ];
}

async function seedWorkspace(agent: string) {
  for (const s of seeds(agent)) {
    await putFileRow({ ...s, assistant: agent });
  }
  await upsertFact(
    {
      name: "Two Grok Builds cannot pair directly",
      summary: "Outbound-only rendezvous through Locus.",
      content:
        "The cloud sandbox cannot see the home LAN. The home CLI cannot see the sandbox. Locus is the HTTPS mailbox. Vector search stays on home Neo4j/FAISS.",
      sourcePath: `memory/${todayUtc()}.md`,
      evidence: "TOOL-VERIFIED",
    },
    agent,
  );
}
