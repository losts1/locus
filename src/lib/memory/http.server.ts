import { z } from "zod";
import {
  HttpError,
  appendDaily,
  archiveFile,
  assertKey,
  getFile,
  learn,
  listAgents,
  listFacts,
  listFiles,
  recall,
  searchHybrid,
  setupVault,
  upsertFact,
  upsertFile,
  vaultStatus,
} from "@/lib/memory/store.server";
import {
  exportCypher,
  graphStats,
  pullGraph,
  pushGraph,
  traverse,
} from "@/lib/memory/graph.server";
import { LOCUS_SKILL } from "@/lib/memory/skill-text";
import type { FileKind, MemoryStatus, QmdFolder } from "@/lib/memory/types";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-locus-key, x-locus-agent",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cors,
    },
  });
}

function text(body: string, status = 200, type = "text/markdown; charset=utf-8"): Response {
  return new Response(body, {
    status,
    headers: { "content-type": type, "cache-control": "no-store", ...cors },
  });
}

function readKey(request: Request): string | null {
  const bearer = request.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice(7).trim();
    if (token) return token;
  }
  return request.headers.get("x-locus-key")?.trim() || null;
}

function readAgent(request: Request): string | null {
  return request.headers.get("x-locus-agent");
}

function rest(pathname: string): string {
  const prefix = "/api/v1/";
  const i = pathname.indexOf(prefix);
  const raw = i >= 0 ? pathname.slice(i + prefix.length) : "";
  return decodeURIComponent(raw.replace(/\/+$/, ""));
}

const fileWrite = z.object({
  path: z.string().max(180).optional(),
  kind: z.enum(["soul", "user", "curated", "daily", "qmd", "heartbeat"]).optional(),
  folder: z
    .enum(["core", "sessions", "projects", "inbox", "archive", "learner-sessions"])
    .optional(),
  slug: z.string().max(80).optional(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(80_000),
  summary: z.string().max(200).optional(),
  tags: z.string().max(200).optional(),
  evidence: z.string().max(40).optional(),
  qmdType: z
    .enum(["session", "identity", "person", "preferences", "setup", "project", "index"])
    .optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["active", "completed", "on-hold", "draft", "archived"]).optional(),
  access: z.enum(["public", "private"]).optional(),
});

const appendSchema = z.object({
  body: z.string().min(1).max(20_000),
  evidence: z.string().max(40).optional(),
});

const factSchema = z.object({
  name: z.string().min(1).max(200),
  summary: z.string().max(400).optional(),
  content: z.string().max(4000).optional(),
  keyPoints: z.string().max(1000).optional(),
  evidence: z.string().max(40).optional(),
  sourcePath: z.string().max(180).nullable().optional(),
  assistant: z.string().max(40).optional(),
  updatedAt: z.string().max(40).optional(),
});

const pushSchema = z.object({
  facts: z.array(factSchema).max(200).optional(),
  related: z
    .array(z.object({ a: z.string().min(1).max(200), b: z.string().min(1).max(200) }))
    .max(400)
    .optional(),
  learned: z
    .array(
      z.object({
        factName: z.string().min(1).max(200),
        sessionPath: z.string().min(1).max(180),
      }),
    )
    .max(400)
    .optional(),
});

const setupSchema = z.object({
  key: z.string().min(12).max(128),
  agent: z.string().max(40).optional(),
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

export async function handleLocus(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  try {
    const url = new URL(request.url);
    const path = rest(url.pathname);
    const method = request.method.toUpperCase();

    if (path === "status" && method === "GET") return json(await vaultStatus());
    if (path === "skill" && method === "GET") return text(LOCUS_SKILL);
    if (path === "setup" && method === "POST") {
      const body = setupSchema.parse(await readJson(request));
      return json(await setupVault(body.key, body.agent ?? readAgent(request) ?? "ui"), 201);
    }

    const agent = await assertKey(readKey(request), readAgent(request));

    if (path === "unlock" && method === "POST") return json({ ok: true, agent });
    if (path === "heartbeat" && method === "POST") {
      return json({ ok: true, agent, at: new Date().toISOString() });
    }
    if (path === "agents" && method === "GET") return json({ agents: await listAgents() });
    if (path === "recall" && method === "GET") {
      const main = url.searchParams.get("main") !== "0";
      return json(await recall(main));
    }
    if (path === "search" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      return json(await searchHybrid(q, Number(url.searchParams.get("limit") ?? "8")));
    }
    if (path === "learn" && method === "POST") {
      return json(await learn(agent, Number(url.searchParams.get("days") ?? "7")));
    }
    if (path === "files" && method === "GET") {
      const filePath = url.searchParams.get("path");
      if (filePath) return json({ file: await getFile(filePath) });
      const files = await listFiles({
        kind: (url.searchParams.get("kind") as FileKind | "all" | null) ?? "all",
        folder: (url.searchParams.get("folder") as QmdFolder | "all" | null) ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        status: (url.searchParams.get("status") as MemoryStatus | "all" | null) ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? "80"),
      });
      return json({ files });
    }
    if (path === "files" && (method === "PUT" || method === "POST")) {
      const body = fileWrite.parse(await readJson(request));
      const file = await upsertFile(body, agent);
      return json({ file }, method === "POST" ? 201 : 200);
    }
    if (path === "files/append" && method === "POST") {
      const body = appendSchema.parse(await readJson(request));
      return json({ file: await appendDaily(body.body, agent, body.evidence) });
    }
    if (path.startsWith("files/") && method === "DELETE") {
      await archiveFile(path.slice("files/".length));
      return json({ ok: true });
    }
    if (path === "facts" && method === "GET") {
      return json({
        facts: await listFacts({
          q: url.searchParams.get("q") ?? undefined,
          assistant: url.searchParams.get("assistant") ?? undefined,
          limit: Number(url.searchParams.get("limit") ?? "40"),
        }),
      });
    }
    if (path === "facts" && method === "POST") {
      const body = factSchema.parse(await readJson(request));
      return json({ fact: await upsertFact(body, agent) }, 201);
    }
    if (path === "traverse" && method === "GET") {
      const start = url.searchParams.get("start") ?? "";
      if (!start) throw new HttpError(400, "start is required.");
      return json(await traverse(start, Number(url.searchParams.get("depth") ?? "1")));
    }
    if ((path === "graph" || path === "graph/pull") && method === "GET") {
      return json(await pullGraph(agent, url.searchParams.get("since") ?? undefined));
    }
    if (path === "graph/push" && method === "POST") {
      const body = pushSchema.parse(await readJson(request));
      return json(await pushGraph(agent, body));
    }
    if (path === "graph/stats" && method === "GET") {
      return json(await graphStats());
    }
    if (path === "graph/cypher" && method === "GET") {
      const dump = await exportCypher();
      if (url.searchParams.get("format") === "cypher") {
        return text(dump.cypher, 200, "text/plain; charset=utf-8");
      }
      return json(dump);
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) {
      return json({ error: error.issues[0]?.message ?? "Invalid request." }, 400);
    }
    console.error("[locus]", error);
    return json({ error: "Memory hub failed." }, 500);
  }
}
