import { Link, useLocation } from "react-router";

import { safeReturnTo } from "@quki/types";

export function SessionBanner({
  onClose,
  onRecheck,
}: {
  onClose: () => void;
  onRecheck: () => void;
}) {
  const location = useLocation();
  const returnTo =
    location.pathname === "/login"
      ? "/"
      : safeReturnTo(`${location.pathname}${location.search}`, window.location.origin);
  return (
    <div className="auth-banner" role="status">
      <p>登录已过期。你仍可继续使用访客功能与本地持仓，未保存的本机编辑不会因此丢失。</p>
      <div className="auth-banner-actions">
        <Link
          className="auth-header-btn"
          to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
          onClick={onRecheck}
        >
          重新登录
        </Link>
        <button type="button" className="auth-header-btn" onClick={onClose} aria-label="关闭">
          关闭
        </button>
      </div>
    </div>
  );
}
