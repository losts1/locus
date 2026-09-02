import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "./errors.ts";
import { assertPath, assertUnchanged } from "./path.ts";

describe("assertPath", () => {
  it("accepts the ai-memory-system tree", () => {
    for (const p of [
      "SOUL.md",
      "USER.md",
      "MEMORY.md",
      "HEARTBEAT.md",
      "memory/INDEX.qmd",
      "memory/2026-08-28.md",
      "memory/2026-08-28-cloud.md",
      "memory/core/identity.qmd",
    ]) {
      assert.equal(assertPath(p), p);
    }
  });

  it("strips a leading slash", () => {
    assert.equal(assertPath("/SOUL.md"), "SOUL.md");
  });

  it("rejects occupancy mismatch", () => {
    assert.throws(() => assertUnchanged(undefined, "2026-08-28T00:00:00.000Z"), (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 409);
      return true;
    });
    assert.throws(
      () => assertUnchanged("2026-08-27T00:00:00.000Z", "2026-08-28T00:00:00.000Z"),
      (err: unknown) => err instanceof HttpError && err.status === 409,
    );
    assert.equal(
      assertUnchanged("2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z"),
      undefined,
    );
  });

  it("rejects traversal and unknown trees", () => {
    for (const p of ["../SOUL.md", "memory/core/../../../etc/passwd", "secrets.env"]) {
      assert.throws(() => assertPath(p), (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 400);
        return true;
      });
    }
  });
});
