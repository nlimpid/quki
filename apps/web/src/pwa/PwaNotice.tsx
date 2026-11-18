import { useEffect, useState } from "react";

import { isPwaEditDirty, subscribePwaEditDirty, updateAction } from "./editGuard.js";

const HINT_KEY = "quki-pwa-hint";

type InstallPrompt = Event & { prompt: () => Promise<void> };

function iosSafari(): boolean {
  const ua = navigator.userAgent;
  const appleMobile = /iPhone|iPad|iPod/i.test(ua);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  return appleMobile && !standalone;
}

/**
 * Install guidance and a manual update. iOS gets written steps, not a fake install button.
 * A waiting worker reloads only when the holding drawer is clean.
 */
export function PwaNotice() {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [showIosHint, setShowIosHint] = useState(() => {
    try {
      return iosSafari() && localStorage.getItem(HINT_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const [waiting, setWaiting] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => subscribePwaEditDirty(() => setDirty(isPwaEditDirty())), []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").then((next) => {
        if (next.waiting && navigator.serviceWorker.controller) setWaiting(true);
        next.addEventListener("updatefound", () => {
          const worker = next.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(true);
          });
        });
      });
    }
    const onController = () => {
      if (!isPwaEditDirty()) window.location.reload();
    };
    navigator.serviceWorker?.addEventListener("controllerchange", onController);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      navigator.serviceWorker?.removeEventListener("controllerchange", onController);
    };
  }, []);

  const action = updateAction({ waiting, dirty });

  return (
    <div className="pwa-notices">
      {showIosHint ? (
        <p className="pwa-note" role="status">
          用 Safari 打开本站，点分享，再选「添加到主屏幕」。
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              localStorage.setItem(HINT_KEY, "1");
              setShowIosHint(false);
            }}
          >
            知道了
          </button>
        </p>
      ) : null}
      {installPrompt ? (
        <p className="pwa-note">
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              void installPrompt.prompt().finally(() => setInstallPrompt(null));
            }}
          >
            安装
          </button>
        </p>
      ) : null}
      {action !== "idle" ? (
        <p className="pwa-note" role="status">
          {action === "hold" ? "有新版本。请先关掉正在编辑的持仓，再更新。" : "有新版本。"}
          <button
            type="button"
            className="text-btn"
            disabled={action === "hold"}
            onClick={() => {
              if (updateAction({ waiting: true, dirty: isPwaEditDirty() }) !== "reload") return;
              void navigator.serviceWorker.getRegistration().then((current) => {
                current?.waiting?.postMessage({ type: "quki-pwa-skip-waiting" });
              });
            }}
          >
            更新
          </button>
        </p>
      ) : null}
    </div>
  );
}
