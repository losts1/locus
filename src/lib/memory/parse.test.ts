import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "./errors.ts";
import { parseBoundedInt, parseIsoTime, restPath } from "./parse.ts";

describe("parseBoundedInt", () => {
  it("returns the fallback when the param is missing or empty", () => {
    assert.equal(parseBoundedInt(null, 8, 1, 200), 8);
    assert.equal(parseBoundedInt("", 8, 1, 200), 8);
  });

  it("clamps a numeric string into [min, max]", () => {
    assert.equal(parseBoundedInt("8", 8, 1, 200), 8);
    assert.equal(parseBoundedInt("-3", 8, 1, 200), 1);
    assert.equal(parseBoundedInt("99999", 8, 1, 200), 200);
  });

  it("rejects non-integers with 400 instead of producing NaN", () => {
    assert.throws(() => parseBoundedInt("foo", 8, 1, 200), (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 400);
      return true;
    });
  });
});

describe("parseIsoTime", () => {
  it("returns undefined when the param is missing", () => {
    assert.equal(parseIsoTime(null), undefined);
    assert.equal(parseIsoTime(""), undefined);
  });

  it("accepts an ISO timestamptz", () => {
    assert.equal(parseIsoTime("2026-08-01T00:00:00Z"), "2026-08-01T00:00:00Z");
  });

  it("rejects garbage so push/pull cannot 500 on timestamptz cast", () => {
    assert.throws(() => parseIsoTime("nope"), (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 400);
      return true;
    });
  });
});

describe("restPath", () => {
  it("strips /api/v1/ and nested segments", () => {
    assert.equal(restPath("/api/v1/status"), "status");
    assert.equal(restPath("/api/v1/files/append"), "files/append");
    assert.equal(restPath("/api/v1/graph/cypher"), "graph/cypher");
    assert.equal(restPath("/api/v1/files/memory/core/identity.qmd"), "files/memory/core/identity.qmd");
  });

  it("maps malformed percent-encoding to 400", () => {
    assert.throws(() => restPath("/api/v1/files/%"), (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 400);
      return true;
    });
  });
});
