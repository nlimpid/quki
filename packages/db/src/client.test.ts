import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tidbcloud/serverless", () => ({
  connect: vi.fn<
    (config: { url: string; fullResult: boolean }) => { execute: () => Promise<unknown> }
  >(() => ({
    execute: async () => [],
  })),
}));

import { connect } from "@tidbcloud/serverless";

import { connectTiDb, rowsOf } from "./client.js";

describe("rowsOf", () => {
  it("reads a bare array and a fullResult object", () => {
    const bare = [{ id: "1", symbol: "H30269" }];
    const wrapped = { rows: [{ id: "2", symbol: "000922" }], rowsAffected: 0 };
    expect(rowsOf(bare)).toEqual(bare);
    expect(rowsOf(wrapped)).toEqual(wrapped.rows);
    expect(rowsOf({ rows: null })).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf([{ id: "3" }, ["not", "a", "row"]])).toEqual([{ id: "3" }]);
  });
});

describe("connectTiDb", () => {
  beforeEach(() => {
    vi.mocked(connect).mockClear();
  });

  it("asks the serverless driver for the full result object", () => {
    connectTiDb("mysql://user:password@gateway.example:4000/quki");
    expect(connect).toHaveBeenCalledWith({
      url: "mysql://user:password@gateway.example:4000/quki",
      fullResult: true,
    });
  });
});
