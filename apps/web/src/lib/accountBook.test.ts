import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "../../../../node_modules/.pnpm/happy-dom@21.0.4/node_modules/happy-dom/lib/index.js";
import { describe, expect, it } from "vitest";

import { useAccountBook } from "./accountBook.js";
import type { AccountHolding } from "./accountHoldings.js";

type ReadWait = {
  token: string | null;
  resolve: (rows: AccountHolding[]) => void;
};

function row(code: string): AccountHolding {
  return { code, shares: 10, updatedAt: "2026-11-17 00:00:00.000", version: "a".repeat(32) };
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

function Probe({
  sessionKey,
  signedIn,
  takeToken,
  reads,
  writes,
}: {
  sessionKey: string;
  signedIn: boolean;
  takeToken: () => Promise<string | null>;
  reads: ReadWait[];
  writes: { token: string; code: string; shares: number }[];
}) {
  const book = useAccountBook({
    sessionKey,
    signedIn,
    accessToken: takeToken,
    read: (bearer) =>
      new Promise((resolve) => {
        reads.push({ token: bearer, resolve });
      }),
  });
  return createElement(
    "div",
    null,
    createElement("div", { id: "codes" }, (book.items ?? []).map((item) => item.code).join(",")),
    createElement(
      "div",
      { id: "drawer" },
      book.drawer ? `${book.drawer.code}:${book.drawer.shares}` : "",
    ),
    createElement(
      "button",
      { type: "button", id: "open", onClick: () => book.openDrawer("600519", 10) },
      "open",
    ),
    createElement(
      "button",
      {
        type: "button",
        id: "save",
        onClick: () => {
          void book.saveDrawer(async (bearer, selection) => {
            writes.push({ token: bearer, code: selection.code, shares: selection.shares });
          });
        },
      },
      "save",
    ),
    createElement(
      "button",
      {
        type: "button",
        id: "remove",
        onClick: () => {
          const ticket = book.drawer?.ticket ?? book.epoch;
          void book.commit(ticket, async (bearer) => {
            writes.push({ token: bearer, code: "delete", shares: 0 });
          });
        },
      },
      "remove",
    ),
  );
}

describe("mounted account switch", () => {
  it("ignores a late previous account after A→B and A→B→A, and does not write that selection with the new token", async () => {
    installDom();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const reads: ReadWait[] = [];
    const writes: { token: string; code: string; shares: number }[] = [];
    const tokens: Array<(value: string | null) => void> = [];
    const takeToken = () =>
      new Promise<string | null>((resolve) => {
        tokens.push(resolve);
      });

    const show = (sessionKey: string) => {
      root.render(
        createElement(Probe, {
          sessionKey,
          signedIn: true,
          takeToken,
          reads,
          writes,
        }),
      );
    };

    await act(async () => {
      show("ready:A");
    });
    expect(tokens).toHaveLength(1);
    await act(async () => {
      tokens[0]?.("token-A");
      await Promise.resolve();
    });
    expect(reads).toHaveLength(1);
    expect(reads[0]?.token).toBe("token-A");
    await act(async () => {
      reads[0]?.resolve([row("000001")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("000001");

    await act(async () => {
      (document.getElementById("open") as HTMLButtonElement).click();
    });
    expect(document.getElementById("drawer")?.textContent).toBe("600519:10");
    await act(async () => {
      (document.getElementById("save") as HTMLButtonElement).click();
    });
    await act(async () => {
      (document.getElementById("remove") as HTMLButtonElement).click();
    });
    expect(tokens.length).toBeGreaterThanOrEqual(3);

    await act(async () => {
      show("ready:B");
    });
    expect(document.getElementById("codes")?.textContent).toBe("");
    expect(document.getElementById("drawer")?.textContent).toBe("");

    await act(async () => {
      tokens[1]?.("token-B");
      tokens[2]?.("token-B");
      reads[0]?.resolve([row("999999")]);
      await Promise.resolve();
    });
    expect(writes).toEqual([]);
    expect(document.getElementById("codes")?.textContent).toBe("");

    expect(tokens).toHaveLength(4);
    await act(async () => {
      tokens[3]?.("token-B");
      await Promise.resolve();
    });
    expect(reads).toHaveLength(2);
    expect(reads[1]?.token).toBe("token-B");
    await act(async () => {
      reads[1]?.resolve([row("600519")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("600519");

    await act(async () => {
      show("ready:A");
    });
    expect(document.getElementById("codes")?.textContent).toBe("");
    await act(async () => {
      reads[1]?.resolve([row("000002")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("");

    expect(tokens).toHaveLength(5);
    await act(async () => {
      tokens[4]?.("token-A");
      await Promise.resolve();
    });
    const latest = reads.at(-1);
    expect(latest?.token).toBe("token-A");
    await act(async () => {
      latest?.resolve([row("000001")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("000001");
    expect(writes).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });
});
