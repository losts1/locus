import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LockScreen } from "@/components/lock-screen";
import { MemoryApp } from "@/components/memory-app";
import { loadStoredKey, saveStoredAgent, saveStoredKey } from "@/lib/memory/api";
import type { VaultStatus } from "@/lib/memory/types";
import { api } from "@/lib/memory/api";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [boot, setBoot] = useState(true);
  const [status, setStatus] = useState<VaultStatus>({ setup: false, ephemeral: true });
  const [key, setKey] = useState("");
  const agent = "ui";

  useEffect(() => {
    saveStoredAgent(agent);
    const stored = loadStoredKey();
    void api
      .status()
      .then(async (s) => {
        setStatus(s);
        if (stored && s.setup) {
          try {
            await api.unlock(stored, agent);
            setKey(stored);
          } catch {
            /* stale key */
          }
        }
      })
      .finally(() => setBoot(false));
  }, []);

  if (boot) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg text-muted">
        <p className="font-display text-2xl text-fg">Locus</p>
      </main>
    );
  }

  if (!key) {
    return (
      <LockScreen
        status={status}
        agent={agent}
        onUnlocked={(next) => {
          saveStoredKey(next);
          setStatus((s) => ({ ...s, setup: true }));
          setKey(next);
        }}
      />
    );
  }

  return (
    <MemoryApp
      vaultKey={key}
      agent={agent}
      status={status}
      onLock={() => setKey("")}
    />
  );
}
