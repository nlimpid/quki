import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { splitSql } from "./sql.js";

describe("splitSql", () => {
  it("splits the phase-1 schema without dropping the seed statement", () => {
    const sql = readFileSync(resolve("db/migrations/0001_init.sql"), "utf8");
    const statements = splitSql(sql);
    expect(
      statements.some((statement) =>
        statement.startsWith("CREATE TABLE IF NOT EXISTS instruments"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.startsWith("CREATE TABLE IF NOT EXISTS bars")),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.startsWith("CREATE TABLE IF NOT EXISTS crawl_watermarks"),
      ),
    ).toBe(true);
    expect(statements.some((statement) => statement.includes("INSERT INTO instruments"))).toBe(
      true,
    );
    expect(statements.some((statement) => statement.startsWith("UPDATE instruments"))).toBe(true);
    expect(statements.every((statement) => !statement.includes("--"))).toBe(true);
  });
});
