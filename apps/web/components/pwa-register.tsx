"use client";

import { useEffect } from "react";

/**
 * Service worker lifecycle.
 *
 * PRODUCTION (HTTPS or localhost): register `/sw.js` for install + offline.
 * DEVELOPMENT: do NOT register — a SW fights Turbopack's hot-reload (stale cache,
 * reload loops, wasted CPU). We also actively unregister any SW left over from a
 * prior run and clear its caches, so dev stays clean and cool.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
      }
      return;
    }

    if (!window.isSecureContext) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* best-effort; the app works without it */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
