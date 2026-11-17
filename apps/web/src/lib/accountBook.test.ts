import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "../../../../node_modules/.pnpm/happy-dom@21.0.4/node_modules/happy-dom/lib/index.js";
import { describe, expect, it } from "vitest";

import { useAccountBook } from "./accountBook.js";
import type { AccountHolding } from "./accountHoldings.js";

type ReadWait = {
  token: string | null;
  settled: boolean;
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

function once(wait: ReadWait | undefined, rows: AccountHolding[]) {
  if (!wait || wait.settled) throw new Error("read is not a fresh pending request");
  wait.settled = true;
  wait.resolve(rows);
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
        reads.push({ token: bearer, settled: false, resolve });
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

function mount() {
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
  return { root, reads, writes, tokens, show };
}

async function releaseToken(
  tokens: Array<(value: string | null) => void>,
  index: number,
  value: string,
) {
  const release = tokens[index];
  if (!release) throw new Error(`missing token waiter ${index}`);
  await act(async () => {
    release(value);
    await Promise.resolve();
  });
}

describe("mounted account switch", () => {
  it("keeps an unresolved A read from rendering after the session becomes B", async () => {
    const { root, reads, tokens, show } = mount();
    await act(async () => {
      show("ready:A");
    });
    await releaseToken(tokens, 0, "token-A");
    const readA = reads[0];
    expect(readA?.settled).toBe(false);
    expect(readA?.token).toBe("token-A");

    await act(async () => {
      show("ready:B");
    });
    expect(document.getElementById("codes")?.textContent).toBe("");
    expect(readA?.settled).toBe(false);

    await act(async () => {
      once(readA, [row("000001")]);
      await Promise.resolve();
    });
    expect(readA?.settled).toBe(true);
    expect(document.getElementById("codes")?.textContent).toBe("");

    await releaseToken(tokens, 1, "token-B");
    const readB = reads[1];
    expect(readB?.settled).toBe(false);
    expect(readB?.token).toBe("token-B");
    await act(async () => {
      once(readB, [row("600519")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("600519");

    await act(async () => {
      root.unmount();
    });
  });

  it("drops the original unresolved A read and the unresolved B read after A→B→A", async () => {
    const { root, reads, tokens, show } = mount();
    await act(async () => {
      show("ready:A");
    });
    await releaseToken(tokens, 0, "token-A");
    const readA1 = reads[0];
    expect(readA1?.settled).toBe(false);

    await act(async () => {
      show("ready:B");
    });
    await releaseToken(tokens, 1, "token-B");
    const readB = reads[1];
    expect(readB?.settled).toBe(false);
    expect(readA1?.settled).toBe(false);

    await act(async () => {
      show("ready:A");
    });
    expect(document.getElementById("codes")?.textContent).toBe("");
    await releaseToken(tokens, 2, "token-A");
    const readA2 = reads[2];
    expect(readA2?.settled).toBe(false);
    expect(readA2?.token).toBe("token-A");
    expect(readA1?.settled).toBe(false);
    expect(readB?.settled).toBe(false);

    await act(async () => {
      once(readA1, [row("999999")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("");

    await act(async () => {
      once(readB, [row("000002")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("");

    await act(async () => {
      once(readA2, [row("000001")]);
      await Promise.resolve();
    });
    expect(document.getElementById("codes")?.textContent).toBe("000001");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not write or delete an A selection after the pending token resolves as B", async () => {
    const { root, reads, writes, tokens, show } = mount();
    await act(async () => {
      show("ready:A");
    });
    await releaseToken(tokens, 0, "token-A");
    await act(async () => {
      once(reads[0], [row("000001")]);
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
    const saveToken = tokens[1];
    const removeToken = tokens[2];
    if (!saveToken || !removeToken) throw new Error("save and delete did not wait for a token");

    await act(async () => {
      show("ready:B");
    });
    expect(document.getElementById("codes")?.textContent).toBe("");
    expect(document.getElementById("drawer")?.textContent).toBe("");

    await act(async () => {
      saveToken("token-B");
      removeToken("token-B");
      await Promise.resolve();
    });
    expect(writes).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });
});
