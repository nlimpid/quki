import { accountLabel } from "@quki/types";
import { useEffect, useId, useRef, useState } from "react";

export function AccountMenu({
  displayName,
  pending,
  failed,
  onLogout,
}: {
  displayName: string | null;
  pending: boolean;
  failed: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const logoutRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    logoutRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (failed && open) errorRef.current?.focus();
  }, [failed, open]);

  return (
    <div className="auth-menu-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="auth-header-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        账户
      </button>
      {open ? (
        <div className="auth-menu" id={menuId} role="menu" aria-label="账户">
          <div className="auth-menu-name">{accountLabel(displayName)}</div>
          {failed ? (
            <p ref={errorRef} className="auth-error" role="alert" tabIndex={-1}>
              退出失败，请重试。
            </p>
          ) : null}
          <button
            ref={logoutRef}
            type="button"
            role="menuitem"
            className="auth-menu-item"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              if (!pending) onLogout();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                logoutRef.current?.focus();
              }
            }}
          >
            {pending ? "正在退出…" : "退出"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
