// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOLDINGS_STORAGE_KEY, IMAGE_PROCESS_CONSENT } from "@quki/analytics";

import { clearUiDraftsForTests } from "../lib/accountDraft.js";
import { writeHoldings } from "../lib/holdingsStore.js";
import type { AuthPhase } from "../lib/authState.js";
import {
  HOLDINGS_ESTIMATE_EXPIRED,
  HOLDINGS_ESTIMATE_LOADING,
  HoldingsEstimate,
} from "./HoldingsEstimateCard.js";
import { AccountHoldings } from "./AccountHoldings.js";
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
  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? {
          operationToken: "op.v1.1763251200000.00000000-0000-4000-8000-000000000099",
          ...(body as Record<string, unknown>),
        }
      : body;
  return new Response(JSON.stringify(payload), {
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

  const unhandled: string[] = [];

  beforeEach(() => {
    unhandled.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/stocks/batch")) {
          return json({ items: [], isSample: false });
        }
        unhandled.push(url);
        throw new Error(`unhandled fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.replaceChildren();
    clearUiDraftsForTests();
    localStorage.clear();
    if (unhandled.length > 0) throw new Error(`unhandled fetch ${unhandled.join(", ")}`);
    vi.unstubAllGlobals();
  });

  function render(node: ReactNode) {
    root ??= createRoot(host);
    act(() => {
      root?.render(createElement(MemoryRouter, null, node));
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
    expect(calls.find((call) => call.url.endsWith("/api/holdings/preview"))?.body?.consent).toBe(
      IMAGE_PROCESS_CONSENT,
    );
    expect(host.textContent).toContain("已忽略可用股数，只采用总股数");
    expect(host.textContent).toContain("总股数无法确定，需要你填写");
    expect(host.textContent).toContain("原文总股数 1,200，可用股数 300");
    await act(async () => {
      for (const label of [
        "纳入 000001",
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
    expect(host.textContent).toContain("账户当前 000001");
    expect(host.textContent).toContain("→");
    expect(host.textContent).toContain("代码和名称不能在这里修改");
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

  it("restores screenshot and local previews without the previous confirmation", async () => {
    writeHoldings({
      version: 1,
      items: [{ code: "000001", shares: 40, updatedAt: "2026-11-16T00:00:00.000Z" }],
    });
    const stored = localStorage.getItem(HOLDINGS_STORAGE_KEY);
    const posts: string[] = [];
    const fetchImpl = previewFetch(posts, true);
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    await act(async () => {
      const file = host.querySelector<HTMLInputElement>("[aria-label='选择截图']");
      const shot = new File([Uint8Array.from([1, 2, 3])], "shot.png", { type: "image/png" });
      Object.defineProperty(file, "files", { configurable: true, value: [shot] });
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "生成待核对预览")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "查看本机持仓")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("设为 40 股");
    expect(host.textContent).toContain("000002");
    render(createElement(PortfolioBody, { phase: guest, fetchImpl }));
    expect(localStorage.getItem(HOLDINGS_STORAGE_KEY)).toBe(stored);
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    await act(async () => {
      setInput("[aria-label='000001 总股数']", "77");
    });
    render(createElement(PortfolioBody, { phase: guest, fetchImpl }));
    expect(localStorage.getItem(HOLDINGS_STORAGE_KEY)).toBe(stored);
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    expect(host.textContent).toContain("这是恢复的预览");
    expect(host.textContent).toContain("1,200");
    expect(host.textContent).toContain("设为 40 股");
    expect(host.textContent).toContain("当前不能从这里写入");
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "确认写入识别结果"),
    ).toBe(false);
    expect(posts.filter((url) => url.endsWith("/api/holdings/apply"))).toHaveLength(0);
    expect(localStorage.getItem(HOLDINGS_STORAGE_KEY)).toBe(stored);
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    expect(host.querySelector<HTMLInputElement>("[aria-label='000001 总股数']")?.value).toBe("77");
    const explicit = host.querySelector<HTMLInputElement>("[aria-label='确认用总股数设置账户']");
    expect(explicit?.checked).toBe(false);
    const apply = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "确认写入识别结果",
    ) as HTMLButtonElement | undefined;
    expect(apply?.disabled).toBe(true);
  });

  it("does not offer a writable screenshot confirmation when vision is off", async () => {
    const posts: string[] = [];
    render(
      createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl: previewFetch(posts, true) }),
    );
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    await act(async () => {
      const file = host.querySelector<HTMLInputElement>("[aria-label='选择截图']");
      Object.defineProperty(file, "files", {
        configurable: true,
        value: [new File([Uint8Array.from([1])], "shot.png", { type: "image/png" })],
      });
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "生成待核对预览")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    render(
      createElement(PortfolioBody, {
        phase: signedIn("user-a"),
        fetchImpl: previewFetch(posts, false),
      }),
    );
    await settle();
    expect(host.textContent).toContain("识图服务尚未选择，图片不会上传。");
    expect(host.textContent).toContain("当前不能从这里写入");
    expect(host.querySelector<HTMLInputElement>("[aria-label='选择截图']")?.disabled).toBe(true);
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "确认写入识别结果"),
    ).toBe(false);
  });

  it("does not let another account submit the restored screenshot", async () => {
    const posts: string[] = [];
    const fetchImpl = previewFetch(posts, true);
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    await act(async () => {
      const file = host.querySelector<HTMLInputElement>("[aria-label='选择截图']");
      Object.defineProperty(file, "files", {
        configurable: true,
        value: [new File([Uint8Array.from([1])], "shot.png", { type: "image/png" })],
      });
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "生成待核对预览")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.textContent).toContain("合成平安");
    render(createElement(PortfolioBody, { phase: signedIn("user-b"), fetchImpl }));
    await settle();
    expect(host.textContent).not.toContain("合成平安");
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "确认写入识别结果"),
    ).toBe(false);
    expect(posts.filter((url) => url.endsWith("/api/holdings/apply"))).toHaveLength(0);
  });

  it("keeps the guest drawer text without writing local holdings", async () => {
    const fetchImpl = async () =>
      json({
        items: [],
        reference: { ...reference, heldCount: 0, coveredCount: 0, missingCount: 0, partial: false, totalCashCny: null, asOf: null },
        visionConfigured: false,
        imageDisclosure: "披露",
      });
    render(createElement(PortfolioBody, { phase: guest, fetchImpl }));
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("添加股票"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      setInput("[aria-label='股数']", "88");
    });
    render(createElement(PortfolioBody, { phase: signedIn("user-a"), fetchImpl }));
    await settle();
    render(createElement(PortfolioBody, { phase: guest, fetchImpl }));
    expect(host.querySelector<HTMLInputElement>("[aria-label='股数']")?.value).toBe("88");
    expect(localStorage.getItem(HOLDINGS_STORAGE_KEY)).toBeNull();
  });

  it("ignores a late save after the account changes", async () => {
    const pending: { release: (() => void) | null } = { release: null };
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          pending.release = () =>
            resolve(
              json({
                items: [{ code: "600519", shares: 10, updatedAt: "2026-11-16T00:00:00.000Z" }],
                reference,
                visionConfigured: false,
                imageDisclosure: "甲的结果",
              }),
            );
        });
      }
      return json({
        items: [],
        reference: { ...reference, heldCount: 0, coveredCount: 0, missingCount: 0, partial: false, totalCashCny: null, asOf: null },
        visionConfigured: false,
        imageDisclosure: "乙的披露",
      });
    };
    render(
      createElement(AccountHoldings, { phase: signedIn("user-a"), userId: "user-a", fetchImpl }),
    );
    await settle();
    await act(async () => {
      setInput("[aria-label='股票代码']", "600519");
      setInput("[aria-label='总股数']", "10");
    });
    await act(async () => {
      host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    render(
      createElement(AccountHoldings, { phase: signedIn("user-b"), userId: "user-b", fetchImpl }),
    );
    await settle();
    expect(pending.release).toEqual(expect.any(Function));
    pending.release?.();
    await settle();
    expect(host.textContent).toContain("乙的披露");
    expect(host.textContent).not.toContain("甲的结果");
    expect(host.textContent).toContain("账户里还没有股数");
    expect(host.textContent).not.toContain("600519");
  });

  it("ignores a late preview and a late apply after the account changes", async () => {
    const pending: { release: ((url: string) => void) | null } = { release: null };
    const fetchImpl = async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/holdings/preview") || url.endsWith("/api/holdings/apply")) {
        return new Promise<Response>((resolve) => {
          pending.release = (finished) => {
            if (finished !== url) return;
            resolve(
              url.endsWith("/preview")
                ? json({
                    draftId: "88888888-8888-4888-8888-888888888888",
                    sourceRows: [{ code: "000001", name: "合成平安", totalShares: "1,200" }],
                    catalog: [{ code: "000001", name: "平安银行" }],
                  })
                : json({
                    items: [{ code: "000001", shares: 1200, updatedAt: "2026-11-16T00:00:00.000Z" }],
                    reference,
                    visionConfigured: true,
                    imageDisclosure: "甲的结果",
                  }),
            );
          };
        });
      }
      return json({
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
        visionConfigured: true,
        imageDisclosure: "乙的披露",
      });
    };
    render(createElement(AccountHoldings, { phase: signedIn("user-a"), userId: "user-a", fetchImpl }));
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    await act(async () => {
      const file = host.querySelector<HTMLInputElement>("[aria-label='选择截图']");
      Object.defineProperty(file, "files", {
        configurable: true,
        value: [new File([Uint8Array.from([1])], "shot.png", { type: "image/png" })],
      });
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "生成待核对预览")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    render(createElement(AccountHoldings, { phase: signedIn("user-b"), userId: "user-b", fetchImpl }));
    await settle();
    pending.release?.("/api/holdings/preview");
    await settle();
    expect(host.textContent).toContain("乙的披露");
    expect(host.textContent).not.toContain("合成平安");
    render(createElement(AccountHoldings, { phase: signedIn("user-a"), userId: "user-a", fetchImpl }));
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    await act(async () => {
      const file = host.querySelector<HTMLInputElement>("[aria-label='选择截图']");
      Object.defineProperty(file, "files", {
        configurable: true,
        value: [new File([Uint8Array.from([1])], "shot.png", { type: "image/png" })],
      });
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "生成待核对预览")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    pending.release?.("/api/holdings/preview");
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='纳入 000001']")?.click();
      host.querySelector<HTMLInputElement>("[aria-label='核对名称 000001']")?.click();
      host.querySelector<HTMLInputElement>("[aria-label='确认用总股数设置账户']")?.click();
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "确认写入识别结果")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    render(createElement(AccountHoldings, { phase: signedIn("user-b"), userId: "user-b", fetchImpl }));
    await settle();
    pending.release?.("/api/holdings/apply");
    await settle();
    expect(host.textContent).toContain("乙的披露");
    expect(host.textContent).not.toContain("甲的结果");
    expect(host.textContent).not.toContain("1200");
  });

  it("keeps the form and says a full window is not cleared by emptying the account", async () => {
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return json({ error: "window_full" }, 409);
      return json({
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
    };
    render(createElement(AccountHoldings, { phase: signedIn("user-a"), userId: "user-a", fetchImpl }));
    await settle();
    await act(async () => {
      setInput("[aria-label='股票代码']", "600519");
      setInput("[aria-label='总股数']", "10");
    });
    await act(async () => {
      host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(host.textContent).toContain("4 次保存");
    expect(host.textContent).toContain("清空账户不会腾出次数");
    expect(host.textContent).not.toContain("请清空");
    expect(host.querySelector<HTMLInputElement>("[aria-label='股票代码']")?.value).toBe("600519");
    expect(host.querySelector<HTMLInputElement>("[aria-label='总股数']")?.value).toBe("10");
  });

  it("keeps the screenshot draft when another preview is over the draft cap", async () => {
    let previews = 0;
    const fetchImpl = async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/holdings/preview")) {
        previews += 1;
        if (previews > 1) return json({ error: "window_full" }, 409);
        return json({
          draftId: "88888888-8888-4888-8888-888888888888",
          sourceRows: [{ code: "000001", name: "合成平安", totalShares: "1,200" }],
          catalog: [{ code: "000001", name: "平安银行" }],
        });
      }
      return json({
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
        visionConfigured: true,
        imageDisclosure: "披露",
      });
    };
    render(createElement(AccountHoldings, { phase: signedIn("user-a"), userId: "user-a", fetchImpl }));
    await settle();
    await act(async () => {
      host.querySelector<HTMLInputElement>("[aria-label='同意把截图交给视觉服务']")?.click();
    });
    const file = host.querySelector<HTMLInputElement>("[aria-label='选择截图']");
    await act(async () => {
      Object.defineProperty(file, "files", {
        configurable: true,
        value: [new File([Uint8Array.from([1])], "shot.png", { type: "image/png" })],
      });
      file?.dispatchEvent(new Event("change", { bubbles: true }));
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "生成待核对预览")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.textContent).toContain("合成平安");
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "生成待核对预览")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.textContent).toContain("2 份未过期的识图草稿");
    expect(host.textContent).toContain("清空账户不会腾出次数");
    expect(host.textContent).toContain("合成平安");
    expect(host.textContent).not.toContain("请清空");
  });
});

function previewFetch(posts: string[], visionConfigured: boolean) {
  return async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    posts.push(url);
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
    return json({
      items: [
        { code: "000001", shares: 100, updatedAt: "2026-11-16T00:00:00.000Z" },
        { code: "000002", shares: 7, updatedAt: "2026-11-16T00:00:00.000Z" },
      ],
      reference,
      visionConfigured,
      imageDisclosure: visionConfigured ? "识图会把截图送到尚未选定的第三方视觉服务处理。" : "披露",
    });
  };
}
