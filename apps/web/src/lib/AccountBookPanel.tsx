import { Button, Input, Label } from "@heroui/react";
import { useState } from "react";

import type { useAccountBook } from "./accountBook.js";

type AccountBook = ReturnType<typeof useAccountBook>;

/** Account list, edit, and delete used by the portfolio page. */
export function AccountBookPanel({ book }: { book: AccountBook }) {
  const editor = book.editor;
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const [confirmEpoch, setConfirmEpoch] = useState(book.epoch);
  if (confirmEpoch !== book.epoch) {
    setConfirmEpoch(book.epoch);
    setConfirmCode(null);
  }
  return (
    <section className="div-card" aria-label="账户持仓">
      <h2 style={{ margin: "0 0 8px" }}>账户持仓</h2>
      {book.error ? (
        <p id="account-error" className="page-sub">
          {book.error}
        </p>
      ) : null}
      {book.items == null ? <p className="page-sub">正在读取账户持仓…</p> : null}
      {book.items?.length === 0 ? <p className="page-sub">账户里还没有持仓。</p> : null}
      {book.items && book.items.length > 0 ? (
        <ul id="account-codes">
          {book.items.map((item) => (
            <li key={item.code}>
              <span className="mono" id={`code-${item.code}`} data-version={item.version}>
                {item.code}
              </span>{" "}
              · {item.shares} 股
              {confirmCode === item.code ? (
                <>
                  <Button
                    id={`confirm-delete-${item.code}`}
                    variant="danger"
                    size="sm"
                    isDisabled={book.busy}
                    onPress={() => {
                      if (book.busy) return;
                      setConfirmCode(null);
                      void book.removeRow(book.epoch, item.code, item.version);
                    }}
                  >
                    确认删除
                  </Button>
                  <Button
                    id={`cancel-delete-${item.code}`}
                    variant="secondary"
                    size="sm"
                    onPress={() => setConfirmCode(null)}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  id={`delete-${item.code}`}
                  variant="ghost"
                  size="sm"
                  isDisabled={book.busy}
                  onPress={() => {
                    if (book.busy) return;
                    setConfirmCode(item.code);
                  }}
                >
                  删除
                </Button>
              )}
              <Button
                id={`edit-${item.code}`}
                variant="ghost"
                size="sm"
                isDisabled={book.busy}
                onPress={() =>
                  book.openEditor({
                    code: item.code,
                    shares: String(item.shares),
                    expectedVersion: item.version,
                  })
                }
              >
                编辑
              </Button>
            </li>
          ))}
        </ul>
      ) : book.items ? (
        <ul id="account-codes" />
      ) : null}
      <Button
        id="add-account"
        variant="primary"
        size="sm"
        isDisabled={book.busy}
        onPress={() => book.openEditor({ code: "", shares: "", expectedVersion: null })}
      >
        添加账户持仓
      </Button>
      {editor ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (book.busy) return;
            void book.submitEditor();
          }}
        >
          <Label>
            股票代码
            <Input
              aria-label="账户股票代码"
              value={editor.code}
              disabled={editor.expectedVersion != null || book.busy}
              onChange={(event) => book.setEditorCode(event.target.value)}
            />
          </Label>
          <Label>
            股数
            <Input
              aria-label="账户股数"
              inputMode="numeric"
              value={editor.shares}
              disabled={book.busy}
              onChange={(event) => book.setEditorShares(event.target.value)}
            />
          </Label>
          <Button id="save-account" type="submit" variant="primary" isDisabled={book.busy}>
            保存到账户
          </Button>
        </form>
      ) : null}
    </section>
  );
}
