import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cypherStr, factMergeCypher, renderCypherDump } from "./cypher.ts";

describe("cypherStr", () => {
  it("escapes quotes, backslashes, and newlines", () => {
    assert.equal(cypherStr("O'Brien"), "'O\\'Brien'");
    assert.equal(cypherStr("a\\b"), "'a\\\\b'");
    assert.equal(cypherStr("line\nbreak"), "'line\\nbreak'");
  });
});

describe("factMergeCypher", () => {
  it("applies properties only when incoming updated_at is newer or equal", () => {
    const stmt = factMergeCypher({
      name: "Two Grok Builds cannot pair directly",
      summary: "mailbox",
      content: "HTTPS",
      key_points: "",
      assistant: "home-grok",
      source_path: "memory/2026-08-28.md",
      evidence: "TOOL-VERIFIED",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T12:00:00.000Z",
    });
    assert.match(stmt, /FOREACH \(_ IN CASE WHEN f\.updated_at IS NULL OR datetime\(/);
    assert.match(stmt, /SET f\.summary = 'mailbox'/);
    assert.doesNotMatch(stmt, /limit 200/i);
  });
});

describe("renderCypherDump", () => {
  it("emits every fact and edge with no row cap", () => {
    const facts = Array.from({ length: 3 }, (_, i) => ({
      name: `Fact ${i}`,
      summary: "",
      content: "",
      key_points: "",
      assistant: "ui",
      source_path: null,
      evidence: "",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    }));
    const dump = renderCypherDump({
      facts,
      related: [{ a_name: "Fact 0", b_name: "Fact 1" }],
      learned: [{ fact_name: "Fact 0", session_path: "memory/2026-08-28.md" }],
      agents: [{ id: "home-grok" }],
    });
    assert.equal((dump.match(/MERGE \(f:Fact/g) ?? []).length, 3);
    assert.match(dump, /MERGE \(a\)-\[:RELATED_TO\]->\(b\)/);
    assert.match(dump, /MERGE \(f\)-\[:LEARNED_IN\]->\(s\)/);
    assert.doesNotMatch(dump, /limit 200/i);
    assert.doesNotMatch(dump, /limit 400/i);
  });
});
