import { Button } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

import { planLocalImport, type LocalImportWrite } from "./localImport.js";

/** Shows browser holdings and sends them only after a second confirmation. */
export function LocalImportPanel({
  rows,
  accountRows,
  epoch,
  busy,
  readFailed = false,
  onImport,
}: {
  rows: readonly { code: string; shares: number }[];
  accountRows: readonly { code: string; version: string }[] | null;
  epoch: number;
  busy: boolean;
  /** The account list failed. Do not describe that as still loading, and do not offer a save. */
  readFailed?: boolean;
  onImport: (writes: readonly LocalImportWrite[]) => Promise<void>;
}) {
  const [armedEpoch, setArmedEpoch] = useState<number | null>(null);
  const [sendingEpoch, setSendingEpoch] = useState<number | null>(null);
  const sendingRef = useRef(false);
  useEffect(() => {
    sendingRef.current = false;
  }, [epoch]);
  if (armedEpoch != null && armedEpoch !== epoch) setArmedEpoch(null);
  if (sendingEpoch != null && sendingEpoch !== epoch) setSendingEpoch(null);
  if (rows.length === 0) return null;
  const plan = planLocalImport(rows, accountRows);
  const armed = armedEpoch === epoch;
  const sending = sendingEpoch === epoch;
  return (
    <section className="div-card" aria-label="保存旧持仓">
      <p className="page-sub">此浏览器里的旧持仓不会自动上传。</p>
      {!readFailed && plan == null ? <p className="page-sub">正在读取账户持仓…</p> : null}
      {!readFailed && plan && plan.length > 0 && !armed ? (
        <Button
          id="arm-import"
          variant="secondary"
          isDisabled={busy || sending}
          onPress={() => setArmedEpoch(epoch)}
        >
          保存到账户
        </Button>
      ) : null}
      {!readFailed && plan && plan.length > 0 && armed ? (
        <>
          <ul id="import-preview">
            {plan.map((row) => (
              <li key={row.code}>
                <span className="mono">{row.code}</span> · {row.shares} 股
              </li>
            ))}
          </ul>
          <p className="page-sub">确认保存到账户。</p>
          <Button
            id="confirm-import"
            variant="primary"
            isDisabled={busy || sending}
            onPress={() => {
              if (sendingRef.current || busy) return;
              sendingRef.current = true;
              setSendingEpoch(epoch);
              void onImport(plan).finally(() => {
                sendingRef.current = false;
                setSendingEpoch((current) => (current === epoch ? null : current));
                setArmedEpoch((current) => (current === epoch ? null : current));
              });
            }}
          >
            确认保存
          </Button>
          <Button
            id="cancel-import"
            variant="secondary"
            isDisabled={sending}
            onPress={() => setArmedEpoch(null)}
          >
            取消
          </Button>
        </>
      ) : null}
    </section>
  );
}
