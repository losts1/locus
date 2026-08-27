import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  BookOpen,
  Diamond,
  Folder,
  LogOut,
  Plus,
  Radio,
  ScrollText,
  Search,
  Unplug,
  User,
} from "lucide-react";
import { ConnectPanel } from "@/components/connect-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { api, clearStoredKey } from "@/lib/memory/api";
import {
  EVIDENCE,
  MEMORY_CHAR_TARGET,
  NAV,
  QMD_FOLDERS,
  QMD_TYPES,
  type AgentRecord,
  type FactRecord,
  type FileKind,
  type FileRecord,
  type QmdFolder,
  type VaultStatus,
} from "@/lib/memory/types";
import { cn } from "@/lib/cn";

type Props = {
  vaultKey: string;
  agent: string;
  status: VaultStatus;
  onLock: () => void;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const NAV_ICON: Record<string, typeof BookOpen> = {
  identity: User,
  curated: BookOpen,
  daily: ScrollText,
  core: Folder,
  sessions: Folder,
  projects: Folder,
  inbox: Folder,
  learner: Folder,
  graph: Diamond,
};

export function MemoryApp({ vaultKey, agent, status, onLock }: Props) {
  const [navId, setNavId] = useState("daily");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [facts, setFacts] = useState<FactRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [connect, setConnect] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [learnMsg, setLearnMsg] = useState("");
  const [stats, setStats] = useState<{
    facts: number;
    related: number;
    learned: number;
    agents: { id: string; lastPullAt: string | null; lastPushAt: string | null }[];
  } | null>(null);

  const nav = NAV.find((n) => n.id === navId) ?? NAV[2];
  const selected = files.find((f) => f.path === selectedPath) ?? null;
  const fact = facts.find((f) => f.name === selectedFact) ?? null;

  async function refresh(next = nav, q = query) {
    setError("");
    const [{ agents: agentRows }] = await Promise.all([api.agents(vaultKey, agent)]);
    setAgents(agentRows);
    if (q.trim()) {
      const found = await api.search(vaultKey, agent, q.trim());
      setFiles(found.files);
      setFacts(found.facts);
    } else if (next.graph) {
      const [{ facts: rows }, graph] = await Promise.all([
        api.facts(vaultKey, agent),
        api.graphStats(vaultKey, agent),
      ]);
      setFacts(rows);
      setFiles([]);
      setStats(graph);
    } else {
      const { files: rows } = await api.files(vaultKey, agent, {
        kind: next.kind as FileKind | undefined,
        folder: next.folder,
      });
      setFiles(rows);
      setFacts([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load memory.");
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canWrite = nav.id === "daily" || nav.kind === "qmd" || nav.graph;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted">
              ai-memory-system
            </p>
            <h1 className="font-display text-2xl leading-none">Locus</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setConnect(true)}>
            <Unplug className="size-4" />
            <span className="hidden sm:inline">Connect</span>
          </Button>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              clearStoredKey();
              onLock();
            }}
            aria-label="Lock workspace"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {status.ephemeral ? (
        <p className="border-b border-border bg-elevated px-4 py-2 text-center text-sm text-muted">
          Preview store is in-memory. Publish to keep the file tree.
        </p>
      ) : null}

      <div className="mx-auto grid max-w-6xl gap-0 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
        <aside className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <nav className="flex gap-2 overflow-x-auto lg:flex-col">
            {NAV.map((item) => {
              const Icon = NAV_ICON[item.id] ?? Folder;
              return (
                <LayerBtn
                  key={item.id}
                  active={navId === item.id}
                  label={item.label}
                  meta={item.short}
                  icon={<Icon className="size-3.5" />}
                  onClick={() => {
                    setNavId(item.id);
                    setComposing(false);
                    setSelectedPath(null);
                    setSelectedFact(null);
                    setQuery("");
                    void refresh(item, "");
                  }}
                />
              );
            })}
          </nav>
          <div className="mt-6 hidden lg:block">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Agents</p>
            <ul className="mt-2 space-y-2">
              {agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-fg">{a.displayName}</span>
                  <span className="inline-flex items-center gap-1 tabular-nums text-subtle">
                    <Radio className="size-3" />
                    {timeAgo(a.lastSeenAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="min-w-0 border-b border-border lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 p-4">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                className="pl-9"
                placeholder="Hybrid search — files and facts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void refresh(nav, query);
                }}
                aria-label="Search memory"
              />
            </div>
            {nav.graph ? (
              <Button
                variant="ghost"
                onClick={() => {
                  void api.learn(vaultKey, agent).then((r) => {
                    setLearnMsg(`Synced ${r.synced} headings from daily logs.`);
                    void refresh(nav, query);
                  });
                }}
              >
                <Activity className="size-4" />
                Learn
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                onClick={() => {
                  setComposing(true);
                  setSelectedPath(null);
                  setSelectedFact(null);
                }}
                aria-label={nav.id === "daily" ? "Append" : "Write"}
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">{nav.id === "daily" ? "Append" : "Write"}</span>
              </Button>
            ) : null}
          </div>
          {error ? <p className="px-4 pb-2 text-sm text-danger">{error}</p> : null}
          {learnMsg ? <p className="px-4 pb-2 text-sm text-muted">{learnMsg}</p> : null}
          <p className="px-4 pb-2 text-xs text-subtle">{nav.hint}</p>
          {nav.graph && stats ? (
            <p className="px-4 pb-2 text-xs tabular-nums text-muted">
              {stats.facts} facts · {stats.related} RELATED_TO · {stats.learned} LEARNED_IN
              {stats.agents.length
                ? ` · ${stats.agents
                    .map(
                      (a) =>
                        `${a.id} ${a.lastPushAt ? "pushed " + timeAgo(a.lastPushAt) : a.lastPullAt ? "pulled " + timeAgo(a.lastPullAt) : "idle"}`,
                    )
                    .join(" · ")}`
                : ""}
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {loading ? (
              <li className="px-4 py-8 text-sm text-muted">Loading…</li>
            ) : nav.graph || (query && facts.length) ? (
              facts.length === 0 && files.length === 0 ? (
                <li className="px-4 py-10 text-sm text-muted">No facts yet. Distill from dailies.</li>
              ) : (
                <>
                  {facts.map((f) => (
                    <li key={f.name}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFact(f.name);
                          setSelectedPath(null);
                          setComposing(false);
                        }}
                        className={cn(
                          "flex w-full flex-col items-start gap-1 px-4 py-3.5 text-left hover:bg-elevated",
                          selectedFact === f.name && "bg-elevated",
                        )}
                      >
                        <div className="flex w-full items-center gap-2">
                          <Badge>L4</Badge>
                          <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                        </div>
                        <p className="line-clamp-2 text-sm text-muted">{f.summary || f.content}</p>
                      </button>
                    </li>
                  ))}
                  {files.map((f) => (
                    <FileRow
                      key={f.path}
                      file={f}
                      active={selectedPath === f.path}
                      onClick={() => {
                        setSelectedPath(f.path);
                        setSelectedFact(null);
                        setComposing(false);
                      }}
                    />
                  ))}
                </>
              )
            ) : files.length === 0 ? (
              <li className="px-4 py-10 text-sm text-muted">Nothing in this folder yet.</li>
            ) : (
              files.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  active={selectedPath === f.path}
                  onClick={() => {
                    setSelectedPath(f.path);
                    setComposing(false);
                  }}
                />
              ))
            )}
          </ul>
        </section>

        <section className="min-w-0 p-4">
          {composing && nav.id === "daily" ? (
            <AppendForm
              onCancel={() => setComposing(false)}
              onSave={async (body, evidence) => {
                const { file } = await api.appendDaily(vaultKey, agent, body, evidence);
                setComposing(false);
                setSelectedPath(file.path);
                await refresh(nav, query);
              }}
            />
          ) : composing && nav.kind === "qmd" ? (
            <QmdForm
              folder={nav.folder ?? "inbox"}
              onCancel={() => setComposing(false)}
              onSave={async (input) => {
                const { file } = await api.putFile(vaultKey, agent, input);
                setComposing(false);
                setSelectedPath(file.path);
                await refresh(nav, query);
              }}
            />
          ) : composing && nav.graph ? (
            <FactForm
              onCancel={() => setComposing(false)}
              onSave={async (input) => {
                const { fact: saved } = await api.putFact(vaultKey, agent, input);
                setComposing(false);
                setSelectedFact(saved.name);
                await refresh(nav, query);
              }}
            />
          ) : selected ? (
            <FileDetail
              file={selected}
              onSave={async (patch) => {
                const { file } = await api.putFile(vaultKey, agent, {
                  path: selected.path,
                  title: patch.title,
                  body: patch.body,
                  tags: patch.tags,
                });
                setSelectedPath(file.path);
                await refresh(nav, query);
              }}
            />
          ) : fact ? (
            <FactDetail
              fact={fact}
              vaultKey={vaultKey}
              agent={agent}
              onOpen={(name) => {
                setSelectedFact(name);
                setComposing(false);
              }}
            />
          ) : (
            <div className="flex h-full min-h-48 flex-col justify-center px-2 py-10 text-muted">
              <p className="font-display text-2xl text-fg">Quiet, for now</p>
              <p className="mt-2 max-w-sm text-sm">{nav.hint}</p>
            </div>
          )}
        </section>
      </div>

      {connect ? (
        <ConnectPanel origin={window.location.origin} onClose={() => setConnect(false)} />
      ) : null}
    </div>
  );
}

function FileRow({
  file,
  active,
  onClick,
}: {
  file: FileRecord;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full flex-col items-start gap-1 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-elevated",
          active && "bg-elevated",
        )}
      >
        <div className="flex w-full items-center gap-2">
          <Badge>{file.kind === "qmd" ? file.folder ?? "qmd" : file.kind}</Badge>
          <span className="min-w-0 flex-1 truncate font-medium">{file.title}</span>
        </div>
        <p className="truncate font-mono text-xs text-subtle">{file.path}</p>
        <p className="line-clamp-2 text-sm text-muted">{file.summary || file.body}</p>
      </button>
    </li>
  );
}

function LayerBtn({
  active,
  label,
  meta,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  meta?: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm transition-colors duration-150",
        active ? "bg-elevated text-fg" : "text-muted hover:bg-elevated hover:text-fg",
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {meta ? <span className="hidden text-xs text-subtle lg:inline">{meta}</span> : null}
    </button>
  );
}

function AppendForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (body: string, evidence: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(body, evidence);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not append.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="locus-in space-y-4">
      <h2 className="font-display text-3xl">Append today</h2>
      <p className="text-sm text-muted">Writes a timestamped section onto memory/YYYY-MM-DD.md.</p>
      <Textarea required value={body} onChange={(e) => setBody(e.target.value)} aria-label="Note" />
      <EvidenceSelect value={evidence} onChange={setEvidence} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Append"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function qmdStub(type: string, slug: string, title: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString().slice(0, 19);
  const id = slug || "topic";
  return `---
id: ${id}
type: ${type}
tags: []
created: ${day}
updated: "${now}"
priority: medium
status: active
summary: ""
---

# ${title || "Untitled"}
`;
}

function QmdForm({
  folder,
  onCancel,
  onSave,
}: {
  folder: QmdFolder;
  onCancel: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [qmdType, setQmdType] = useState(folder === "projects" ? "project" : "session");
  const [dest, setDest] = useState<QmdFolder>(folder);
  const [body, setBody] = useState(() => qmdStub(folder === "projects" ? "project" : "session", "", ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({ kind: "qmd", folder: dest, slug, title, body, qmdType });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="locus-in space-y-4">
      <h2 className="font-display text-3xl">New QMD</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="folder">Folder</Label>
          <select
            id="folder"
            value={dest}
            onChange={(e) => setDest(e.target.value as QmdFolder)}
            className="h-11 w-full rounded-[var(--radius-sm)] bg-elevated px-3 text-base text-fg shadow-[var(--shadow-border)]"
          >
            {QMD_FOLDERS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qtype">Type</Label>
          <select
            id="qtype"
            value={qmdType}
            onChange={(e) => setQmdType(e.target.value)}
            className="h-11 w-full rounded-[var(--radius-sm)] bg-elevated px-3 text-base text-fg shadow-[var(--shadow-border)]"
          >
            {QMD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="kebab-case"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">Body</Label>
        <Textarea
          id="body"
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-48 font-mono text-sm"
        />
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FactForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({ name, summary, content, evidence: "USER-VERIFIED" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="locus-in space-y-4">
      <h2 className="font-display text-3xl">Fact</h2>
      <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summary" />
      <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Content" />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FileDetail({
  file,
  onSave,
}: {
  file: FileRecord;
  onSave: (patch: { title: string; body: string; tags: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(file.title);
  const [body, setBody] = useState(file.body);
  const [tags, setTags] = useState(file.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(file.title);
    setBody(file.body);
    setTags(file.tags);
    setError("");
  }, [file]);

  const dirty = title !== file.title || body !== file.body || tags !== file.tags;
  const over = file.kind === "curated" && body.length > MEMORY_CHAR_TARGET;

  return (
    <article className="locus-in space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="paper">{file.path}</Badge>
        {file.evidence ? <Badge>{file.evidence}</Badge> : null}
        <span className="text-xs tabular-nums text-subtle">{file.chars} chars</span>
      </div>
      {over ? (
        <p className="text-sm text-danger">
          MEMORY.md is over the {MEMORY_CHAR_TARGET.toLocaleString()} character target. Distill.
        </p>
      ) : null}
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Body"
        className="min-h-64 font-mono text-sm"
      />
      <Input value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button
        disabled={!dirty || busy}
        onClick={() => {
          setBusy(true);
          void onSave({ title, body, tags })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save."))
            .finally(() => setBusy(false));
        }}
      >
        Save changes
      </Button>
    </article>
  );
}

function FactDetail({
  fact,
  vaultKey,
  agent,
  onOpen,
}: {
  fact: FactRecord;
  vaultKey: string;
  agent: string;
  onOpen: (name: string) => void;
}) {
  const [related, setRelated] = useState<FactRecord[]>([]);

  useEffect(() => {
    void api
      .traverse(vaultKey, agent, fact.name, 2)
      .then((r) => setRelated(r.related))
      .catch(() => setRelated([]));
  }, [fact.name, vaultKey, agent]);

  return (
    <article className="locus-in space-y-3">
      <Badge tone="paper">L4</Badge>
      <h2 className="font-display text-3xl">{fact.name}</h2>
      <p className="text-muted">{fact.summary}</p>
      <p className="whitespace-pre-wrap text-sm">{fact.content}</p>
      <p className="text-xs text-subtle">
        {fact.assistant}
        {fact.sourcePath ? ` · ${fact.sourcePath}` : ""}
      </p>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">RELATED_TO</p>
        {related.length === 0 ? (
          <p className="mt-2 text-sm text-subtle">
            No edges yet. Facts that share a daily log are linked automatically.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {related.map((r) => (
              <li key={r.name}>
                <button
                  type="button"
                  onClick={() => onOpen(r.name)}
                  className="text-left text-sm text-fg hover:underline"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function EvidenceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="evidence">Evidence</Label>
      <select
        id="evidence"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-[var(--radius-sm)] bg-elevated px-3 text-base text-fg shadow-[var(--shadow-border)]"
      >
        {EVIDENCE.map((tag) => (
          <option key={tag || "none"} value={tag}>
            {tag || "none"}
          </option>
        ))}
      </select>
    </div>
  );
}
