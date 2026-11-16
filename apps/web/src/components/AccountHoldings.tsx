import {
  IMAGE_PROCESS_CONSENT,
  IMAGE_PROCESS_DISCLOSURE,
  confirmImportRows,
  dividendReferenceNote,
  localImportPlan,
  reviewVisionRows,
  validShareCount,
  visionFlagLabel,
  type ReviewedVisionRow,
  type VisionRow,
} from "@quki/analytics";
import { useEffect, useRef, useState } from "react";

import {
  accountDraftOwnedBy,
  readAccountUiDraft,
  saveAccountUiDraft,
  type AccountUiDraft,
  type ScreenshotEdit,
} from "../lib/accountDraft.js";
import {
  fetchAccountHoldings,
  HoldingsRequestError,
  writeAccountHoldings,
  type AccountHoldingsResponse,
} from "../lib/holdingsAccount.js";
import type { AuthPhase } from "../lib/authState.js";
import { portfolioSubtitle } from "../lib/authState.js";
import { readLocalHoldingsForImport } from "../lib/holdingsStore.js";
import { formatShares } from "../lib/stockFormat.js";

type PreviewResponse = {
  draftId: string;
  sourceRows: VisionRow[];
  catalog: { code: string; name: string }[];
};

function editsFor(rows: readonly ReviewedVisionRow[]): ScreenshotEdit[] {
  return rows.map((row) => ({
    include:
      row.code != null &&
      row.totalShares != null &&
      !row.flags.includes("duplicate_code") &&
      !row.flags.includes("ambiguous_shares") &&
      !row.flags.includes("name_mismatch") &&
      !row.flags.includes("unknown_code") &&
      !row.flags.includes("bad_code"),
    shares: row.totalShares == null ? "" : String(row.totalShares),
    nameConfirmed: false,
    unknownConfirmed: false,
    sharesConfirmed: false,
  }));
}

export function AccountHoldings({
  phase,
  userId,
  fetchImpl = fetch,
}: {
  phase: AuthPhase;
  userId: string;
  fetchImpl?: typeof fetch;
}) {
  const restored = readAccountUiDraft(userId);
  const csrfToken = "csrfToken" in phase ? phase.csrfToken : "";
  const locked = phase.kind === "logoutPending" || csrfToken.length === 0;
  const [loaded, setLoaded] = useState<AccountHoldingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(restored?.code ?? "");
  const [shares, setShares] = useState(restored?.shares ?? "");
  const [replacePrompt, setReplacePrompt] = useState(restored?.replacePrompt ?? null);
  const [localChanges, setLocalChanges] = useState(restored?.localChanges ?? null);
  const [preserved, setPreserved] = useState(restored?.preserved ?? []);
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [screenshot, setScreenshot] = useState(restored?.screenshot ?? null);
  const [previewRestored, setPreviewRestored] = useState(restored?.screenshot != null);
  const [explicit, setExplicit] = useState(false);
  const [operationToken, setOperationToken] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [boundUser, setBoundUser] = useState(userId);
  if (boundUser !== userId) {
    const next = readAccountUiDraft(userId);
    setBoundUser(userId);
    setConsent(false);
    setExplicit(false);
    setFile(null);
    setOperationToken("");
    setLoaded(null);
    setError(null);
    setPendingDelete(null);
    setReplacePrompt(null);
    setCode(next?.code ?? "");
    setShares(next?.shares ?? "");
    setLocalChanges(next?.localChanges ?? null);
    setPreserved(next?.preserved ?? []);
    setScreenshot(next?.screenshot ?? null);
    setPreviewRestored(next?.screenshot != null);
  }
  const snapshot = useRef<AccountUiDraft | null>(null);
  const epoch = useRef(0);
  const ownerRef = useRef(userId);
  useEffect(() => {
    ownerRef.current = userId;
  });

  function stillCurrent(token: { epoch: number; userId: string }): boolean {
    return token.epoch === epoch.current && token.userId === ownerRef.current;
  }

  useEffect(() => {
    const owner = userId;
    const token = { epoch: epoch.current, userId: owner };
    fetchAccountHoldings(fetchImpl)
      .then((body) => {
        if (token.epoch !== epoch.current || token.userId !== ownerRef.current) return;
        setLoaded(body);
        if (body.operationToken) setOperationToken(body.operationToken);
      })
      .catch(() => {
        if (token.epoch !== epoch.current || token.userId !== ownerRef.current) return;
        setError("账户持仓暂不可用。本机持仓未改动。");
      });
    return () => {
      epoch.current += 1;
      const snap = snapshot.current;
      if (snap && snap.userId === owner && accountDraftOwnedBy(snap, owner)) {
        saveAccountUiDraft(snap);
      }
    };
  }, [fetchImpl, userId]);

  const items = loaded?.items ?? [];
  const visionConfigured = loaded?.visionConfigured === true;
  const reviewed = screenshot
    ? reviewVisionRows(
        screenshot.sourceRows,
        new Map(screenshot.catalog.map((row) => [row.code, row.name])),
      )
    : [];
  const catalog = new Map(screenshot?.catalog.map((row) => [row.code, row.name]) ?? []);
  const submitted = screenshot
    ? reviewed.flatMap((row, index) => {
        const edit = screenshot.edits[index];
        if (!edit?.include || row.code == null) return [];
        const count = validShareCount(edit.shares);
        if (count == null) return [];
        return [
          {
            code: row.code,
            shares: count,
            nameConfirmed: edit.nameConfirmed,
            unknownConfirmed: edit.unknownConfirmed,
            sharesConfirmed: edit.sharesConfirmed,
          },
        ];
      })
    : [];
  const decision = screenshot ? confirmImportRows(reviewed, submitted, catalog) : null;
  const canWriteScreenshot = visionConfigured && consent && !locked;
  const shareChanges = submitted.map((row) => {
    const previous = items.find((item) => item.code === row.code);
    return { code: row.code, previous: previous?.shares ?? null, next: row.shares };
  });

  useEffect(() => {
    snapshot.current = {
      userId,
      code,
      shares,
      replacePrompt,
      localChanges,
      preserved,
      screenshot: screenshot ? { ...screenshot, explicit } : null,
    };
  });

  async function refreshOperationToken(token: { epoch: number; userId: string }) {
    try {
      const fresh = await fetchAccountHoldings(fetchImpl);
      if (!stillCurrent(token) || !fresh.operationToken) return;
      setOperationToken(fresh.operationToken);
    } catch {
      // A rejected save does not reload the book.
    }
  }

  async function save(next: { code: string; shares: number }[], confirmEmpty = false) {
    const token = { epoch: epoch.current, userId: ownerRef.current };
    if (!stillCurrent(token) || operationToken.length === 0) return;
    setError(null);
    try {
      const body = await writeAccountHoldings(
        {
          path: "/api/holdings",
          csrfToken,
          idempotencyKey: operationToken,
          items: next,
          confirmEmpty,
        },
        fetchImpl,
      );
      if (!stillCurrent(token)) return;
      setLoaded(body);
      if (body.operationToken) setOperationToken(body.operationToken);
      setReplacePrompt(null);
      setCode("");
      setShares("");
    } catch (caught) {
      if (!stillCurrent(token)) return;
      if (caught instanceof HoldingsRequestError && caught.status === 409) {
        await refreshOperationToken(token);
      }
      if (!stillCurrent(token)) return;
      setError("没有写入账户。本机持仓未改动。");
    }
  }

  function onImportLocal() {
    const local = readLocalHoldingsForImport();
    const plan = localImportPlan(local.items, items);
    setLocalChanges(plan.changes);
    setPreserved(plan.preserved);
  }

  function updateEdit(index: number, patch: Partial<ScreenshotEdit>) {
    setScreenshot((current) => {
      if (!current) return current;
      const edits = current.edits.map((edit, editIndex) =>
        editIndex === index ? { ...edit, ...patch } : edit,
      );
      return { ...current, edits };
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">账户持仓</h1>
          <p className="page-sub">{portfolioSubtitle(phase)}</p>
        </div>
      </div>
      {error ? <p className="yield-note">{error}</p> : null}
      {loaded?.reference ? (
        <p className="yield-note">
          {dividendReferenceNote(loaded.reference)}
          {loaded.reference.totalCashCny == null
            ? " 暂无合计。"
            : ` 参考合计 ${loaded.reference.totalCashCny} 元。`}
        </p>
      ) : null}
      {items.length === 0 ? <p className="page-sub">账户里还没有股数。</p> : null}
      <div className="hold-grid">
        {items.map((item) => (
          <article key={item.code} className="div-card hold-card">
            <div className="mono">{item.code}</div>
            <div>持股 {formatShares(item.shares)} 股</div>
            <button
              type="button"
              className="text-btn"
              disabled={locked}
              onClick={() => {
                if (pendingDelete !== item.code) {
                  setPendingDelete(item.code);
                  return;
                }
                const next = items
                  .filter((row) => row.code !== item.code)
                  .map((row) => ({ code: row.code, shares: row.shares }));
                setPendingDelete(null);
                void save(next, next.length === 0);
              }}
            >
              {pendingDelete === item.code
                ? `确认从账户移除 ${formatShares(item.shares)} 股`
                : "从账户移除"}
            </button>
          </article>
        ))}
      </div>
      <form
        className="div-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d{6}$/.test(code) || validShareCount(shares) == null) {
            setError("代码需为 6 位数字，股数需为不含前导零的正整数。");
            return;
          }
          const nextShares = validShareCount(shares);
          if (nextShares == null) return;
          const previous = items.find((row) => row.code === code);
          if (previous && previous.shares === nextShares) {
            setError(`账户里 ${code} 已经是 ${formatShares(previous.shares)} 股。`);
            return;
          }
          if (previous) {
            setReplacePrompt({ code, previousShares: previous.shares, nextShares });
            return;
          }
          const next = [
            ...items
              .filter((row) => row.code !== code)
              .map((row) => ({ code: row.code, shares: row.shares })),
            { code, shares: nextShares },
          ];
          void save(next);
        }}
      >
        <label>
          股票代码
          <input
            aria-label="股票代码"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <label>
          总股数
          <input
            aria-label="总股数"
            value={shares}
            onChange={(event) => setShares(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button type="submit" className="btn primary" disabled={locked}>
          保存到账户
        </button>
        {replacePrompt ? (
          <div>
            <p>
              账户里 {replacePrompt.code} 当前是 {formatShares(replacePrompt.previousShares)}{" "}
              股，将改为 {formatShares(replacePrompt.nextShares)} 股。这不会与原股数相加。
            </p>
            <button
              type="button"
              className="btn primary"
              disabled={locked}
              onClick={() => {
                const next = [
                  ...items
                    .filter((row) => row.code !== replacePrompt.code)
                    .map((row) => ({ code: row.code, shares: row.shares })),
                  { code: replacePrompt.code, shares: replacePrompt.nextShares },
                ];
                void save(next);
              }}
            >
              确认替换股数
            </button>
          </div>
        ) : null}
      </form>
      <section className="div-card">
        <h2>导入本机持仓</h2>
        <p className="page-sub">
          这不会自动发生。确认后按本机股数设置账户中的相同代码，不会把两边相加，也不会清除本机记录。
          账户里有、本机清单里没有的代码会保留，除非你另行确认删除。
        </p>
        <button type="button" className="btn" disabled={locked} onClick={onImportLocal}>
          查看本机持仓
        </button>
        {localChanges ? (
          <>
            {localChanges.length === 0 ? <p>本机没有可导入的持仓。</p> : null}
            {localChanges.map((row) => (
              <p key={row.code} className="mono">
                {row.code} 设为 {row.shares} 股
                {row.previousShares == null ? "" : `（账户当前 ${row.previousShares}，不会相加）`}
              </p>
            ))}
            <p>
              {preserved.length === 0
                ? "这次导入没有要保留的账户独有代码。"
                : `这些账户代码不在本机清单中，会保留：${preserved
                    .map((row) => `${row.code} ${row.shares} 股`)
                    .join("、")}。`}
            </p>
            <button
              type="button"
              className="btn primary"
              disabled={locked || localChanges.length === 0}
              onClick={() => {
                const token = { epoch: epoch.current, userId: ownerRef.current };
                if (!stillCurrent(token) || operationToken.length === 0) return;
                void writeAccountHoldings(
                  {
                    path: "/api/holdings/import",
                    csrfToken,
                    idempotencyKey: operationToken,
                    items: localChanges.map((row) => ({ code: row.code, shares: row.shares })),
                  },
                  fetchImpl,
                )
                  .then((body) => {
                    if (!stillCurrent(token)) return;
                    setLoaded(body);
                    if (body.operationToken) setOperationToken(body.operationToken);
                    setLocalChanges(null);
                    setPreserved([]);
                  })
                  .catch((caught: unknown) => {
                    if (!stillCurrent(token)) return;
                    if (caught instanceof HoldingsRequestError && caught.status === 409) {
                      void refreshOperationToken(token);
                    }
                    setError("没有导入。本机持仓未改动。");
                  });
              }}
            >
              确认导入到账户
            </button>
          </>
        ) : null}
      </section>
      <section className="div-card">
        <h2>截图识图</h2>
        <p>{loaded?.imageDisclosure ?? IMAGE_PROCESS_DISCLOSURE}</p>
        {visionConfigured ? (
          <>
            <label>
              <input
                type="checkbox"
                aria-label="同意把截图交给视觉服务"
                checked={consent}
                onChange={(event) => {
                  setConsent(event.target.checked);
                  if (!event.target.checked) setExplicit(false);
                }}
              />{" "}
              我同意把这张截图交给已配置的视觉服务。本站不保存原图。
            </label>
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="选择截图"
              disabled={!consent || locked}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn"
              disabled={!consent || locked}
              onClick={(event) => {
                const chosen =
                  file ??
                  (
                    event.currentTarget.parentElement?.querySelector(
                      "input[type=file]",
                    ) as HTMLInputElement | null
                  )?.files?.[0] ??
                  null;
                if (!visionConfigured || !consent || !chosen) return;
                const token = { epoch: epoch.current, userId: ownerRef.current };
                void previewImage(chosen, fetchImpl, csrfToken).then(
                  (body) => {
                    if (!stillCurrent(token)) return;
                    const rows = reviewVisionRows(
                      body.sourceRows,
                      new Map(body.catalog.map((row) => [row.code, row.name])),
                    );
                    setExplicit(false);
                    setPreviewRestored(false);
                    setScreenshot({
                      draftId: body.draftId,
                      sourceRows: body.sourceRows,
                      catalog: body.catalog,
                      edits: editsFor(rows),
                      explicit: false,
                    });
                  },
                  () => {
                    if (!stillCurrent(token)) return;
                    setError("没有生成预览。图片未保存，账户持仓未改动。");
                  },
                );
              }}
            >
              生成待核对预览
            </button>
          </>
        ) : (
          <>
            <p className="page-sub">识图服务尚未选择，图片不会上传。</p>
            <label>
              <input type="checkbox" disabled /> 我同意在服务配置后把截图交给第三方处理
            </label>
            <input type="file" accept="image/png,image/jpeg" disabled aria-label="选择截图" />
          </>
        )}
        {screenshot && reviewed.length > 0 ? (
          <div>
            <p>
              代码和名称不能在这里修改。识别错了、对不上或无法确定的代码，请取消纳入，再用上面的表单手工输入
              6 位代码和总股数。
            </p>
            <p>识别文字只作核对，不会执行。可用股数不会写入。同一代码不会自动相加。</p>
            {previewRestored ? (
              <p>这是恢复的预览。上次的同意和确认不会沿用，需要重新核对后才会写入。</p>
            ) : null}
            {reviewed.map((row, index) => {
              const source = screenshot.sourceRows[index];
              const edit = screenshot.edits[index];
              if (!edit) return null;
              return (
                <article key={`${row.code ?? "row"}-${index}`} className="div-card">
                  <p className="mono">
                    {row.code ?? "无代码"} {row.name ?? ""}
                  </p>
                  <p>
                    原文总股数 {source?.totalShares ?? "—"}，可用股数{" "}
                    {source?.availableShares ?? "—"}。
                  </p>
                  <ul>
                    {row.flags.map((flag) => (
                      <li key={flag}>{visionFlagLabel(flag)}</li>
                    ))}
                  </ul>
                  {row.code == null ? (
                    <p>这行代码不能使用。请不要纳入，改在上方表单手工输入。</p>
                  ) : null}
                  {row.flags.includes("name_mismatch") ||
                  row.flags.includes("unknown_code") ||
                  row.flags.includes("ambiguous_shares") ||
                  row.flags.includes("duplicate_code") ? (
                    <p>这行还不能直接当作已核对的代码。确认名称和代码无误后再纳入，否则请排除并用手工输入。</p>
                  ) : null}
                  {row.code != null && canWriteScreenshot ? (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`纳入 ${row.code}`}
                          checked={edit.include}
                          onChange={(event) => updateEdit(index, { include: event.target.checked })}
                        />{" "}
                        纳入确认
                      </label>
                      <label>
                        总股数
                        <input
                          aria-label={`${row.code} 总股数`}
                          value={edit.shares}
                          onChange={(event) => updateEdit(index, { shares: event.target.value })}
                        />
                      </label>
                      {row.flags.includes("name_mismatch") ? (
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`核对名称 ${row.code}`}
                            checked={edit.nameConfirmed}
                            onChange={(event) =>
                              updateEdit(index, { nameConfirmed: event.target.checked })
                            }
                          />{" "}
                          我核对过名称
                        </label>
                      ) : null}
                      {row.flags.includes("unknown_code") ? (
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`确认未知代码 ${row.code}`}
                            checked={edit.unknownConfirmed}
                            onChange={(event) =>
                              updateEdit(index, { unknownConfirmed: event.target.checked })
                            }
                          />{" "}
                          我确认代码表没有这只代码
                        </label>
                      ) : null}
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`确认股数 ${row.code}`}
                          checked={edit.sharesConfirmed}
                          onChange={(event) =>
                            updateEdit(index, { sharesConfirmed: event.target.checked })
                          }
                        />{" "}
                        我确认这个总股数
                      </label>
                    </>
                  ) : row.code != null ? (
                    <p>
                      总股数 {edit.shares || "未填"}。当前不能修改或写入。
                    </p>
                  ) : null}
                </article>
              );
            })}
            {canWriteScreenshot ? (
              <>
                {shareChanges.map((row) => (
                  <p key={row.code}>
                    {row.previous == null
                      ? `账户里还没有 ${row.code}，将设为 ${formatShares(row.next)} 股。`
                      : `账户当前 ${row.code} ${formatShares(row.previous)} 股 → ${formatShares(row.next)} 股。不会与原股数相加。`}
                  </p>
                ))}
                <label>
                  <input
                    type="checkbox"
                    aria-label="确认用总股数设置账户"
                    checked={explicit}
                    onChange={(event) => setExplicit(event.target.checked)}
                  />{" "}
                  我确认用这些总股数设置账户持仓。相同代码不会相加。未列入的账户代码会保留。这不会修改本机持仓。
                </label>
                {explicit && decision && !decision.ok ? <p>还有待核对的识别结果。</p> : null}
                <button
                  type="button"
                  className="btn primary"
                  disabled={!explicit || !decision?.ok || submitted.length === 0}
                  onClick={() => {
                    if (!canWriteScreenshot || !screenshot || !decision?.ok || !consent || operationToken.length === 0) {
                      return;
                    }
                    const token = { epoch: epoch.current, userId: ownerRef.current };
                    if (!stillCurrent(token)) return;
                    void fetchImpl("/api/holdings/apply", {
                      method: "POST",
                      credentials: "same-origin",
                      headers: {
                        accept: "application/json",
                        "content-type": "application/json",
                        "x-csrf-token": csrfToken,
                      },
                      body: JSON.stringify({
                        csrf: csrfToken,
                        draftId: screenshot.draftId,
                        idempotencyKey: operationToken,
                        rows: submitted,
                      }),
                    })
                      .then(async (response) => {
                        if (!stillCurrent(token)) return;
                        if (!response.ok) {
                          if (response.status === 409) await refreshOperationToken(token);
                          throw new Error("apply_failed");
                        }
                        setScreenshot(null);
                        setExplicit(false);
                        setConsent(false);
                        const fresh = await fetchAccountHoldings(fetchImpl);
                        if (!stillCurrent(token)) return;
                        if (fresh.operationToken) setOperationToken(fresh.operationToken);
                        setLoaded(fresh);
                      })
                      .catch(() => {
                        if (!stillCurrent(token)) return;
                        setError("没有写入识别结果。本机持仓未改动。");
                      });
                  }}
                >
                  确认写入识别结果
                </button>
              </>
            ) : (
              <p>需要重新勾选同意，并在识图可用时再次确认后才会写入。上次的确认不会沿用。当前不能从这里写入。</p>
            )}
          </div>
        ) : null}
      </section>
    </>
  );
}

async function previewImage(
  file: File,
  fetchImpl: typeof fetch,
  csrfToken: string,
): Promise<PreviewResponse> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const response = await fetchImpl("/api/holdings/preview", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({
      csrf: csrfToken,
      consent: IMAGE_PROCESS_CONSENT,
      mediaType: file.type,
      imageBase64: btoa(binary),
    }),
  });
  if (!response.ok) throw new Error("preview_failed");
  return (await response.json()) as PreviewResponse;
}
