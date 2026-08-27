import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOCUS_SKILL } from "@/lib/memory/skill-text";

type Props = {
  origin: string;
  onClose: () => void;
};

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{label}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-xs)] px-2 text-xs text-muted hover:bg-elevated hover:text-fg"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-[var(--radius-md)] bg-bg px-3 py-3 font-mono text-xs leading-relaxed text-fg">
        {value}
      </pre>
    </div>
  );
}

export function ConnectPanel({ origin, onClose }: Props) {
  const publishedHint = origin.includes("localhost") || origin.includes("127.0.0.1");
  const curl = useMemo(
    () =>
      `export LOCUS_URL="${publishedHint ? "https://YOUR-APP.grok.me" : origin}"
export LOCUS_KEY="your-workspace-key"
export LOCUS_AGENT="home-grok"

# Session start — SOUL, USER, MEMORY.md, today+yesterday
curl -sS "$LOCUS_URL/api/v1/recall" \\
  -H "Authorization: Bearer $LOCUS_KEY" \\
  -H "X-Locus-Agent: $LOCUS_AGENT"

# Append today's log (L2)
curl -sS -X POST "$LOCUS_URL/api/v1/files/append" \\
  -H "Authorization: Bearer $LOCUS_KEY" \\
  -H "X-Locus-Agent: $LOCUS_AGENT" \\
  -H "Content-Type: application/json" \\
  -d '{"body":"what happened","evidence":"USER-VERIFIED"}'

# Two-way graph: pull Locus → apply on home Neo4j
curl -sS "$LOCUS_URL/api/v1/graph/pull" \\
  -H "Authorization: Bearer $LOCUS_KEY" \\
  -H "X-Locus-Agent: $LOCUS_AGENT" \\
  > /tmp/locus-graph.json

curl -sS "$LOCUS_URL/api/v1/graph/cypher?format=cypher" \\
  -H "Authorization: Bearer $LOCUS_KEY" \\
  -H "X-Locus-Agent: $LOCUS_AGENT" \\
  | cypher-shell -u neo4j

# Push home facts → Locus (last-write-wins on updatedAt)
curl -sS -X POST "$LOCUS_URL/api/v1/graph/push" \\
  -H "Authorization: Bearer $LOCUS_KEY" \\
  -H "X-Locus-Agent: $LOCUS_AGENT" \\
  -H "Content-Type: application/json" \\
  -d '{"facts":[{"name":"example","summary":"...","content":"...","updatedAt":"2026-08-27T16:00:00Z"}]}'`,
    [origin, publishedHint],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-3 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="connect-title"
        className="locus-in max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-surface p-5 shadow-[var(--shadow-border)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Both agents
            </p>
            <h2 id="connect-title" className="mt-1 font-display text-3xl">
              Connect
            </h2>
          </div>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="mt-3 text-muted">
          Cloud Grok Build in this chat can use the preview. Home Grok Build needs the{" "}
          <strong className="font-medium text-fg">published</strong> URL after you ship the app.
          Neo4j clustering is one-way; two-way sync is pull / Cypher / push through this hub.
        </p>
        {publishedHint ? (
          <p className="mt-2 text-sm text-subtle">
            This preview origin is not reachable from your home PC.
          </p>
        ) : null}

        <div className="mt-6 space-y-5">
          <CopyBlock label="This origin" value={origin} />
          <CopyBlock label="curl from Home Grok Build" value={curl} />
          <CopyBlock label="Grok Build skill" value={LOCUS_SKILL} />
        </div>
      </div>
    </div>
  );
}
