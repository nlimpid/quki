// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { HOLDINGS_STORAGE_KEY } from "@quki/analytics";

import { clearUiDraftsForTests } from "../lib/accountDraft.js";
import type { AuthPhase } from "../lib/authState.js";
import {
  HOLDINGS_ESTIMATE_EXPIRED,
  HOLDINGS_ESTIMATE_LOADING,
  HoldingsEstimate,
} from "./HoldingsEstimateCard.js";
import { PortfolioBody } from "../pages/PortfolioPage.js";

const login = { state: "unavailable", reason: "auth_not_configured" } as const;

function signedIn(userId: string): AuthPhase {
  return { kind: "authenticated", userId, displayName: null, csrfToken: "csrf-token", login };
}

const guest: AuthPhase = { kind: "guest", expired: false, login };

const reference = {
  kind: "trailing_12_month_implemented_cash" as const,
  label:
    "近12个自然月已实施的税前每股现金 × 股数。这是截至行情日期的历史参考，不是未来分红预测，也不含尚未实施的预案。",
  pretax: true as const,
  guaranteed: false as const,
  includesUnimplementedPlans: false as const,
  asOf: "2026-11-14",
  datesDiffer: false,
  heldCount: 2,
  coveredCount: 1,
  missingCount: 1,
  totalCashCny: "10",
  partial: true,
  lines: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("account holdings interface", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let root: Root | null = null;
  const host = document.createElement("div");
  document.body.append(host);

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.replaceChildren();
    clearUiDraftsForTests();
    localStorage.clear();
  });

  function render(node: ReactNode) {
    root ??= createRoot(host);
    act(() => {
      root?.render(node);
    });
  }

  function setInput(selector: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(selector);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return input;
  }

  it("ends the homepage loading state when the account request is unauthorized", async () => {
    const fetchImpl = async () => json({ error: "unauthorized" }, 401);
    render(createElement(HoldingsEstimate, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    expect(host.textContent).toContain(HOLDINGS_ESTIMATE_EXPIRED);
    expect(host.textContent).not.toContain(HOLDINGS_ESTIMATE_LOADING);
  });

  it("shows coverage on a ready reference and asks before replacing a quantity", async () => {
    const posts: unknown[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json({
          items: [{ code: "000001", shares: 40, updatedAt: "2026-11-16T00:00:00.000Z" }],
          reference: {
            ...reference,
            heldCount: 1,
            coveredCount: 1,
            missingCount: 0,
            partial: false,
            totalCashCny: "10",
          },
          visionConfigured: false,
          imageDisclosure: "披露",
        });
      }
      return json({
        items: [
          { code: "000001", shares: 100, updatedAt: "2026-11-16T00:00:00.000Z" },
          { code: "000002", shares: 7, updatedAt: "2026-11-16T00:00:00.000Z" },
        ],
        reference,
        visionConfigured: false,
        imageDisclosure: "披露",
      });
    };
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    expect(host.textContent).toContain("已计入 1 只，持仓共 2 只");
    expect(host.textContent).toContain("统计日期 2026-11-14");
    expect(host.textContent).toContain("识图服务尚未选择，图片不会上传。");
    await act(async () => {
      setInput("[aria-label='股票代码']", "000001");
      setInput("[aria-label='总股数']", "40");
    });
    const form = host.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain("当前是 100 股");
    expect(posts).toHaveLength(0);
    const confirm = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "确认替换股数",
    );
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      items: expect.arrayContaining([{ code: "000001", shares: 40 }]),
    });
  });

  it("keeps an unsaved account draft on the same user and does not give it to another", async () => {
    const fetchImpl = async () =>
      json({
        items: [],
        reference: {
          ...reference,
          heldCount: 0,
          coveredCount: 0,
          missingCount: 0,
          partial: false,
          totalCashCny: null,
          asOf: null,
        },
        visionConfigured: false,
        imageDisclosure: "披露",
      });
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    await act(async () => {
      setInput("[aria-label='股票代码']", "600519");
    });
    render(createElement(PortfolioBody, { phase: guest, fetchImpl }));
    expect(localStorage.getItem(HOLDINGS_STORAGE_KEY)).toBeNull();
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    expect(host.querySelector<HTMLInputElement>("[aria-label='股票代码']")?.value).toBe("600519");
    render(createElement(PortfolioBody, { phase: signedIn("user-b"), fetchImpl }));
    await settle();
    expect(host.querySelector<HTMLInputElement>("[aria-label='股票代码']")?.value).toBe("");
    expect(localStorage.getItem(HOLDINGS_STORAGE_KEY)).toBeNull();
  });

  it("reviews a mocked preview and does not treat available shares as the quantity", async () => {
    const calls: { url: string; body: Record<string, unknown> | null }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, body });
      if (url.endsWith("/api/holdings/preview")) {
        return json({
          draftId: "88888888-8888-4888-8888-888888888888",
          sourceRows: [
            { code: "000001", name: "合成平安", totalShares: "1,200", availableShares: "300" },
            { code: "000002", name: "合成地产", totalShares: "约500", availableShares: "100" },
          ],
          catalog: [{ code: "000001", name: "平安银行" }],
        });
      }
      if (url.endsWith("/api/holdings/apply")) {
        return json({ items: [], reference, visionConfigured: true, imageDisclosure: "披露" });
      }
      return json({
        items: [{ code: "000001", shares: 100, updatedAt: "2026-11-16T00:00:00.000Z" }],
        reference,
        visionConfigured: true,
        imageDisclosure: "识图会把截图送到尚未选定的第三方视觉服务处理。",
      });
    };
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    const consent = host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']");
    const file = host.querySelector<HTMLInputElement>("[aria-label='选择截图']");
    expect(file?.disabled).toBe(true);
    await act(async () => {
      consent?.click();
    });
    const shot = new File([Uint8Array.from([1, 2, 3])], "shot.png", { type: "image/png" });
    await act(async () => {
      Object.defineProperty(file, "files", { configurable: true, value: [shot] });
      file?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const preview = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "生成待核对预览",
    );
    await act(async () => {
      preview?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.textContent).toContain("已忽略可用股数，只采用总股数");
    expect(host.textContent).toContain("总股数无法确定，需要你填写");
    expect(host.textContent).toContain("原文总股数 1,200，可用股数 300");
    await act(async () => {
      for (const label of [
        "核对名称 000001",
        "纳入 000002",
        "确认未知代码 000002",
        "确认股数 000002",
      ]) {
        host.querySelector<HTMLInputElement>(`[aria-label='${label}']`)?.click();
      }
      setInput("[aria-label='000002 总股数']", "20");
    });
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='确认用总股数设置账户']")?.click();
    });
    await settle();
    const apply = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "确认写入识别结果",
    );
    expect(apply).toBeTruthy();
    await act(async () => {
      apply?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    const applied = calls.find((call) => call.url.endsWith("/api/holdings/apply"));
    const rows = (applied?.body?.rows ?? []) as { code: string; shares: number }[];
    expect(rows.map((row) => row.shares)).toEqual(expect.arrayContaining([1200, 20]));
    expect(rows.some((row) => row.shares === 300 || row.shares === 100)).toBe(false);
    expect(calls.filter((call) => call.url.endsWith("/api/holdings/apply"))).toHaveLength(1);
  });
});
