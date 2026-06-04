"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    shopify?: { idToken: () => Promise<string> };
  }
}

export default function AppBridgeAuth() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
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
          // App Bridge not ready — request proceeds without token
        }
      }
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
