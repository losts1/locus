import { HttpError } from "./errors.ts";
import type { FileKind, QmdFolder, QmdType } from "./types.ts";

export function assertUnchanged(clientUpdatedAt: string | undefined, storedUpdatedAt: string) {
  if (!clientUpdatedAt || clientUpdatedAt !== storedUpdatedAt) {
    throw new HttpError(409, "File has changed. Reload and retry.");
  }
}

export function assertPath(path: string): string {
  const p = path.trim().replace(/^\/+/, "");
  const ok =
    /^(SOUL|USER|MEMORY|HEARTBEAT)\.md$/.test(p) ||
    /^memory\/INDEX\.qmd$/.test(p) ||
    /^memory\/\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?\.md$/.test(p) ||
    /^memory\/(core|sessions|projects|inbox|archive|learner-sessions)\/[a-z0-9][a-z0-9-]{0,80}\.qmd$/.test(
      p,
    );
  if (!ok) throw new HttpError(400, "Path is not a valid ai-memory-system file.");
  return p;
}

export function kindFromPath(path: string): {
  kind: FileKind;
  folder: QmdFolder | null;
  slug: string | null;
  qmdType: QmdType | null;
  day: string | null;
} {
  if (path === "SOUL.md") return { kind: "soul", folder: null, slug: null, qmdType: null, day: null };
  if (path === "USER.md") return { kind: "user", folder: null, slug: null, qmdType: null, day: null };
  if (path === "MEMORY.md")
    return { kind: "curated", folder: null, slug: null, qmdType: null, day: null };
  if (path === "HEARTBEAT.md")
    return { kind: "heartbeat", folder: null, slug: null, qmdType: null, day: null };
  const daily = /^memory\/(\d{4}-\d{2}-\d{2})(?:-[a-z0-9-]+)?\.md$/.exec(path);
  if (daily) return { kind: "daily", folder: null, slug: null, qmdType: null, day: daily[1] };
  const qmd =
    /^memory\/(core|sessions|projects|inbox|archive|learner-sessions)\/([a-z0-9-]+)\.qmd$/.exec(path);
  if (qmd) {
    const folder = qmd[1] as QmdFolder;
    const slug = qmd[2];
    const typeMap: Record<string, QmdType> = {
      identity: "identity",
      people: "person",
      preferences: "preferences",
      setup: "setup",
    };
    const qmdType: QmdType =
      folder === "sessions" ? "session" : folder === "projects" ? "project" : (typeMap[slug] ?? "session");
    return { kind: "qmd", folder, slug, qmdType, day: null };
  }
  if (path === "memory/INDEX.qmd")
    return { kind: "qmd", folder: null, slug: "memory-index", qmdType: "index", day: null };
  throw new HttpError(400, "Path is not a valid ai-memory-system file.");
}
