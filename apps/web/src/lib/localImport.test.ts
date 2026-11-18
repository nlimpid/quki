import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "../../../../node_modules/.pnpm/happy-dom@21.0.4/node_modules/happy-dom/lib/index.js";
import { describe, expect, it } from "vitest";

import { LocalImportPanel } from "./LocalImportPanel.js";
import { planLocalImport } from "./localImport.js";

function installDom() {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    SVGElement: window.SVGElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
}

function click(id: string) {
  (document.getElementById(id) as HTMLButtonElement).click();
}

describe("local holdings import", () => {
  it("plans creates and versioned updates without sending them", () => {
    expect(
      planLocalImport(
        [
          { code: "600519", shares: 10 },
          { code: "000001", shares: 2 },
          { code: "bad", shares: 1 },
          { code: "600000", shares: 0 },
        ],
        [{ code: "600519", version: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
      ),
    ).toEqual([
      { code: "600519", shares: 10, expectedVersion: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { code: "000001", shares: 2, expectedVersion: null },
    ]);
    expect(planLocalImport([{ code: "600519", shares: 1 }], null)).toBeNull();
  });

  it("sends nothing until confirm, and a second confirm does not send again", async () => {
    installDom();
    const sent: unknown[] = [];
    let release: (() => void) | null = null;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    function Harness() {
      const [epoch, setEpoch] = useState(1);
      return createElement(
        "div",
        null,
        createElement("button", {
          id: "switch-account",
          type: "button",
          onClick: () => setEpoch(2),
        }),
        createElement(LocalImportPanel, {
          rows: [
            { code: "600519", shares: 10 },
            { code: "000001", shares: 1 },
          ],
          accountRows: [{ code: "600519", version: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
          epoch,
          busy: false,
          onImport: async (writes) => {
            sent.push(writes);
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        }),
      );
    }
    await act(async () => {
      root.render(createElement(Harness));
    });
    expect(sent).toEqual([]);
    expect(document.getElementById("confirm-import")).toBeNull();
    await act(async () => {
      click("arm-import");
    });
    expect(sent).toEqual([]);
    await act(async () => {
      click("cancel-import");
    });
    expect(sent).toEqual([]);
    await act(async () => {
      click("arm-import");
    });
    await act(async () => {
      click("confirm-import");
      click("confirm-import");
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      { code: "600519", shares: 10, expectedVersion: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { code: "000001", shares: 1, expectedVersion: null },
    ]);
    await act(async () => {
      click("switch-account");
    });
    expect(document.getElementById("confirm-import")).toBeNull();
    await act(async () => {
      release?.();
    });
    await act(async () => {
      root.unmount();
    });
  });
});
