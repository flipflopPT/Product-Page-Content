"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    shopify?: { idToken: () => Promise<string> };
  }
}

// Patch window.fetch at module load time (runs before any React useEffect)
// so session tokens are included even on the very first API call after mount.
let _originalFetch: typeof fetch | null = null;

if (typeof window !== "undefined") {
  _originalFetch = window.fetch.bind(window);
  const original = _originalFetch;
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    if (url.startsWith("/api/") && window.shopify?.idToken) {
      try {
        const token = await window.shopify.idToken();
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        init = { ...(init ?? {}), headers };
      } catch {
        // App Bridge not ready — request proceeds, will get 401 if auth required
      }
    }
    return original(input, init);
  };
}

export default function AppBridgeAuth() {
  useEffect(() => {
    // Restore original fetch on unmount (e.g. during development hot reload)
    return () => {
      if (_originalFetch) window.fetch = _originalFetch;
    };
  }, []);
  return null;
}
