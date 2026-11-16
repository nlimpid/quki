import { DIVIDEND_DISCLAIMER, safeReturnTo } from "@quki/types";
import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AppHeader } from "../components/AppHeader.js";
import { useAuth } from "../lib/auth.js";
import { GOOGLE_LOGIN_BUTTON, LOGIN_PRIVACY_COPY, loginView, type LoginFailure } from "../lib/authState.js";

export function LoginPage() {
  const { phase, retry, retrying } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnTo = safeReturnTo(params.get("returnTo"), window.location.origin);
  const error = params.get("error");
  const failure: LoginFailure =
    error === "provider_rejected" || error === "provider_unreachable" || error === "login_failed"
      ? error
      : "none";
  const view = loginView(phase, failure);
  const csrfToken = phase.kind === "guest" ? phase.csrfToken : null;
  const busy = retrying || phase.kind === "initializing";

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
          {view.message ? <p className="auth-lead">{view.message}</p> : null}
          {view.status ? (
            <p className="auth-status" aria-live="polite">
              {view.status}
            </p>
          ) : null}
          {view.alert ? (
            <p className="auth-error" role="alert">
              {view.alert}
            </p>
          ) : null}
          {view.google && csrfToken ? (
            <form method="post" action="/api/auth/login">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className="auth-header-btn">
                {GOOGLE_LOGIN_BUTTON}
              </button>
            </form>
          ) : null}
          {view.retry ? (
            <button
              type="button"
              className="auth-header-btn"
              onClick={onRetry}
              disabled={busy}
              aria-busy={busy}
            >
              重试
            </button>
          ) : null}
          <p className="auth-note">{LOGIN_PRIVACY_COPY}</p>
        </section>
      </main>
      <footer className="auth-foot">
        <strong>免责声明：</strong>
        {DIVIDEND_DISCLAIMER}
      </footer>
    </div>
  );
}
