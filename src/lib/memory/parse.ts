import { HttpError } from "./errors.ts";

export function parseBoundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw === "") return fallback;
  if (!/^-?\d+$/.test(raw)) throw new HttpError(400, "Invalid number.");
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, "Invalid number.");
  return Math.min(Math.max(n, min), max);
}

export function parseIsoTime(raw: string | null | undefined): string | undefined {
  if (raw == null || raw === "") return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new HttpError(400, "updatedAt must be an ISO timestamp.");
  return raw;
}

export function restPath(pathname: string): string {
  const prefix = "/api/v1/";
  const i = pathname.indexOf(prefix);
  const raw = i >= 0 ? pathname.slice(i + prefix.length) : "";
  const trimmed = raw.replace(/\/+$/, "");
  try {
    return decodeURIComponent(trimmed);
  } catch {
    throw new HttpError(400, "Malformed path.");
  }
}
