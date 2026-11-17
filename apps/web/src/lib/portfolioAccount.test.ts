import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "../../../../node_modules/.pnpm/happy-dom@21.0.4/node_modules/happy-dom/lib/index.js";
import { describe, expect, it } from "vitest";

import { AccountBookPanel } from "./AccountBookPanel.js";
import { useAccountBook } from "./accountBook.js";
import { AccountHoldingsError, type AccountHolding } from "./accountHoldings.js";

type ReadWait = {
  token: string | null;
  resolve: (rows: AccountHolding[]) => void;
};

function row(code: string, shares: number, version: string): AccountHolding {
  return { code, shares, updatedAt: "2026-11-17 00:00:00.000", version };
}

function installDom() {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
}

function click(id: string) {
  (document.getElementById(id) as HTMLButtonElement).click();
}

function setInput(label: string, value: string) {
  const input = document.querySelector(`[aria-label='${label}']`) as HTMLInputElement &
    Record<string, { onChange?: (event: { target: HTMLInputElement }) => void }>;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps"));
  input[propsKey ?? ""]?.onChange?.({ target: input });
}

function PortfolioHarness({
  sessionKey,
  takeToken,
  reads,
  writes,
  deletes,
}: {
  sessionKey: string;
  takeToken: () => Promise<string | null>;
  reads: ReadWait[];
  writes: { token: string; code: string; shares: number; expectedVersion: string | null }[];
  deletes: { token: string; code: string; expectedVersion: string }[];
}) {
  const book = useAccountBook({
    sessionKey,
    signedIn: true,
    accessToken: takeToken,
    read: (token) =>
      new Promise((resolve) => {
        reads.push({ token, resolve });
      }),
    write: async (item, token) => {
      if (!token) throw new AccountHoldingsError("需要登录", 401);
      writes.push({ token, ...item });
      if (item.expectedVersion === "stale-version") {
        throw new AccountHoldingsError("持仓已变化，请重新读取后再保存。", 409);
      }
      return row(item.code, item.shares, item.expectedVersion ? "version-2" : "version-1");
    },
    remove: async (code, expectedVersion, token) => {
      if (!token) throw new AccountHoldingsError("需要登录", 401);
      deletes.push({ token, code, expectedVersion });
      if (expectedVersion === "stale-version") {
        throw new AccountHoldingsError("持仓已变化，请重新读取后再保存。", 409);
      }
    },
  });
  return createElement(AccountBookPanel, { book });
}

function mount() {
  installDom();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const reads: ReadWait[] = [];
  const writes: { token: string; code: string; shares: number; expectedVersion: string | null }[] =
    [];
  const deletes: { token: string; code: string; expectedVersion: string }[] = [];
  const tokens: Array<(value: string | null) => void> = [];
  const takeToken = () =>
    new Promise<string | null>((resolve) => {
      tokens.push(resolve);
    });
  const show = (sessionKey: string) => {
    root.render(createElement(PortfolioHarness, { sessionKey, takeToken, reads, writes, deletes }));
  };
  return { root, reads, writes, deletes, tokens, show };
}

async function release(
  tokens: Array<(value: string | null) => void>,
  index: number,
  value: string,
) {
  const done = tokens[index];
  if (!done) throw new Error(`missing token ${index}`);
  await act(async () => {
    done(value);
    await Promise.resolve();
  });
}

describe("portfolio account panel", () => {
  it("refreshes the list after add, sends the row version on edit, and deletes that version", async () => {
    const { root, reads, writes, deletes, tokens, show } = mount();
    await act(async () => {
      show("ready:A");
    });
    await release(tokens, 0, "token-A");
    await act(async () => {
      reads[0]?.resolve([]);
      await Promise.resolve();
    });

    await act(async () => {
      click("add-account");
    });
    await act(async () => {
      setInput("账户股票代码", "600519");
      setInput("账户股数", "10");
    });
    await act(async () => {
      click("save-account");
    });
    await release(tokens, 1, "token-A");
    expect(writes).toEqual([
      { token: "token-A", code: "600519", shares: 10, expectedVersion: null },
    ]);
    expect(document.getElementById("code-600519")?.textContent).toBe("600519");
    expect(document.querySelector("[data-version='600519']")?.textContent).toBe("version-1");

    await act(async () => {
      click("edit-600519");
    });
    await act(async () => {
      setInput("账户股数", "12");
    });
    await act(async () => {
      click("save-account");
    });
    await release(tokens, 2, "token-A");
    expect(writes[1]).toEqual({
      token: "token-A",
      code: "600519",
      shares: 12,
      expectedVersion: "version-1",
    });
    expect(document.querySelector("[data-version='600519']")?.textContent).toBe("version-2");

    await act(async () => {
      click("delete-600519");
    });
    await release(tokens, 3, "token-A");
    expect(deletes).toEqual([{ token: "token-A", code: "600519", expectedVersion: "version-2" }]);
    expect(document.getElementById("code-600519")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the visible row when the server returns 409", async () => {
    const { root, reads, writes, tokens, show } = mount();
    await act(async () => {
      show("ready:A");
    });
    await release(tokens, 0, "token-A");
    await act(async () => {
      reads[0]?.resolve([row("600519", 10, "stale-version")]);
      await Promise.resolve();
    });
    await act(async () => {
      click("edit-600519");
    });
    await act(async () => {
      setInput("账户股数", "99");
    });
    await act(async () => {
      click("save-account");
    });
    await release(tokens, 1, "token-A");
    expect(writes[0]?.expectedVersion).toBe("stale-version");
    expect(document.getElementById("code-600519")?.textContent).toBe("600519");
    expect(document.querySelector("[data-version='600519']")?.textContent).toBe("stale-version");
    expect(document.getElementById("account-error")?.textContent).toContain("持仓已变化");
    await act(async () => {
      root.unmount();
    });
  });

  it("does not apply an A save or clear B after the session switches while the token is pending", async () => {
    const { root, reads, writes, tokens, show } = mount();
    await act(async () => {
      show("ready:A");
    });
    await release(tokens, 0, "token-A");
    await act(async () => {
      reads[0]?.resolve([row("000001", 1, "version-a")]);
      await Promise.resolve();
    });
    await act(async () => {
      click("edit-000001");
    });
    await act(async () => {
      click("save-account");
    });
    const saveToken = tokens[1];
    if (!saveToken) throw new Error("save did not wait for a token");

    await act(async () => {
      show("ready:B");
    });
    await release(tokens, 2, "token-B");
    await act(async () => {
      reads[1]?.resolve([row("600519", 8, "version-b")]);
      await Promise.resolve();
    });
    expect(document.getElementById("code-600519")?.textContent).toBe("600519");

    await act(async () => {
      saveToken("token-B");
      await Promise.resolve();
    });
    expect(writes).toEqual([]);
    expect(document.getElementById("code-600519")?.textContent).toBe("600519");
    expect(document.querySelector("[data-version='600519']")?.textContent).toBe("version-b");

    await act(async () => {
      root.unmount();
    });
  });
});
