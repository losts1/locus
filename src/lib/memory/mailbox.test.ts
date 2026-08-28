import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { HttpError } from "./errors.ts";
import type { MailboxSql } from "./sql.ts";
import {
  appendDailyTx,
  exportCypherTx,
  pullGraphTx,
  pushGraphTx,
  throttleAuthTx,
} from "./mailbox.ts";

const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function boot(): Promise<MailboxSql> {
  const pg = new PGlite({
    parsers: {
      [OID_INT8]: Number,
      [OID_DATE]: (v: string) => v,
      [OID_INTERVAL]: (v: string) => v,
    },
  });
  await pg.waitReady;
  for (const name of [
    "0002_locus.sql",
    "0003_ai_memory_files.sql",
    "0004_graph_sync.sql",
    "0005_mailbox_sync.sql",
  ]) {
    await pg.exec(readFileSync(join(root, "migrations", name), "utf8"));
  }
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
}

describe("pushGraphTx last-write-wins", () => {
  let sql: MailboxSql;
  before(async () => {
    sql = await boot();
  });

  it("skips an older incoming fact and applies a newer one", async () => {
    const first = await pushGraphTx(sql, "home-grok", {
      facts: [
        {
          name: "Mailbox LWW",
          summary: "v1",
          content: "first",
          updatedAt: "2026-08-28T12:00:00.000Z",
        },
      ],
    });
    assert.equal(first.upserted, 1);
    const older = await pushGraphTx(sql, "cloud-grok", {
      facts: [
        {
          name: "Mailbox LWW",
          summary: "stale",
          content: "should not land",
          updatedAt: "2026-08-28T11:00:00.000Z",
        },
      ],
    });
    assert.equal(older.skipped, 1);
    assert.equal(older.upserted, 0);
    const newer = await pushGraphTx(sql, "cloud-grok", {
      facts: [
        {
          name: "Mailbox LWW",
          summary: "v2",
          content: "second",
          updatedAt: "2026-08-28T13:00:00.000Z",
        },
      ],
    });
    assert.equal(newer.upserted, 1);
    const rows = await sql.query<{ summary: string }>(
      "select summary from locus_facts where name = $1",
      ["Mailbox LWW"],
    );
    assert.equal(rows[0]?.summary, "v2");
  });

  it("rejects push facts without a valid updatedAt", async () => {
    await assert.rejects(
      () =>
        pushGraphTx(sql, "home-grok", {
          facts: [{ name: "No timestamp", summary: "x", content: "y" }],
        }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 400);
        return true;
      },
    );
    await assert.rejects(
      () =>
        pushGraphTx(sql, "home-grok", {
          facts: [{ name: "Bad timestamp", summary: "x", content: "y", updatedAt: "nope" }],
        }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 400);
        return true;
      },
    );
  });
});

describe("appendDailyTx", () => {
  it("concatenates two appends so neither chunk is lost", async () => {
    const sql = await boot();
    await appendDailyTx(sql, "cloud wrote this", "cloud-grok", "Cloud Grok Build", "USER-VERIFIED", "2026-08-28");
    await appendDailyTx(sql, "home wrote this", "home-grok", "Home Grok Build", "USER-VERIFIED", "2026-08-28");
    const rows = await sql.query<{ body: string }>(
      "select body from locus_files where path = $1",
      ["memory/2026-08-28.md"],
    );
    assert.match(rows[0]?.body ?? "", /cloud wrote this/);
    assert.match(rows[0]?.body ?? "", /home wrote this/);
  });
});

describe("pullGraphTx incremental edges", () => {
  it("returns a new RELATED_TO between unchanged facts plus both endpoints", async () => {
    const sql = await boot();
    await pushGraphTx(sql, "home-grok", {
      facts: [
        { name: "Alpha", summary: "a", content: "a", updatedAt: "2026-08-01T00:00:00.000Z" },
        { name: "Beta", summary: "b", content: "b", updatedAt: "2026-08-01T00:00:00.000Z" },
      ],
    });
    await sql.query("update locus_facts set updated_at = '2026-08-01T00:00:00Z'");
    await sql.query(
      "insert into locus_related (a_name, b_name, created_at) values ('Alpha','Beta', '2026-08-28T15:00:00Z')",
    );
    const pulled = await pullGraphTx(sql, "home-grok", "2026-08-27T00:00:00Z");
    assert.equal(pulled.facts.length, 2);
    assert.deepEqual(
      pulled.related.map((e) => `${e.a}|${e.b}`).sort(),
      ["Alpha|Beta"],
    );
  });
});

describe("exportCypherTx", () => {
  it("dumps more than 200 facts with LWW FOREACH and no LIMIT", async () => {
    const sql = await boot();
    for (let i = 0; i < 12; i += 1) {
      await sql.query(
        `insert into locus_facts (name, summary, content, updated_at)
         values ($1,'s','c','2026-08-28T00:00:00Z')`,
        [`Fact ${String(i).padStart(3, "0")}`],
      );
    }
    const dump = await exportCypherTx(sql);
    assert.equal((dump.cypher.match(/MERGE \(f:Fact/g) ?? []).length, 12);
    assert.equal(dump.facts, 12);
    assert.match(dump.cypher, /FOREACH \(_ IN CASE WHEN f\.updated_at IS NULL/);
    assert.doesNotMatch(dump.cypher, /limit 200/i);
  });
});

describe("throttleAuthTx", () => {
  it("returns 429 after the window fills, before the caller would scrypt", async () => {
    const sql = await boot();
    for (let i = 0; i < 20; i += 1) {
      await throttleAuthTx(sql, "unlock_fail", 20, 60);
    }
    await assert.rejects(() => throttleAuthTx(sql, "unlock_fail", 20, 60), (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 429);
      return true;
    });
  });
});
