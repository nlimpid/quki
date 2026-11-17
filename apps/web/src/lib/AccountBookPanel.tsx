import type { useAccountBook } from "./accountBook.js";

type AccountBook = ReturnType<typeof useAccountBook>;

/** Account list, edit, and delete used by the portfolio page. */
export function AccountBookPanel({ book }: { book: AccountBook }) {
  const editor = book.editor;
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
              <span className="mono" id={`code-${item.code}`}>
                {item.code}
              </span>{" "}
              · {item.shares} 股
              <span className="mono" data-version={item.code}>
                {item.version}
              </span>
              <button
                type="button"
                id={`edit-${item.code}`}
                onClick={() =>
                  book.openEditor({
                    code: item.code,
                    shares: String(item.shares),
                    expectedVersion: item.version,
                  })
                }
              >
                编辑
              </button>
              <button
                type="button"
                id={`delete-${item.code}`}
                onClick={() => {
                  void book.removeRow(book.epoch, item.code, item.version);
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : book.items ? (
        <ul id="account-codes" />
      ) : null}
      <button
        type="button"
        id="add-account"
        onClick={() => book.openEditor({ code: "", shares: "", expectedVersion: null })}
      >
        添加账户持仓
      </button>
      {editor ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void book.submitEditor();
          }}
        >
          <input
            aria-label="账户股票代码"
            value={editor.code}
            disabled={editor.expectedVersion != null}
            onChange={(event) => book.setEditorCode(event.target.value)}
          />
          <input
            aria-label="账户股数"
            value={editor.shares}
            onChange={(event) => book.setEditorShares(event.target.value)}
          />
          <button type="submit" id="save-account">
            保存到账户
          </button>
        </form>
      ) : null}
    </section>
  );
}
