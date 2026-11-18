/// <reference lib="webworker" />

import {
  PWA_CACHE_NAME,
  PRECACHE_PATHS,
  ownedCacheNamesToDelete,
  planFetch,
} from "./cachePolicy.js";

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PWA_CACHE_NAME).then((cache) => cache.addAll(PRECACHE_PATHS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(ownedCacheNamesToDelete(names).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && typeof event.data === "object" && event.data.type === "quki-pwa-skip-waiting") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const plan = planFetch({
    url: event.request.url,
    method: event.request.method,
    mode: event.request.mode,
  });
  if (plan === "network-only") return;
  if (plan === "precache") {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
    return;
  }
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match("/offline.html");
      if (cached) return cached;
      return new Response("当前离线。账户和行情不会用旧数据顶替。", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }),
  );
});
