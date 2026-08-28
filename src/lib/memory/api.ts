import type {
  AgentRecord,
  FactRecord,
  FileKind,
  FileRecord,
  QmdFolder,
  RecallPayload,
  VaultStatus,
} from "@/lib/memory/types";

const KEY_STORE = "locus-key";
const AGENT_STORE = "locus-agent";

export function loadStoredKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return "";
  }
}

export function saveStoredKey(key: string) {
  try {
    sessionStorage.setItem(KEY_STORE, key);
  } catch {
    /* private mode */
  }
}

export function clearStoredKey() {
  try {
    sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
}

export function loadStoredAgent(): string {
  try {
    return sessionStorage.getItem(AGENT_STORE) ?? "ui";
  } catch {
    return "ui";
  }
}

export function saveStoredAgent(agent: string) {
  try {
    sessionStorage.setItem(AGENT_STORE, agent);
  } catch {
    /* ignore */
  }
}

type CallOpts = {
  method?: string;
  key?: string;
  agent?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
};

async function call<T>(path: string, opts: CallOpts = {}): Promise<T> {
  const url = new URL(`/api/v1/${path}`, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.agent) headers["x-locus-agent"] = opts.agent;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  status: () => call<VaultStatus>("status"),
  setup: (key: string, agent: string) =>
    call<{ ok: true; agent: string }>("setup", { method: "POST", body: { key, agent } }),
  unlock: (key: string, agent: string) =>
    call<{ ok: true; agent: string }>("unlock", { method: "POST", key, agent }),
  rotate: (current: string, next: string, agent: string) =>
    call<{ ok: true; agent: string }>("key/rotate", {
      method: "POST",
      key: current,
      agent,
      body: { key: next },
    }),
  files: (
    key: string,
    agent: string,
    q?: { kind?: FileKind | "all"; folder?: QmdFolder; q?: string },
  ) =>
    call<{ files: FileRecord[] }>("files", {
      key,
      agent,
      query: { kind: q?.kind, folder: q?.folder, q: q?.q },
    }),
  file: (key: string, agent: string, path: string) =>
    call<{ file: FileRecord }>("files", { key, agent, query: { path } }),
  putFile: (key: string, agent: string, body: Record<string, unknown>) =>
    call<{ file: FileRecord }>("files", { method: "PUT", key, agent, body }),
  appendDaily: (key: string, agent: string, body: string, evidence?: string) =>
    call<{ file: FileRecord }>("files/append", {
      method: "POST",
      key,
      agent,
      body: { body, evidence },
    }),
  archive: (key: string, agent: string, path: string) =>
    call<{ ok: true }>(`files/${path}`, { method: "DELETE", key, agent }),
  facts: (key: string, agent: string, q?: string) =>
    call<{ facts: FactRecord[] }>("facts", { key, agent, query: { q } }),
  putFact: (key: string, agent: string, body: Record<string, unknown>) =>
    call<{ fact: FactRecord }>("facts", { method: "POST", key, agent, body }),
  search: (key: string, agent: string, q: string) =>
    call<{ files: FileRecord[]; facts: FactRecord[] }>("search", { key, agent, query: { q } }),
  learn: (key: string, agent: string) =>
    call<{ synced: number }>("learn", { method: "POST", key, agent }),
  recall: (key: string, agent: string) => call<RecallPayload>("recall", { key, agent }),
  agents: (key: string, agent: string) => call<{ agents: AgentRecord[] }>("agents", { key, agent }),
  traverse: (key: string, agent: string, start: string, depth = 1) =>
    call<{ start: FactRecord; related: FactRecord[]; depth: number }>("traverse", {
      key,
      agent,
      query: { start, depth: String(depth) },
    }),
  graphStats: (key: string, agent: string) =>
    call<{
      facts: number;
      related: number;
      learned: number;
      agents: { id: string; lastPullAt: string | null; lastPushAt: string | null }[];
    }>("graph/stats", { key, agent }),
  pullGraph: (key: string, agent: string, since?: string) =>
    call<{
      facts: FactRecord[];
      learned: { factName: string; sessionPath: string }[];
      related: { a: string; b: string }[];
      generatedAt: string;
    }>("graph/pull", { key, agent, query: { since } }),
  pushGraph: (key: string, agent: string, body: Record<string, unknown>) =>
    call<{ upserted: number; skipped: number; linked: number }>("graph/push", {
      method: "POST",
      key,
      agent,
      body,
    }),
};
