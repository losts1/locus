import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/memory/api";
import type { VaultStatus } from "@/lib/memory/types";

type Props = {
  status: VaultStatus;
  agent: string;
  onUnlocked: (key: string) => void;
};

export function LockScreen({ status, agent, onUnlocked }: Props) {
  const [key, setKey] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = !status.setup;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (first && key !== confirm) {
      setError("Keys do not match.");
      return;
    }
    setBusy(true);
    try {
      if (first) await api.setup(key, agent);
      else await api.unlock(key, agent);
      onUnlocked(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
        ai-memory-system
      </p>
      <h1 className="mt-3 font-display text-5xl text-fg">Locus</h1>
      <p className="mt-4 max-w-md text-muted">
        Remote host of the ai-memory-system file tree. SOUL.md, USER.md, MEMORY.md, daily logs,
        QMD folders, and a fact graph. Cloud and home write here over HTTPS. They never reach
        each other.
      </p>

      <form
        onSubmit={(e) => void submit(e)}
        className="mt-10 space-y-4 rounded-[28px] bg-surface p-5 shadow-[var(--shadow-border)] sm:p-6"
      >
        <div className="space-y-1.5">
          <Label htmlFor="key">{first ? "Create workspace key" : "Workspace key"}</Label>
          <Input
            id="key"
            type="password"
            autoComplete="current-password"
            minLength={12}
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="At least 12 characters"
          />
        </div>
        {first ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm key</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        ) : null}
        <p className="text-sm text-subtle">
          Same key on this UI, Cloud Grok Build, and Home Grok Build. It is hashed here — never
          stored in the clear.
        </p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy} size="lg">
          {busy ? "Working…" : first ? "Create workspace" : "Unlock"}
        </Button>
      </form>

      {status.ephemeral ? (
        <p className="mt-6 text-sm text-subtle">
          Preview storage lives in memory and resets when the server restarts. Publish to keep
          memories on Neon so the home machine can join.
        </p>
      ) : null}
    </main>
  );
}
