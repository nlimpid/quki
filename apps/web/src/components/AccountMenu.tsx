import { accountLabel } from "@quki/types";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { panelTabLeaves } from "../lib/authState.js";

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
  const panelId = useId();

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

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = event.currentTarget;
    const items = [...panel.querySelectorAll<HTMLElement>("button, a[href]")].filter(
      (item) => !item.hasAttribute("disabled"),
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!panelTabLeaves(event.shiftKey, index, items.length)) return;
    setOpen(false);
  };

  return (
    <div className="auth-menu-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="auth-header-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        账户
      </button>
      {open ? (
        <div className="auth-menu" id={panelId} aria-label="账户" onKeyDown={onPanelKeyDown}>
          <div className="auth-menu-name">{accountLabel(displayName)}</div>
          {failed ? (
            <p ref={errorRef} className="auth-error" role="alert" tabIndex={-1}>
              退出失败，请重试。
            </p>
          ) : null}
          <button
            ref={logoutRef}
            type="button"
            className="auth-menu-item"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              if (!pending) onLogout();
            }}
          >
            {pending ? "正在退出…" : "退出"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
