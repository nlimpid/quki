import { Alert, Button } from "@heroui/react";
import { Link, useLocation } from "react-router";

import { safeReturnTo } from "@quki/types";

export function SessionBanner({
  onClose,
  onRecheck,
  showRelogin,
}: {
  onClose: () => void;
  onRecheck: () => void;
  showRelogin: boolean;
}) {
  const location = useLocation();
  const returnTo =
    location.pathname === "/login"
      ? "/"
      : safeReturnTo(`${location.pathname}${location.search}`, window.location.origin);
  return (
    <Alert status="warning" className="auth-banner">
      <Alert.Content>
        <Alert.Description>
          登录已过期。你仍可继续使用访客功能与本地持仓，未保存的本机编辑不会因此丢失。
        </Alert.Description>
      </Alert.Content>
      <div className="auth-banner-actions">
        {showRelogin ? (
          <Link
            className="auth-header-btn"
            to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
            onClick={onRecheck}
          >
            重新登录
          </Link>
        ) : null}
        <Button variant="ghost" onPress={onClose} aria-label="关闭">
          关闭
        </Button>
      </div>
    </Alert>
  );
}
