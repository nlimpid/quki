import { DIVIDEND_DISCLAIMER, safeReturnTo } from "@quki/types";
import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AppHeader } from "../components/AppHeader.js";
import { useAuth } from "../lib/auth.js";
import { loginSlotModel } from "../lib/authState.js";

export function LoginPage() {
  const { phase, retry, retrying } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const slot = loginSlotModel();
  const returnTo = safeReturnTo(params.get("returnTo"), window.location.origin);
  const loginFailed = params.get("error") === "login_failed" && phase.kind === "guest";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (phase.kind === "authenticated") navigate(returnTo, { replace: true });
  }, [navigate, phase.kind, returnTo]);

  const onRetry = () => {
    const next = new URLSearchParams(params);
    next.delete("error");
    setParams(next, { replace: true });
    retry();
  };

  return (
    <div className="auth-app">
      <AppHeader />
      <main className="auth-main">
        <section className="auth-card">
          <Link className="auth-back" to={returnTo}>
            返回
          </Link>
          <h1 ref={headingRef} tabIndex={-1}>
            登录
          </h1>
          <p className="auth-lead">使用账号登录 quki。访客仍可查看行情，并在本机管理持仓。</p>
          {phase.kind === "initializing" ? (
            <p className="auth-status" aria-live="polite">
              正在确认登录状态…
            </p>
          ) : null}
          {phase.kind === "authenticated" ? (
            <p className="auth-status" aria-live="polite">
              已登录，正在返回…
            </p>
          ) : null}
          {phase.kind === "unknown" ? (
            <p className="auth-error" role="alert">
              无法确认登录状态，请重试。
            </p>
          ) : null}
          {loginFailed ? (
            <p className="auth-error" role="alert">
              登录失败，请重试。
            </p>
          ) : null}
          {phase.kind === "unknown" || loginFailed || retrying ? (
            <button
              type="button"
              className="auth-header-btn"
              onClick={onRetry}
              disabled={retrying || phase.kind === "initializing"}
              aria-busy={retrying || phase.kind === "initializing"}
            >
              重试
            </button>
          ) : null}
          {phase.kind === "authenticated" ? null : (
            <div
              className="auth-slot-panel"
              role="region"
              aria-label="登录方式，尚未接入"
              aria-busy={phase.kind === "initializing"}
              aria-disabled="true"
              data-interactive={slot.interactive ? "true" : "false"}
            >
              <h2>登录方式（实现位）</h2>
              <p>
                此区域由工程接入登录机制后填充。本规格不规定邮箱、密码或第三方按钮；在机制确认前，此处不可交互，也不采集凭据。
              </p>
            </div>
          )}
          <p className="auth-note">
            登录不会上传或云同步你的本地持仓。持仓仍仅保存在此浏览器，清除站点数据会丢失。
          </p>
          <div className="auth-note">
            <p className="auth-note-title">关于登录收集的信息</p>
            <p>
              登录时将收集的数据与授权范围，待登录机制确认后再写入此处。不得使用尚未确认的邮箱、手机号或第三方授权说明。
            </p>
          </div>
        </section>
      </main>
      <footer className="auth-foot">
        <strong>免责声明：</strong>
        {DIVIDEND_DISCLAIMER}
      </footer>
    </div>
  );
}
