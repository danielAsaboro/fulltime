"use client";

import { useEffect } from "react";

/**
 * Registers the service worker — only in a secure context (HTTPS or localhost),
 * so it no-ops on plain-HTTP LAN access instead of throwing. That makes the app
 * installable and offline-capable wherever it's served securely.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort; the app works without it */
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
